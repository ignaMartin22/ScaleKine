import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export type Bloque = 'manana' | 'tarde';

/** Texto legible de cada bloque; el valor de la API no se muestra. */
export const NOMBRE_DEL_BLOQUE: Readonly<Record<Bloque, string>> = {
  manana: 'Mañana',
  tarde: 'Tarde',
};

/** Kinesiólogo tal como lo devuelve `/api/kinesiologos`; `activo` es el de su cuenta (RF-14). */
export interface Kinesiologo {
  id: number;
  nombre: string;
  bloque: Bloque;
  activo: boolean;
}

export interface AltaKinesiologo {
  nombre: string;
  bloque: Bloque;
  nombreUsuario: string;
  contrasenaTemporal: string;
}

/** Kinesiólogos (RF-14, RF-16). El rol sale de la sesión del backend. Errores como `ErrorApi`. */
@Injectable({ providedIn: 'root' })
export class Kinesiologos {
  private readonly http = inject(HttpClient);

  async listar(bloque?: Bloque): Promise<Kinesiologo[]> {
    const params = bloque ? new HttpParams().set('bloque', bloque) : undefined;
    const { kinesiologos } = await firstValueFrom(
      this.http.get<{ kinesiologos: Kinesiologo[] }>('/api/kinesiologos', { params }),
    );
    return kinesiologos;
  }

  /** Crea la cuenta y el perfil juntos; el rol lo fija el backend. */
  async crear(alta: AltaKinesiologo): Promise<Kinesiologo> {
    const { kinesiologo } = await firstValueFrom(
      this.http.post<{ kinesiologo: Kinesiologo }>('/api/kinesiologos', alta),
    );
    return kinesiologo;
  }

  /** No toca los turnos ya asignados (RF-16). */
  async cambiarBloque(id: number, bloque: Bloque): Promise<Kinesiologo> {
    const { kinesiologo } = await firstValueFrom(
      this.http.put<{ kinesiologo: Kinesiologo }>(`/api/kinesiologos/${id}/bloque`, { bloque }),
    );
    return kinesiologo;
  }
}
