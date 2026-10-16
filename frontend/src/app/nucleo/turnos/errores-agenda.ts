import { ErrorApi } from '../http/error-api';
import { mensajeDe } from '../ui/enfocar';

/** Acción de la agenda en la que ocurrió el error. */
export type ContextoAccion = 'transicion' | 'correccion' | 'reprogramacion' | 'abono' | 'ticket';

export interface TraduccionAccion {
  mensaje: string;
  /** El turno cambió o se movió: hay que volver a leer la agenda. */
  refrescarAgenda: boolean;
  /** La franja elegida ya no sirve: hay que volver a pedir la disponibilidad. */
  refrescarDisponibilidad: boolean;
  /** Lo que se estaba haciendo quedó desactualizado: se cierra el diálogo y el aviso va al turno. */
  cerrar: boolean;
}

/** Traduce los errores de las escrituras de un turno a un mensaje claro (RF-30 a RF-37, RF-27). */
export function traducirErrorAccion(error: unknown, contexto: ContextoAccion): TraduccionAccion {
  const base = { refrescarAgenda: false, refrescarDisponibilidad: false, cerrar: false };
  if (error instanceof ErrorApi) {
    switch (error.codigo) {
      case 'turno_modificado':
        return {
          ...base,
          refrescarAgenda: true,
          cerrar: true,
          mensaje:
            'Otra persona modificó este turno mientras tanto. Se actualizó la agenda: revisá cómo quedó y repetí la acción si corresponde.',
        };
      case 'transicion_no_permitida':
        return {
          ...base,
          refrescarAgenda: true,
          cerrar: true,
          mensaje:
            'Esa acción ya no corresponde al estado actual del turno. Se actualizó la agenda.',
        };
      case 'correccion_sin_cambio':
        return {
          ...base,
          refrescarAgenda: true,
          cerrar: true,
          mensaje: 'El turno ya estaba en ese estado. Se actualizó la agenda.',
        };
      case 'turno_no_reservado':
        return {
          ...base,
          refrescarAgenda: true,
          cerrar: true,
          mensaje:
            'Solo se puede reprogramar un turno reservado, y este ya cambió de estado. Se actualizó la agenda.',
        };
      case 'turno_no_encontrado':
        return {
          ...base,
          refrescarAgenda: true,
          cerrar: true,
          mensaje: 'El turno ya no existe. Se actualizó la agenda.',
        };
      case 'reprogramacion_sin_cambio':
        return {
          ...base,
          mensaje:
            'Elegiste la misma fecha, franja y kinesiólogo que ya tiene el turno. Elegí otra.',
        };
      case 'franja_ocupada':
        return contexto === 'correccion'
          ? {
              ...base,
              refrescarAgenda: true,
              mensaje:
                'No se puede volver a un estado activo: la franja del turno ya la ocupa otro turno del kinesiólogo. Elegí otro estado.',
            }
          : {
              ...base,
              refrescarAgenda: true,
              refrescarDisponibilidad: true,
              mensaje:
                'Esa franja se ocupó mientras tanto. Se actualizó la disponibilidad: elegí otra franja libre.',
            };
      case 'paciente_con_turno_en_franja':
        return contexto === 'correccion'
          ? {
              ...base,
              refrescarAgenda: true,
              mensaje:
                'No se puede volver a un estado activo: el paciente ya tiene otro turno en esa hora. Elegí otro estado.',
            }
          : {
              ...base,
              refrescarAgenda: true,
              refrescarDisponibilidad: true,
              mensaje:
                'El paciente ya tiene un turno en esa hora, con otro kinesiólogo. Elegí otra franja.',
            };
      case 'franja_invalida':
        return {
          ...base,
          refrescarDisponibilidad: true,
          mensaje: 'Esa franja no es válida para el kinesiólogo elegido. Elegí otra.',
        };
      case 'kinesiologo_no_encontrado':
        return {
          ...base,
          refrescarDisponibilidad: true,
          mensaje: 'El kinesiólogo elegido ya no atiende. Se actualizó la disponibilidad.',
        };
      case 'datos_invalidos':
        if (contexto === 'abono') {
          return {
            ...base,
            mensaje: 'El coseguro abonado debe ser un monto en pesos, con hasta dos decimales.',
          };
        }
        break;
    }
  }
  return { ...base, mensaje: mensajeDe(error) };
}
