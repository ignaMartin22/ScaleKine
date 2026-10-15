import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export type Bloque = 'manana' | 'tarde';

/** Franja libre de la grilla; las horas son 'HH:MM'. */
export interface Franja {
  inicio: string;
  fin: string;
}

/** Kinesiólogo del bloque con sus franjas libres, tal como las devuelve la API (RF-22). */
export interface KinesiologoDisponible {
  kinesiologoId: number;
  nombre: string;
  franjas: Franja[];
}

/**
 * Disponibilidad para asignar (RF-22, RF-15): `GET /api/disponibilidad`. Con `pacienteId` la API
 * excluye también las franjas en que el paciente ya tiene un turno activo (RF-25). Fecha y paciente
 * viajan por query, que el registro de peticiones del backend descarta.
 */
@Injectable({ providedIn: 'root' })
export class Disponibilidad {
  private readonly http = inject(HttpClient);

  async consultar(
    fecha: string,
    bloque: Bloque,
    pacienteId?: number,
  ): Promise<KinesiologoDisponible[]> {
    let params = new HttpParams().set('fecha', fecha).set('bloque', bloque);
    if (pacienteId !== undefined) params = params.set('pacienteId', String(pacienteId));
    const { kinesiologos } = await firstValueFrom(
      this.http.get<{ kinesiologos: KinesiologoDisponible[] }>('/api/disponibilidad', { params }),
    );
    return kinesiologos;
  }
}
