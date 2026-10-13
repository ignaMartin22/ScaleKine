import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/** Datos del consultorio tal como los devuelve `/api/consultorio` (RF-13). */
export interface DatosConsultorio {
  nombre: string;
  direccion: string;
  telefono: string;
}

/** Lectura y edición de los datos del consultorio. Los errores llegan como `ErrorApi`. */
@Injectable({ providedIn: 'root' })
export class Consultorio {
  private readonly http = inject(HttpClient);

  async obtener(): Promise<DatosConsultorio> {
    const { consultorio } = await firstValueFrom(
      this.http.get<{ consultorio: DatosConsultorio }>('/api/consultorio'),
    );
    return consultorio;
  }

  /** Reemplaza los tres datos; devuelve lo que guardó el backend. */
  async editar(datos: DatosConsultorio): Promise<DatosConsultorio> {
    const { consultorio } = await firstValueFrom(
      this.http.put<{ consultorio: DatosConsultorio }>('/api/consultorio', datos),
    );
    return consultorio;
  }
}
