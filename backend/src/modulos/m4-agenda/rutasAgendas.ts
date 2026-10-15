import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { autorizarAgendaPropia } from '../../comun/autorizarAgendaPropia.js';
import { autorizarEscritura } from '../../comun/autorizarEscritura.js';
import { autorizarLectura } from '../../comun/autorizarLectura.js';
import { fechaCivil, idDeTexto } from '../../comun/esquemas.js';
import { datosValidados, validar } from '../../comun/validacion.js';
import { sesionActual } from '../m1-identidad/index.js';
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
 * - `GET /api/pacientes/:id/turnos` es la ficha del paciente (RF-47, T-29). Exige sesión y
 *   `autorizarLectura('pacientes')`, como el resto de la ficha: secretaría y administrador; el
 *   kinesiólogo recibe 403 aunque el paciente tenga turnos con él (D-16). 200 `{ proximos: [turno],
 *   historial: [turno] }` con todos los turnos del paciente, en cualquier estado y con cualquier
 *   kinesiólogo. Cada turno es `{ id, fecha, horaInicio, horaFin, estado, llegadaEn, coseguroObraSocial,
 *   coseguroAdicional, kinesiologo: { id, nombre } }` (sin `paciente` ni `acciones`). Criterio: un turno
 *   es del `historial` si su franja ya transcurrió (`fecha + horaInicio + 45 min` anterior al
 *   "ahora" del reloj inyectable, en hora de pared de la zona del consultorio, al minuto), el mismo
 *   criterio que el aviso de pendientes (`franjaTranscurrida`); en el minuto exacto de fin y durante
 *   la franja el turno sigue siendo próximo. `proximos` va del más cercano al más lejano e
 *   `historial` del más reciente al más antiguo. Paciente sin turnos: ambas listas vacías. 404
 *   `paciente_no_encontrado`; 400 `datos_invalidos` ante un id mal formado.
 *
 * Todo turno trae `llegadaEn` (instante ISO o null) y `horaLlegada`: esa llegada en hora de pared
 * de la zona del consultorio como 'HH:MM', o null si no hay llegada; el cliente la muestra sin
 * conocer la zona (RF-12).
 *
 * Comunes: 401 sin sesión, 403 `no_autorizado`. No se registra ningún dato del paciente.
 */
const esquemaSecretaria = {
  query: z.object({ fecha: fechaCivil.optional(), kinesiologoId: idDeTexto.optional() }),
};
// Sin `kinesiologoId`: zod descarta las claves desconocidas, así que un identificador de más no llega a la consulta.
const esquemaFicha = { params: z.object({ id: idDeTexto }) };
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

  router.get(
    '/pacientes/:id/turnos',
    exigirSesion,
    autorizarLectura('pacientes'),
    validar(esquemaFicha),
    async (_req, res, next) => {
      try {
        const { params } = datosValidados(res.locals, esquemaFicha);
        res.json(await servicio.delPaciente(params.id));
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
