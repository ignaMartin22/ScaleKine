import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { autorizarEscritura } from '../../comun/autorizarEscritura.js';
import { idDeTexto } from '../../comun/esquemas.js';
import { datosValidados, validar } from '../../comun/validacion.js';
import type { ServicioTicket } from './ticket.js';

/**
 * Ticket del turno (RF-28), montado bajo `/api`. Exige sesión y `autorizarEscritura('turnos')`
 * (secretaría y administrador; el kinesiólogo recibe 403, RF-03). Es de solo lectura.
 *
 * - `GET /api/turnos/:id/ticket` responde el PDF del ticket con los datos vigentes del turno, del
 *   paciente, del kinesiólogo y del consultorio: 200 `application/pdf`, con
 *   `Content-Disposition: attachment; filename="turno-<id>.pdf"` (sin datos personales) y
 *   `Cache-Control: no-store`. 404 `turno_no_encontrado`.
 * Comunes: 400 `datos_invalidos` (id mal formado), 401 sin sesión, 403 `no_autorizado`.
 */
const esquemaTicket = {
  params: z.object({
    id: idDeTexto,
  }),
};

export function crearRutasTicket({
  servicio,
  exigirSesion,
}: {
  servicio: ServicioTicket;
  exigirSesion: RequestHandler;
}): Router {
  const router = Router();

  router.get(
    '/turnos/:id/ticket',
    exigirSesion,
    autorizarEscritura('turnos'),
    validar(esquemaTicket),
    async (_req, res, next) => {
      try {
        const { params } = datosValidados(res.locals, esquemaTicket);
        const pdf = await servicio.generar(params.id);
        res
          .status(200)
          .set({
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="turno-${params.id}.pdf"`,
            'Cache-Control': 'no-store',
          })
          .send(pdf);
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
