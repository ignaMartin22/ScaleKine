import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { autorizarEscritura } from '../../comun/autorizarEscritura.js';
import { datosValidados, validar } from '../../comun/validacion.js';
import type { ServicioCuentas } from './cuentas.js';

/**
 * Gestión de cuentas (RF-04, RF-08, RF-09), montada bajo `/api`. Todas las rutas exigen sesión y
 * `autorizarEscritura('cuentas')`, es decir, son del administrador (RF-03). El GET también lo lleva:
 * ver las cuentas es parte de gestionarlas.
 *
 * - `GET /api/cuentas`: 200 `{ cuentas: [{ id, nombreUsuario, rol, activo, debeCambiarContrasena }] }`.
 * - `POST /api/cuentas` `{ nombreUsuario, contrasenaTemporal }`: crea una cuenta de secretaría
 *   marcada para cambiar la contraseña. 201 `{ cuenta }`; 409 `nombre_usuario_en_uso`.
 * - `POST /api/cuentas/:id/restablecimiento` `{ contrasenaTemporal }`: 204. Revoca las sesiones y
 *   levanta el bloqueo por intentos. 409 `cuenta_inactiva`.
 * - `POST /api/cuentas/:id/desactivacion`: 204, idempotente.
 *
 * Comunes: 400 con datos inválidos o contraseña fuera de la política (RNF-03), 404
 * `cuenta_no_encontrada`, 409 `cuenta_de_administrador` (al administrador se lo restablece por CLI).
 */
const sinNul = (valor: string) => !valor.includes('\u0000');
const contrasenaTemporal = z.string().min(1).max(1024).refine(sinNul);

const esquemaCrear = {
  // Un `rol` en el cuerpo se descarta: zod ignora las claves desconocidas y el rol lo fija el servicio.
  body: z.object({
    nombreUsuario: z.string().trim().min(3).max(64).refine(sinNul),
    contrasenaTemporal,
  }),
};
const esquemaId = {
  params: z.object({
    // Entero positivo dentro del rango de la columna `Int` de PostgreSQL.
    id: z
      .string()
      .regex(/^\d{1,10}$/)
      .transform(Number)
      .pipe(z.number().int().positive().max(2_147_483_647)),
  }),
};
const esquemaRestablecer = {
  ...esquemaId,
  body: z.object({ contrasenaTemporal }),
};

export function crearRutasCuentas({
  servicio,
  exigirSesion,
}: {
  servicio: ServicioCuentas;
  exigirSesion: RequestHandler;
}): Router {
  const router = Router();
  const autorizar = autorizarEscritura('cuentas');

  router.get('/cuentas', exigirSesion, autorizar, async (_req, res, next) => {
    try {
      res.json({ cuentas: await servicio.listar() });
    } catch (err) {
      next(err);
    }
  });

  router.post('/cuentas', exigirSesion, autorizar, validar(esquemaCrear), async (_req, res, next) => {
    try {
      const { body } = datosValidados(res.locals, esquemaCrear);
      const cuenta = await servicio.crear(body.nombreUsuario, body.contrasenaTemporal);
      res.status(201).json({ cuenta });
    } catch (err) {
      next(err);
    }
  });

  router.post(
    '/cuentas/:id/restablecimiento',
    exigirSesion,
    autorizar,
    validar(esquemaRestablecer),
    async (_req, res, next) => {
      try {
        const { params, body } = datosValidados(res.locals, esquemaRestablecer);
        await servicio.restablecer(params.id, body.contrasenaTemporal);
        res.status(204).end();
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/cuentas/:id/desactivacion',
    exigirSesion,
    autorizar,
    validar(esquemaId),
    async (_req, res, next) => {
      try {
        const { params } = datosValidados(res.locals, esquemaId);
        await servicio.desactivar(params.id);
        res.status(204).end();
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
