import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/** Estados de un turno, con los nombres de la spec. */
export type EstadoTurno = 'reservado' | 'en_espera' | 'asistio' | 'no_asistio' | 'anulado';

/** Los cinco estados, en el orden del flujo; sirve para elegir el destino de una corrección (RF-35). */
export const ESTADOS: readonly EstadoTurno[] = [
  'reservado',
  'en_espera',
  'asistio',
  'no_asistio',
  'anulado',
];

/** Texto legible de cada estado; el valor de la API no se muestra. */
export const NOMBRE_DEL_ESTADO: Readonly<Record<EstadoTurno, string>> = {
  reservado: 'Reservado',
  en_espera: 'En espera',
  asistio: 'Asistió',
  no_asistio: 'No asistió',
  anulado: 'Anulado',
};

/** Acción del flujo normal que la API ofrece para un turno (RF-34): el texto es de la API. */
export interface AccionTurno {
  hacia: EstadoTurno;
  accion: string;
}

export interface AccionesDelTurno {
  transiciones: AccionTurno[];
  puedeCorregir: boolean;
}

/** Turno de la agenda de secretaría (RF-41), tal como lo devuelve `GET /api/agenda`. */
export interface TurnoDeAgenda {
  id: number;
  fecha: string;
  horaInicio: string;
  horaFin: string;
  estado: EstadoTurno;
  /** Llegada en hora de pared del consultorio ('HH:MM'), calculada por la API, o `null`. */
  horaLlegada: string | null;
  coseguroObraSocial: string | null;
  coseguroAdicional: string | null;
  paciente: { id: number; nombre: string; dni: string; telefono: string; obraSocial: string };
  kinesiologo: { id: number; nombre: string };
  acciones: AccionesDelTurno;
}

export interface AgendaDelDia {
  fecha: string;
  turnos: TurnoDeAgenda[];
}

/** Turno activo cuya franja ya terminó sin marcarse (RF-42). */
export interface TurnoPendiente {
  id: number;
  fecha: string;
  horaInicio: string;
  estado: EstadoTurno;
  kinesiologoId: number;
  kinesiologoNombre: string;
  pacienteId: number;
  pacienteNombre: string;
}

export interface Pendientes {
  cantidad: number;
  turnos: TurnoPendiente[];
}

/**
 * Turno de la agenda del kinesiólogo (RF-40), tal como lo devuelve `GET /api/mi-agenda`: sin
 * `kinesiologo` ni `acciones` (no escribe, D-15) y con el paciente sin `id` (D-16).
 */
export interface TurnoPropio {
  id: number;
  fecha: string;
  horaInicio: string;
  horaFin: string;
  estado: EstadoTurno;
  /** Llegada en hora de pared del consultorio ('HH:MM'), calculada por la API, o `null`. */
  horaLlegada: string | null;
  coseguroObraSocial: string | null;
  coseguroAdicional: string | null;
  paciente: { nombre: string; dni: string; telefono: string; obraSocial: string };
}

export interface AgendaPropia {
  fecha: string;
  enEspera: TurnoPropio[];
  proximos: TurnoPropio[];
}

/** Turno en la ficha del paciente (RF-47), tal como lo devuelve `GET /api/pacientes/:id/turnos`. */
export interface TurnoDePaciente {
  id: number;
  fecha: string;
  horaInicio: string;
  horaFin: string;
  estado: EstadoTurno;
  coseguroObraSocial: string | null;
  coseguroAdicional: string | null;
  kinesiologo: { id: number; nombre: string };
}

export interface TurnosDelPaciente {
  proximos: TurnoDePaciente[];
  historial: TurnoDePaciente[];
}

/**
 * Agenda de secretaría, agenda propia del kinesiólogo, turnos del paciente y aviso de pendientes
 * (RF-40 a RF-42, RF-47). Solo lectura. Fecha y kinesiólogo
 * viajan por query, que el registro de peticiones del backend descarta. Errores como `ErrorApi`.
 */
@Injectable({ providedIn: 'root' })
export class Agenda {
  private readonly http = inject(HttpClient);

  /** Sin `fecha`, la API usa hoy en la zona del consultorio. */
  async consultar(fecha?: string, kinesiologoId?: number): Promise<AgendaDelDia> {
    let params = new HttpParams();
    if (fecha) params = params.set('fecha', fecha);
    if (kinesiologoId !== undefined) params = params.set('kinesiologoId', String(kinesiologoId));
    return firstValueFrom(this.http.get<AgendaDelDia>('/api/agenda', { params }));
  }

  /**
   * Agenda del kinesiólogo de la sesión (RF-40). Nunca manda `kinesiologoId`: lo define la sesión
   * (D-15). Sin `fecha`, la API usa hoy.
   */
  async miAgenda(fecha?: string): Promise<AgendaPropia> {
    let params = new HttpParams();
    if (fecha) params = params.set('fecha', fecha);
    return firstValueFrom(this.http.get<AgendaPropia>('/api/mi-agenda', { params }));
  }

  /** Próximos e historial de un paciente (RF-47). El id viaja en la ruta de la API, no en la URL de la pantalla. */
  async delPaciente(pacienteId: number): Promise<TurnosDelPaciente> {
    return firstValueFrom(this.http.get<TurnosDelPaciente>(`/api/pacientes/${pacienteId}/turnos`));
  }

  async pendientes(): Promise<Pendientes> {
    return firstValueFrom(this.http.get<Pendientes>('/api/agenda/pendientes'));
  }
}
