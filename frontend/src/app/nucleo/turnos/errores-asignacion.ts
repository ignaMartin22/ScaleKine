import { ErrorApi } from '../http/error-api';
import { mensajeDe } from '../ui/enfocar';

/** Paso del flujo de asignación al que pertenece un error. */
export type PasoAsignacion = 'paciente' | 'franja' | 'coseguros' | 'confirmar';

export interface TraduccionError {
  paso: PasoAsignacion;
  mensaje: string;
  /** La franja elegida ya no sirve: hay que volver a pedir la disponibilidad (RF-24, RF-25). */
  refrescar: boolean;
  /** El paciente ya no existe: hay que elegirlo de nuevo. */
  olvidarPaciente: boolean;
}

/** Traduce los errores de `POST /api/turnos` a un mensaje claro asociado a su paso (RF-24 a RF-26). */
export function traducirErrorAsignacion(error: unknown): TraduccionError {
  const base = { refrescar: false, olvidarPaciente: false };
  if (error instanceof ErrorApi) {
    switch (error.codigo) {
      case 'franja_ocupada':
        return {
          ...base,
          paso: 'franja',
          refrescar: true,
          mensaje:
            'Esa franja se ocupó mientras tanto. Se actualizó la disponibilidad: elegí otra franja libre.',
        };
      case 'paciente_con_turno_en_franja':
        return {
          ...base,
          paso: 'franja',
          refrescar: true,
          mensaje:
            'El paciente ya tiene un turno en esa hora, con otro kinesiólogo. Elegí otra franja.',
        };
      case 'franja_invalida':
        return {
          ...base,
          paso: 'franja',
          refrescar: true,
          mensaje: 'Esa franja no es válida para el kinesiólogo elegido. Elegí otra.',
        };
      case 'kinesiologo_no_encontrado':
        return {
          ...base,
          paso: 'franja',
          refrescar: true,
          mensaje: 'El kinesiólogo elegido ya no atiende. Se actualizó la disponibilidad.',
        };
      case 'paciente_no_encontrado':
        return {
          ...base,
          paso: 'paciente',
          olvidarPaciente: true,
          mensaje: 'El paciente ya no existe. Buscalo de nuevo por DNI.',
        };
      case 'dato_faltante':
        return { ...base, paso: 'confirmar', mensaje: error.message };
      case 'datos_invalidos':
        if (error.campos.some((c) => c.includes('coseguro'))) {
          return {
            ...base,
            paso: 'coseguros',
            mensaje: 'Los coseguros deben ser montos en pesos, con hasta dos decimales.',
          };
        }
        break;
    }
  }
  return { ...base, paso: 'confirmar', mensaje: mensajeDe(error) };
}

const FORMATO_MONTO = /^\d{1,10}([.,]\d{1,2})?$/;

/**
 * Normaliza un monto tipeado: vacío es "sin cargar" (`undefined`); si tiene formato válido
 * (hasta dos decimales, coma o punto) devuelve el texto con punto; si no, `null`.
 */
export function normalizarMonto(entrada: string): string | undefined | null {
  const limpio = entrada.trim();
  if (limpio === '') return undefined;
  return FORMATO_MONTO.test(limpio) ? limpio.replace(',', '.') : null;
}
