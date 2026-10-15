import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { autorizarEscritura } from '../../comun/autorizarEscritura.js';
import { autorizarLectura } from '../../comun/autorizarLectura.js';
import { idDeTexto } from '../../comun/esquemas.js';
import { datosValidados, validar } from '../../comun/validacion.js';
import { normalizarDni } from './dni.js';
import { MINIMO_BUSQUEDA_NOMBRE, type ServicioPacientes } from './pacientes.js';

/**
 * Pacientes (RF-17 a RF-21), montados bajo `/api`. Todas las rutas exigen sesión. La lectura la
 * autoriza `autorizarLectura('pacientes')` (secretaría y administrador; el kinesiólogo recibe 403,
 * D-16) y la escritura, `autorizarEscritura('pacientes')` (secretaría y administrador).
 *
 * Un paciente es `{ id, dni, nombre, telefono, obraSocial }`. `dni` se devuelve normalizado (solo
 * dígitos). Los turnos y el historial de la ficha llegan en T-29.
 *
 * - `POST /api/pacientes` `{ dni, nombre, telefono, obraSocial }`, todos obligatorios (RF-17).
 *   "Particular" es un valor de obra social más: lo manda el cliente, el backend no lo completa. El
 *   DNI se normaliza (se quitan puntos y espacios) y debe tener 7 u 8 dígitos (RF-18). 201
 *   `{ paciente }`; 409 `dni_en_uso` si otro paciente ya lo tiene, también en una carrera.
 * - `PUT /api/pacientes/:id` con los mismos campos y la misma validación (RF-20). Reemplaza los
 *   datos enteros. 200 `{ paciente }`; 404 `paciente_no_encontrado`; 409 `dni_en_uso` si el DNI es
 *   de otro paciente (guardar el propio no es conflicto).
 * - `GET /api/pacientes/:id`: ficha con los datos de M2. 200 `{ paciente }`; 404.
 * - `GET /api/pacientes?dni=…` (RF-19, RF-21): búsqueda exacta; el DNI se normaliza igual que en el
 *   alta, así `30.123.456` encuentra al `30123456`. 200 `{ pacientes: [] }` con cero o un
 *   paciente; el cero es el caso "ofrecer el alta" y no un error. Un DNI con formato inválido es
 *   400, no "sin resultados".
 * - `GET /api/pacientes?nombre=…` (RF-21): coincidencia parcial sin distinguir mayúsculas (no
 *   ignora tildes), de al menos 3 caracteres tras recortar espacios; devuelve a lo sumo 20
 *   pacientes ordenados por nombre. 200 `{ pacientes: [...] }`.
 *   Exactamente uno de `dni` y `nombre`; ninguno o ambos es 400.
 *
 * Por qué query y no `GET /pacientes/dni/:dni`: el registro de peticiones descarta la query string
 * (`logger.ts`), mientras que un DNI en la ruta quedaría en los logs (CLAUDE.md). Y un solo
 * recurso con filtros sirve a la vez a la asignación de turnos (RF-19) y a la sección Pacientes
 * (RF-21).
 *
 * Comunes: 400 `datos_invalidos`, 401 sin sesión, 403 `no_autorizado`.
 */
const sinNul = (valor: string) => !valor.includes('\u0000');

/** Texto que llega como DNI: se normaliza o se rechaza con el mismo mensaje que cualquier formato. */
const dni = z
  .string()
  .max(40)
  .transform((valor, ctx) => {
    const normalizado = normalizarDni(valor);
    if (normalizado === null) {
      ctx.addIssue({
        code: 'custom',
        message: 'El DNI debe tener 7 u 8 dígitos.',
      });
      return z.NEVER;
    }
    return normalizado;
  });

const datosPaciente = z.object({
  dni,
  nombre: z.string().trim().min(1).max(120).refine(sinNul),
  telefono: z.string().trim().min(1).max(40).refine(sinNul),
  obraSocial: z.string().trim().min(1).max(120).refine(sinNul),
});

const esquemaCrear = { body: datosPaciente };
const esquemaEditar = {
  params: z.object({ id: idDeTexto }),
  body: datosPaciente,
};
const esquemaFicha = { params: z.object({ id: idDeTexto }) };
const esquemaBuscar = {
  query: z
    .object({
      dni: dni.optional(),
      nombre: z.string().trim().min(MINIMO_BUSQUEDA_NOMBRE).max(120).refine(sinNul).optional(),
    })
    .refine((q) => (q.dni === undefined) !== (q.nombre === undefined), {
      message: 'Indicá exactamente uno de dni o nombre.',
    }),
};

export function crearRutasPacientes({
  servicio,
  exigirSesion,
}: {
  servicio: ServicioPacientes;
  exigirSesion: RequestHandler;
}): Router {
  const router = Router();
  const autorizar = autorizarEscritura('pacientes');
  const leer = autorizarLectura('pacientes');

  router.get('/pacientes', exigirSesion, leer, validar(esquemaBuscar), async (_req, res, next) => {
    try {
      const { query } = datosValidados(res.locals, esquemaBuscar);
      const pacientes =
        query.dni !== undefined
          ? await servicio.buscarPorDni(query.dni)
          : await servicio.buscarPorNombre(query.nombre ?? '');
      res.json({ pacientes });
    } catch (err) {
      next(err);
    }
  });

  router.get('/pacientes/:id', exigirSesion, leer, validar(esquemaFicha), async (_req, res, next) => {
    try {
      const { params } = datosValidados(res.locals, esquemaFicha);
      res.json({ paciente: await servicio.obtener(params.id) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/pacientes', exigirSesion, autorizar, validar(esquemaCrear), async (_req, res, next) => {
    try {
      const { body } = datosValidados(res.locals, esquemaCrear);
      res.status(201).json({ paciente: await servicio.crear(body) });
    } catch (err) {
      next(err);
    }
  });

  router.put('/pacientes/:id', exigirSesion, autorizar, validar(esquemaEditar), async (_req, res, next) => {
    try {
      const { params, body } = datosValidados(res.locals, esquemaEditar);
      res.json({ paciente: await servicio.editar(params.id, body) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
