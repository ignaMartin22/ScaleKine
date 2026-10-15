import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { autorizarAgendaPropia } from '../../comun/autorizarAgendaPropia.js';
import { autorizarEscritura } from '../../comun/autorizarEscritura.js';
import { datosValidados, validar } from '../../comun/validacion.js';
import { sesionActual } from '../m1-identidad/index.js';
import { fechaCivil } from './rutasDisponibilidad.js';
import type { ServicioAgendas } from './servicioAgendas.js';

/**
 * Agendas (M4), montadas bajo `/api`. Son de solo lectura y no cambian ningún estado. `fecha` es un
 * día civil del consultorio ('AAAA-MM-DD', existente en el calendario); si falta, es hoy en la zona
 * del consultorio. Los datos viajan por query, que el registro de peticiones descarta (CLAUDE.md).
 *
 * - `GET /api/agenda?[fecha=AAAA-MM-DD][&kinesiologoId=N]` es la agenda de la secretaría (RF-41,
 *   RF-34). Exige sesión y `autorizarEscritura('turnos')`: secretaría y administrador; el kinesiólogo
 *   recibe 403 (D-16). 200 `{ fecha, turnos: [{ id, fecha, horaInicio, horaFin, estado, llegadaEn
 *   (ISO o null), coseguroObraSocial, coseguroAdicional (texto con dos decimales o null), paciente:
 *   { id, nombre, dni, telefono, obraSocial }, kinesiologo: { id, nombre }, acciones: {
 *   transiciones: [{ hacia, accion }], puedeCorregir } }] }` con todos los turnos de la fecha en
 *   cualquier estado, por franja, kinesiólogo e id. `acciones` sale de `accionesDisponibles` (la
 *   tabla de transiciones de M3) para el rol de la sesión. `kinesiologoId` filtra a uno; si no
 *   existe, la lista es vacía. 400 `datos_invalidos` ante una fecha o un identificador mal formados.
 * - `GET /api/mi-agenda?[fecha=AAAA-MM-DD]` es la agenda del kinesiólogo (RF-40, D-15). Exige
 *   sesión y `autorizarAgendaPropia()`: solo el rol kinesiólogo; secretaría y administrador reciben
 *   403 (usan `/api/agenda`). El kinesiólogo sale de la sesión (el `Kinesiologo` cuya cuenta es la
 *   de la sesión), nunca de la petición: cualquier `kinesiologoId` u otro parámetro de más se
 *   ignora. 200 `{ fecha, enEspera: [turno], proximos: [turno] }`, con `enEspera` (estado
 *   `en_espera`) por hora de llegada y `proximos` (`reservado`) por franja; los turnos cerrados no
 *   aparecen. Cada turno trae la misma proyección que en la agenda de secretaría sin `kinesiologo`
 *   ni `acciones` (el kinesiólogo no escribe) y con el paciente sin `id` (D-16: no consulta
 *   pacientes). Una cuenta kinesiólogo sin perfil de kinesiólogo recibe 403 `no_autorizado`.
 *
 * Comunes: 401 sin sesión, 403 `no_autorizado`. No se registra ningún dato del paciente.
 */
const idKinesiologo = z
  .string()
  .regex(/^\d{1,10}$/)
  .transform(Number)
  .pipe(z.number().int().positive().max(2_147_483_647));

const esquemaSecretaria = {
  query: z.object({ fecha: fechaCivil.optional(), kinesiologoId: idKinesiologo.optional() }),
};
// Sin `kinesiologoId`: zod descarta las claves desconocidas, así que un identificador de más no llega a la consulta.
const esquemaPropia = { query: z.object({ fecha: fechaCivil.optional() }) };

export function crearRutasAgendas({
  servicio,
  exigirSesion,
}: {
  servicio: ServicioAgendas;
  exigirSesion: RequestHandler;
}): Router {
  const router = Router();

  router.get(
    '/agenda',
    exigirSesion,
    autorizarEscritura('turnos'),
    validar(esquemaSecretaria),
    async (_req, res, next) => {
      try {
        const { query } = datosValidados(res.locals, esquemaSecretaria);
        const fecha = query.fecha ?? servicio.hoy();
        const { usuario } = sesionActual(res);
        res.json({ fecha, turnos: await servicio.deSecretaria(usuario.rol, fecha, query.kinesiologoId) });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get('/mi-agenda', exigirSesion, autorizarAgendaPropia(), validar(esquemaPropia), async (_req, res, next) => {
    try {
      const { query } = datosValidados(res.locals, esquemaPropia);
      const fecha = query.fecha ?? servicio.hoy();
      const { usuario } = sesionActual(res);
      res.json({ fecha, ...(await servicio.delKinesiologo(usuario.id, fecha)) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
