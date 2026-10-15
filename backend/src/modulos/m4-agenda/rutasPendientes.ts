import { Router, type RequestHandler } from 'express';
import { autorizarEscritura } from '../../comun/autorizarEscritura.js';
import type { ServicioPendientes } from './servicioPendientes.js';

/**
 * Aviso de turnos pendientes de marcar (RF-42), montado bajo `/api`. Exige sesión y
 * `autorizarEscritura('turnos')`: el aviso es de quien marca asistencias (secretaría y administrador);
 * el kinesiólogo recibe 403 (D-16: no ve turnos ajenos). Es de solo lectura y no cambia ningún estado
 * (§4.5): se calcula al leer, con el reloj y la zona horaria del consultorio.
 *
 * - `GET /api/agenda/pendientes`, sin parámetros. 200 `{ cantidad, turnos: [{ id, fecha, horaInicio,
 *   estado, kinesiologoId, kinesiologoNombre, pacienteId, pacienteNombre }] }` con los turnos activos
 *   (`reservado` o `en_espera`) de cualquier fecha cuya franja ya terminó (`fecha + horaInicio + 45 min
 *   < ahora`), del más viejo al más nuevo (fecha, hora de inicio, id). `fecha` es 'AAAA-MM-DD' y
 *   `horaInicio` 'HH:MM', ambas del consultorio. `cantidad` es el largo de `turnos`.
 *
 * Comunes: 401 sin sesión, 403 `no_autorizado`. No se registra ningún dato del paciente.
 */
export function crearRutasPendientes({
  servicio,
  exigirSesion,
}: {
  servicio: ServicioPendientes;
  exigirSesion: RequestHandler;
}): Router {
  const router = Router();
  const autorizar = autorizarEscritura('turnos');

  router.get('/agenda/pendientes', exigirSesion, autorizar, async (_req, res, next) => {
    try {
      res.json(await servicio.consultar());
    } catch (err) {
      next(err);
    }
  });

  return router;
}
