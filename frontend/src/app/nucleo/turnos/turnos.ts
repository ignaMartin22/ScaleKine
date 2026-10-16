import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { EstadoTurno } from '../agenda/agenda';

/** Datos para asignar un turno (RF-23). El coseguro abonado es un monto en texto, con hasta dos decimales. */
export interface DatosAsignacion {
  pacienteId: number;
  kinesiologoId: number;
  fecha: string;
  horaInicio: string;
  coseguroAbonado?: string;
}

/** Turno recién asignado; `id` es el número de turno del ticket (RF-28). */
export interface TurnoAsignado {
  id: number;
  pacienteId: number;
  kinesiologoId: number;
  fecha: string;
  horaInicio: string;
  estado: string;
  coseguroAbonado: string | null;
}

/** Destino de una reprogramación (RF-36): los tres datos son obligatorios. */
export interface Ubicacion {
  kinesiologoId: number;
  fecha: string;
  horaInicio: string;
}

/** Turnos (RF-23, RF-27, RF-28, RF-30 a RF-36). Los errores llegan como `ErrorApi`. */
@Injectable({ providedIn: 'root' })
export class Turnos {
  private readonly http = inject(HttpClient);

  async asignar(datos: DatosAsignacion): Promise<TurnoAsignado> {
    const { turno } = await firstValueFrom(
      this.http.post<{ turno: TurnoAsignado }>('/api/turnos', datos),
    );
    return turno;
  }

  /** PDF del ticket con los datos vigentes del turno (RF-28). */
  async descargarTicket(id: number): Promise<Blob> {
    return firstValueFrom(this.http.get(`/api/turnos/${id}/ticket`, { responseType: 'blob' }));
  }

  /** Acción del flujo normal (RF-30 a RF-33); la tabla de transiciones la valida el backend. */
  async transicionar(id: number, hacia: EstadoTurno): Promise<TurnoAsignado> {
    const { turno } = await firstValueFrom(
      this.http.post<{ turno: TurnoAsignado }>(`/api/turnos/${id}/transicion`, { hacia }),
    );
    return turno;
  }

  /** Corrección explícita hacia cualquier otro estado (RF-35). */
  async corregir(id: number, estado: EstadoTurno): Promise<TurnoAsignado> {
    const { turno } = await firstValueFrom(
      this.http.post<{ turno: TurnoAsignado }>(`/api/turnos/${id}/correccion`, { estado }),
    );
    return turno;
  }

  /** Reprograma un turno reservado (RF-36, RF-37). */
  async reprogramar(id: number, ubicacion: Ubicacion): Promise<TurnoAsignado> {
    const { turno } = await firstValueFrom(
      this.http.put<{ turno: TurnoAsignado }>(`/api/turnos/${id}/ubicacion`, {
        kinesiologoId: ubicacion.kinesiologoId,
        fecha: ubicacion.fecha,
        horaInicio: ubicacion.horaInicio,
      }),
    );
    return turno;
  }

  /** Registra, corrige o quita el coseguro abonado (RF-27): `null` lo deja sin abonar; la clave siempre viaja. */
  async registrarAbono(id: number, monto: string | null): Promise<TurnoAsignado> {
    const { turno } = await firstValueFrom(
      this.http.put<{ turno: TurnoAsignado }>(`/api/turnos/${id}/abono`, { monto }),
    );
    return turno;
  }
}
