import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { autorizarEscritura } from '../../comun/autorizarEscritura.js';
import { ErrorNegocio } from '../../comun/errores.js';
import { fechaCivil as fecha } from '../../comun/esquemas.js';
import { datosValidados, validar } from '../../comun/validacion.js';
import { sesionActual } from '../m1-identidad/index.js';
import { ESTADOS, type EstadoTurno } from './transiciones.js';
import type { ServicioTurnos } from './turnos.js';

/**
 * Turnos (M3), montados bajo `/api`. Exigen sesión y `autorizarEscritura('turnos')` (secretaría y
 * administrador; el kinesiólogo recibe 403, RF-03).
 *
 * - `POST /api/turnos` `{ pacienteId, kinesiologoId, fecha, horaInicio, coseguroObraSocial?,
 *   coseguroAdicional? }` asigna un turno en `reservado` (RF-23). `fecha` es 'AAAA-MM-DD' y admite
 *   fechas pasadas; `horaInicio` es 'HH:MM' y debe ser una franja de la grilla del bloque del
 *   kinesiólogo, de lunes a viernes (RF-15). Los coseguros son montos en pesos, como número o texto
 *   decimal con hasta dos decimales, no negativos; ausentes, null o texto vacío quedan sin cargar. El autor del
 *   evento sale de la sesión: un `autorId` o `estado` en el cuerpo se ignora.
 *   201 `{ turno: { id, pacienteId, kinesiologoId, fecha, horaInicio, estado: 'reservado',
 *   coseguroObraSocial, coseguroAdicional } }` (los montos, texto con dos decimales o null). El
 *   `id` es el número de turno del ticket (RF-28).
 *   400 `dato_faltante` (RF-26: el mensaje nombra lo que falta: paciente, kinesiólogo, fecha o
 *   franja), 400 `datos_invalidos` (con `campos`), 400 `franja_invalida`, 404
 *   `paciente_no_encontrado`, 404 `kinesiologo_no_encontrado`, 409 `franja_ocupada` (RF-24: el
 *   kinesiólogo ya tiene un turno activo ahí), 409 `paciente_con_turno_en_franja` (RF-25: el
 *   paciente ya tiene un turno activo en esa franja, con cualquier kinesiólogo).
 * - `POST /api/turnos/:id/transicion` `{ hacia }` aplica una acción del flujo normal (RF-30 a
 *   RF-33): `hacia` es uno de los cinco estados y el cambio debe ser una fila de la tabla de
 *   `transiciones.ts`. Al pasar a `en_espera` registra `llegadaEn`. 200 `{ turno: { id, pacienteId,
 *   kinesiologoId, fecha, horaInicio, estado, llegadaEn (ISO o null), coseguroObraSocial,
 *   coseguroAdicional } }`. 404 `turno_no_encontrado`, 409 `transicion_no_permitida` (la acción no
 *   sale del estado actual, o ya está en ese estado), 409 `turno_modificado` (otro pedido cambió el
 *   estado en el medio; sin evento).
 * - `POST /api/turnos/:id/correccion` `{ estado }` lleva el turno a cualquier otro estado (RF-35),
 *   con evento `correccion`. `llegadaEn`: se limpia al volver a `reservado`; hacia `en_espera` se
 *   conserva la que tenía o, si no tenía, se registra la hora de la corrección; en los demás casos
 *   se conserva. Misma respuesta 200. 404, 409 `correccion_sin_cambio` (mismo estado), 409
 *   `turno_modificado`, 409 `franja_ocupada` / `paciente_con_turno_en_franja` (RF-37: hacia un
 *   estado activo sobre una franja ocupada; no modifica el turno ni escribe evento).
 * - `PUT /api/turnos/:id/coseguros` `{ coseguroObraSocial, coseguroAdicional }` reemplaza ambos
 *   montos (RF-27), con el mismo formato que al asignar. Las dos claves son obligatorias (una
 *   ausente da 400, para no borrar un monto sin querer); `null` o texto vacío = sin cargar.
 *   No altera estado ni franja. Registra un evento `modificacion_coseguros` (RF-46). 200 con el
 *   mismo `{ turno }`; 400 `datos_invalidos`; 404 `turno_no_encontrado`.
 * - `PUT /api/turnos/:id/ubicacion` `{ kinesiologoId, fecha, horaInicio }` reprograma (RF-36): mueve
 *   el mismo turno `reservado` a la ubicación indicada. Los tres datos son obligatorios (los que no
 *   cambian se repiten) y con el mismo formato que al asignar; `fecha` admite fechas pasadas. El
 *   estado, el paciente y los coseguros no cambian. Si cambia el kinesiólogo, la franja se valida
 *   contra el bloque del nuevo (RF-15). Registra un evento `reprogramacion` sin la ubicación
 *   anterior (D-9, RF-46). 200 con el mismo `{ turno }`. 400 `datos_invalidos`, 400 `franja_invalida`,
 *   404 `turno_no_encontrado`, 404 `kinesiologo_no_encontrado` (inexistente o con la cuenta
 *   desactivada), 409 `turno_no_reservado` (RF-37), 409 `franja_ocupada` / 409
 *   `paciente_con_turno_en_franja` (RF-37), 409 `reprogramacion_sin_cambio` (la ubicación pedida es
 *   la actual: se rechaza, sin evento), 409 `turno_modificado` (otro pedido cambió el turno en el
 *   medio). Todo rechazo deja el turno intacto y sin evento.
 * Comunes: 401 sin sesión, 403 `no_autorizado`.
 */
