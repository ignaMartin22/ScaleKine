import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/** Datos para asignar un turno (RF-23). Los coseguros son montos en texto, con hasta dos decimales. */
export interface DatosAsignacion {
  pacienteId: number;
  kinesiologoId: number;
  fecha: string;
  horaInicio: string;
  coseguroObraSocial?: string;
  coseguroAdicional?: string;
}

/** Turno recién asignado; `id` es el número de turno del ticket (RF-28). */
export interface TurnoAsignado {
  id: number;
  pacienteId: number;
  kinesiologoId: number;
  fecha: string;
  horaInicio: string;
  estado: string;
  coseguroObraSocial: string | null;
  coseguroAdicional: string | null;
}

/** Turnos (RF-23, RF-28). Los errores llegan como `ErrorApi`. */
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
}
