import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { autorizarEscritura } from '../../comun/autorizarEscritura.js';
import { autorizarLectura } from '../../comun/autorizarLectura.js';
import { datosValidados, validar } from '../../comun/validacion.js';
import type { ServicioConsultorio } from './consultorio.js';

/**
 * Datos del consultorio (RF-13), montados bajo `/api`. Ambas rutas exigen sesión. La lectura la
 * autoriza `autorizarLectura('consultorio')` (secretaría y administrador; el kinesiólogo recibe 403,
 * D-16) y la escritura, `autorizarEscritura('consultorio')` (secretaría y administrador).
 *
 * - `GET /api/consultorio`: 200 `{ consultorio: { nombre, direccion, telefono } }`.
 * - `PUT /api/consultorio` `{ nombre, direccion, telefono }`: reemplaza los tres datos, todos
 *   obligatorios. 200 `{ consultorio }` con lo guardado. Los textos se guardan sin espacios en los
 *   extremos.
 *
 * Comunes: 400 `datos_invalidos` (campo ausente, vacío, demasiado largo o con caracteres NUL),
 * 401 sin sesión, 403 `no_autorizado`, 409 `consultorio_no_instalado` si la fila única todavía no
 * existe (la crea el comando de instalación, nunca la API).
 */
const texto = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((valor) => !valor.includes('\u0000'));

const esquemaEditar = {
  body: z.object({
    nombre: texto(120),
    direccion: texto(200),
    telefono: texto(40),
  }),
};

export function crearRutasConsultorio({
  servicio,
  exigirSesion,
}: {
  servicio: ServicioConsultorio;
  exigirSesion: RequestHandler;
}): Router {
  const router = Router();

  router.get('/consultorio', exigirSesion, autorizarLectura('consultorio'), async (_req, res, next) => {
    try {
      res.json({ consultorio: await servicio.obtener() });
    } catch (err) {
      next(err);
    }
  });

  router.put(
    '/consultorio',
    exigirSesion,
    autorizarEscritura('consultorio'),
    validar(esquemaEditar),
    async (_req, res, next) => {
      try {
        const { body } = datosValidados(res.locals, esquemaEditar);
        res.json({ consultorio: await servicio.editar(body) });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