const sinNul = (valor: string) => !valor.includes('\u0000');
const id = z.number().int().positive().max(2_147_483_647);

const horaInicio = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/** Monto en pesos, hasta dos decimales y 10 enteros (Decimal(12,2)); se normaliza a texto. */
const montoBase = z
  .union([z.number().min(0).max(9_999_999_999.99), z.string().trim().max(16).refine(sinNul)])
  .transform((v) => (typeof v === 'number' ? String(v) : v))
  .pipe(z.string().regex(/^\d{1,10}(\.\d{1,2})?$/));
const monto = z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), montoBase.nullish());

/** Como `monto`, pero la clave es obligatoria: `null` o texto vacío = sin cargar. */
const montoExplicito = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  montoBase.nullable(),
);

const esquemaAsignar = {
  // Las claves desconocidas (autor, estado) se descartan: el autor sale de la sesión.
  body: z.object({
    pacienteId: id,
    kinesiologoId: id,
    fecha,
    horaInicio,
    coseguroObraSocial: monto,
    coseguroAdicional: monto,
  }),
};

const DATOS_OBLIGATORIOS = [
  ['pacienteId', 'paciente'],
  ['kinesiologoId', 'kinesiólogo'],
  ['fecha', 'fecha'],
  ['horaInicio', 'franja'],
] as const;

/** RF-26: si falta un dato obligatorio, el mensaje dice cuál (o cuáles). */
const exigirDatosCompletos: RequestHandler = (req, _res, next) => {
  const cuerpo: unknown = req.body;
  const dado = (clave: string) => {
    const valor =
      typeof cuerpo === 'object' && cuerpo !== null ? (cuerpo as Record<string, unknown>)[clave] : undefined;
    return valor !== undefined && valor !== null && valor !== '';
  };
  const faltan = DATOS_OBLIGATORIOS.filter(([clave]) => !dado(clave)).map(([, nombre]) => nombre);
  if (faltan.length > 0) {
    next(new ErrorNegocio('dato_faltante', `Falta indicar: ${faltan.join(', ')}.`, 400));
    return;
  }
  next();
};

const idTurno = z
  .string()
  .regex(/^\d{1,10}$/)
  .transform(Number)
  .pipe(z.number().int().positive().max(2_147_483_647));
const estado = z.enum(ESTADOS as [EstadoTurno, ...EstadoTurno[]]);
const esquemaTransicion = { params: z.object({ id: idTurno }), body: z.object({ hacia: estado }) };
const esquemaCorreccion = { params: z.object({ id: idTurno }), body: z.object({ estado }) };

const esquemaCoseguros = {
  params: z.object({ id: idTurno }),
  body: z.object({ coseguroObraSocial: montoExplicito, coseguroAdicional: montoExplicito }),
};

const esquemaReprogramar = {
  params: z.object({ id: idTurno }),
  body: z.object({ kinesiologoId: id, fecha, horaInicio }),
};

export function crearRutasTurnos({
  servicio,
  exigirSesion,
}: {
  servicio: ServicioTurnos;
  exigirSesion: RequestHandler;
}): Router {
  const router = Router();

  router.post(
    '/turnos',
    exigirSesion,
    autorizarEscritura('turnos'),
    exigirDatosCompletos,
    validar(esquemaAsignar),
    async (_req, res, next) => {
      try {
        const { body } = datosValidados(res.locals, esquemaAsignar);
        const turno = await servicio.asignar(body, sesionActual(res).usuario.id);
        res.status(201).json({ turno });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/turnos/:id/transicion',
    exigirSesion,
    autorizarEscritura('turnos'),
    validar(esquemaTransicion),
    async (_req, res, next) => {
      try {
        const { params, body } = datosValidados(res.locals, esquemaTransicion);
        const { usuario } = sesionActual(res);
        res.json({ turno: await servicio.transicionar(params.id, body.hacia, usuario.id, usuario.rol) });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/turnos/:id/correccion',
    exigirSesion,
    autorizarEscritura('turnos'),
    validar(esquemaCorreccion),
    async (_req, res, next) => {
      try {
        const { params, body } = datosValidados(res.locals, esquemaCorreccion);
        res.json({ turno: await servicio.corregir(params.id, body.estado, sesionActual(res).usuario.id) });
      } catch (err) {
        next(err);
      }
    },
  );

  router.put(
    '/turnos/:id/coseguros',
    exigirSesion,
    autorizarEscritura('turnos'),
    validar(esquemaCoseguros),
    async (_req, res, next) => {
      try {
        const { params, body } = datosValidados(res.locals, esquemaCoseguros);
        const montos = {
          coseguroObraSocial: body.coseguroObraSocial ?? null,
          coseguroAdicional: body.coseguroAdicional ?? null,
        };
        res.json({ turno: await servicio.modificarCoseguros(params.id, montos, sesionActual(res).usuario.id) });
      } catch (err) {
        next(err);
      }
    },
  );

  router.put(
    '/turnos/:id/ubicacion',
    exigirSesion,
    autorizarEscritura('turnos'),
    validar(esquemaReprogramar),
    async (_req, res, next) => {
      try {
        const { params, body } = datosValidados(res.locals, esquemaReprogramar);
        res.json({ turno: await servicio.reprogramar(params.id, body, sesionActual(res).usuario.id) });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
