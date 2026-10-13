import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { autorizarEscritura } from '../../comun/autorizarEscritura.js';
import { ErrorNegocio } from '../../comun/errores.js';
import { datosValidados, validar } from '../../comun/validacion.js';
import { sesionActual } from '../m1-identidad/index.js';
import type { ServicioTurnos } from './turnos.js';

/**
 * Turnos (M3), montados bajo `/api`. Exigen sesión y `autorizarEscritura('turnos')` (secretaría y
 * administrador; el kinesiólogo recibe 403, RF-03).
 *
 * - `POST /api/turnos` `{ pacienteId, kinesiologoId, fecha, horaInicio, coseguroObraSocial?,
 *   coseguroAdicional? }` asigna un turno en `reservado` (RF-23). `fecha` es 'AAAA-MM-DD' y admite
 *   fechas pasadas; `horaInicio` es 'HH:MM' y debe ser una franja de la grilla del bloque del
 *   kinesiólogo, de lunes a viernes (RF-15). Los coseguros son montos en pesos, como número o texto
 *   decimal con hasta dos decimales, no negativos; ausentes o null quedan sin cargar. El autor del
 *   evento sale de la sesión: un `autorId` o `estado` en el cuerpo se ignora.
 *   201 `{ turno: { id, pacienteId, kinesiologoId, fecha, horaInicio, estado: 'reservado',
 *   coseguroObraSocial, coseguroAdicional } }` (los montos, texto con dos decimales o null). El
 *   `id` es el número de turno del ticket (RF-28).
 *   400 `dato_faltante` (RF-26: el mensaje nombra lo que falta: paciente, kinesiólogo, fecha o
 *   franja), 400 `datos_invalidos` (con `campos`), 400 `franja_invalida`, 404
 *   `paciente_no_encontrado`, 404 `kinesiologo_no_encontrado`, 409 `franja_ocupada` (RF-24: el
 *   kinesiólogo ya tiene un turno activo ahí), 409 `paciente_con_turno_en_franja` (RF-25: el
 *   paciente ya tiene un turno activo en esa franja, con cualquier kinesiólogo).
 * Comunes: 401 sin sesión, 403 `no_autorizado`.
 */
const sinNul = (valor: string) => !valor.includes('\u0000');
const id = z.number().int().positive().max(2_147_483_647);

const fecha = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    // Zod sigue con los demás controles aunque el formato falle: una fecha ilegible no debe lanzar.
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v);
  });
const horaInicio = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/** Monto en pesos, hasta dos decimales y 10 enteros (Decimal(12,2)); se normaliza a texto. */
const monto = z
  .union([z.number().min(0).max(9_999_999_999.99), z.string().trim().max(16).refine(sinNul)])
  .transform((v) => (typeof v === 'number' ? String(v) : v))
  .pipe(z.string().regex(/^\d{1,10}(\.\d{1,2})?$/))
  .nullish();

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

  return router;
}
