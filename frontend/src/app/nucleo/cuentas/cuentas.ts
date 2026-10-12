import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/** Cuenta tal como la lista `GET /api/cuentas` (RF-04). Nunca incluye datos de credenciales. */
export interface CuentaListada {
  id: number;
  nombreUsuario: string;
  rol: 'administrador' | 'secretaria' | 'kinesiologo';
  activo: boolean;
  debeCambiarContrasena: boolean;
}

/**
 * Gestión de cuentas del administrador (RF-04, RF-08, RF-09). El rol sale de la sesión del
 * backend: acá solo se llama a la API. Los errores llegan como `ErrorApi`.
 */
@Injectable({ providedIn: 'root' })
export class Cuentas {
  private readonly http = inject(HttpClient);

  async listar(): Promise<CuentaListada[]> {
    const { cuentas } = await firstValueFrom(
      this.http.get<{ cuentas: CuentaListada[] }>('/api/cuentas'),
    );
    return cuentas;
  }

  /** Alta de una cuenta de secretaría con contraseña temporal (RF-04). */
  async crearSecretaria(nombreUsuario: string, contrasenaTemporal: string): Promise<CuentaListada> {
    const { cuenta } = await firstValueFrom(
      this.http.post<{ cuenta: CuentaListada }>('/api/cuentas', {
        nombreUsuario,
        contrasenaTemporal,
      }),
    );
    return cuenta;
  }

  /** Contraseña temporal nueva; cierra las sesiones de la cuenta y levanta el bloqueo (RF-08). */
  async restablecer(id: number, contrasenaTemporal: string): Promise<void> {
    await firstValueFrom(
      this.http.post<void>(`/api/cuentas/${id}/restablecimiento`, { contrasenaTemporal }),
    );
  }

  /** Desactivación definitiva: no hay reactivación ni borrado (RF-09). */
  async desactivar(id: number): Promise<void> {
    await firstValueFrom(this.http.post<void>(`/api/cuentas/${id}/desactivacion`, {}));
  }
}
