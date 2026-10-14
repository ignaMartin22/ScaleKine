import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { autorizarEscritura } from '../../comun/autorizarEscritura.js';
import { datosValidados, validar } from '../../comun/validacion.js';
import type { ServicioDisponibilidad } from './servicioDisponibilidad.js';

/**
 * Disponibilidad para asignar un turno (RF-22, RF-15), montada bajo `/api`. Exige sesión y
 * `autorizarEscritura('turnos')`: la consulta existe para asignar, así que la hacen quienes pueden
 * escribir turnos (secretaría y administrador); el kinesiólogo recibe 403 (D-16: no ve agendas ajenas).
 * Es de solo lectura.
 *
 * - `GET /api/disponibilidad?fecha=AAAA-MM-DD&bloque=manana|tarde[&pacienteId=N]`. `fecha` es un
 *   día civil del consultorio y debe existir en el calendario; `pacienteId` es opcional. 200
 *   `{ fecha, bloque, kinesiologos: [{ kinesiologoId, nombre, franjas: [{ inicio, fin }] }] }`, con
 *   los kinesiólogos de ese bloque con la cuenta activa (uno desactivado ya no atiende y no aparece),
 *   ordenados por nombre y, de cada uno, las franjas de la grilla
 *   (horas 'HH:MM') sin turno activo (`reservado` o `en_espera`) suyo ni, si viene paciente, de ese
 *   paciente con cualquier kinesiólogo. Un sábado o domingo devuelve `franjas: []` (RF-15).
 *   404 `paciente_no_encontrado` si el paciente no existe.
 *
 * Comunes: 400 `datos_invalidos`, 401 sin sesión, 403 `no_autorizado`. La fecha y el paciente viajan
 * por query, que el registro de peticiones descarta (CLAUDE.md).
 */
const fechaCivil = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((valor) => {
    const fecha = new Date(`${valor}T00:00:00Z`);
    return !Number.isNaN(fecha.getTime()) && fecha.toISOString().startsWith(valor);
  }, 'La fecha no existe en el calendario.');

const idPaciente = z
  .string()
  .regex(/^\d{1,10}$/)
  .transform(Number)
  .pipe(z.number().int().positive().max(2_147_483_647));

const esquemaConsulta = {
  query: z.object({
    fecha: fechaCivil,
    bloque: z.enum(['manana', 'tarde']),
    pacienteId: idPaciente.optional(),
  }),
};

export function crearRutasDisponibilidad({
  servicio,
  exigirSesion,
}: {
  servicio: ServicioDisponibilidad;
  exigirSesion: RequestHandler;
}): Router {
  const router = Router();
  const autorizar = autorizarEscritura('turnos');

  router.get('/disponibilidad', exigirSesion, autorizar, validar(esquemaConsulta), async (_req, res, next) => {
    try {
      const { query } = datosValidados(res.locals, esquemaConsulta);
      const kinesiologos = await servicio.consultar(query.fecha, query.bloque, query.pacienteId);
      res.json({ fecha: query.fecha, bloque: query.bloque, kinesiologos });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
