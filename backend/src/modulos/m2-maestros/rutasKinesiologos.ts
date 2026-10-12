import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { autorizarEscritura } from '../../comun/autorizarEscritura.js';
import { autorizarLectura } from '../../comun/autorizarLectura.js';
import { datosValidados, validar } from '../../comun/validacion.js';
import type { ServicioKinesiologos } from './kinesiologos.js';

/**
 * Kinesiólogos (RF-14, RF-16), montados bajo `/api`. Todas las rutas exigen sesión. La lectura la
 * autoriza `autorizarLectura('kinesiologos')` (secretaría y administrador; el kinesiólogo recibe
 * 403, D-16) y la escritura, `autorizarEscritura('kinesiologos')` (solo el administrador, RF-03).
 *
 * - `GET /api/kinesiologos` con `?bloque=manana|tarde` opcional: 200
 *   `{ kinesiologos: [{ id, nombre, bloque, activo }] }` ordenados por nombre. `activo` es el de la
 *   cuenta, para que la secretaría no asigne turnos a uno desactivado.
 * - `POST /api/kinesiologos` `{ nombre, bloque, nombreUsuario, contrasenaTemporal }`: crea la cuenta
 *   (rol `kinesiologo`, con cambio de contraseña pendiente) y el perfil en una transacción. 201
 *   `{ kinesiologo }`; 409 `nombre_usuario_en_uso`. Un `rol` en el cuerpo se ignora.
 * - `PUT /api/kinesiologos/:id/bloque` `{ bloque }`: 200 `{ kinesiologo }`. Es PUT y no PATCH porque
 *   `/bloque` es un sub-recurso que se reemplaza entero y es idempotente (como `PUT /consultorio`).
 *   No toca turnos (RF-16). 404 `kinesiologo_no_encontrado`.
 *
 * Después del alta, la cuenta se restablece y se desactiva desde `/api/cuentas` (T-13).
 * Comunes: 400 `datos_invalidos` (incluye contraseña fuera de la política, RNF-03), 401 sin sesión,
 * 403 `no_autorizado`.
 */
const sinNul = (valor: string) => !valor.includes('\u0000');
const bloque = z.enum(['manana', 'tarde']);

const esquemaListar = { query: z.object({ bloque: bloque.optional() }) };
const esquemaCrear = {
  // Claves desconocidas (como `rol`) se descartan: el rol lo fija el servicio.
  body: z.object({
    nombre: z.string().trim().min(1).max(120).refine(sinNul),
    bloque,
    nombreUsuario: z.string().trim().min(3).max(64).refine(sinNul),
    contrasenaTemporal: z.string().min(1).max(1024).refine(sinNul),
  }),
};
const esquemaCambiarBloque = {
  params: z.object({
    id: z
      .string()
      .regex(/^\d{1,10}$/)
      .transform(Number)
      .pipe(z.number().int().positive().max(2_147_483_647)),
  }),
  body: z.object({ bloque }),
};

export function crearRutasKinesiologos({
  servicio,
  exigirSesion,
}: {
  servicio: ServicioKinesiologos;
  exigirSesion: RequestHandler;
}): Router {
  const router = Router();
  const autorizar = autorizarEscritura('kinesiologos');

  router.get(
    '/kinesiologos',
    exigirSesion,
    autorizarLectura('kinesiologos'),
    validar(esquemaListar),
    async (_req, res, next) => {
      try {
        const { query } = datosValidados(res.locals, esquemaListar);
        res.json({ kinesiologos: await servicio.listar(query.bloque) });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post('/kinesiologos', exigirSesion, autorizar, validar(esquemaCrear), async (_req, res, next) => {
    try {
      const { body } = datosValidados(res.locals, esquemaCrear);
      res.status(201).json({ kinesiologo: await servicio.crear(body) });
    } catch (err) {
      next(err);
    }
  });

  router.put(
    '/kinesiologos/:id/bloque',
    exigirSesion,
    autorizar,
    validar(esquemaCambiarBloque),
    async (_req, res, next) => {
      try {
        const { params, body } = datosValidados(res.locals, esquemaCambiarBloque);
        res.json({ kinesiologo: await servicio.cambiarBloque(params.id, body.bloque) });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
