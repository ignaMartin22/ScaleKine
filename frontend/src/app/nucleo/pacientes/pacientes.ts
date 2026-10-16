import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/** Mismo mínimo que el backend para buscar por nombre (RF-21). */
export const MINIMO_BUSQUEDA_NOMBRE = 3;

/** Paciente tal como lo devuelve `/api/pacientes`; `dni` viene normalizado (solo dígitos). */
export interface Paciente {
  id: number;
  dni: string;
  nombre: string;
  telefono: string;
  obraSocial: string;
}

/** Los cuatro datos obligatorios del alta y de la edición (RF-17, RF-20). */
export type DatosPaciente = Omit<Paciente, 'id'>;

/**
 * Pacientes (RF-17, RF-19 a RF-21). El rol sale de la sesión del backend. Errores como `ErrorApi`.
 * La búsqueda manda exactamente uno de `dni` o `nombre`, siempre en la query y nunca en la ruta.
 */
@Injectable({ providedIn: 'root' })
export class Pacientes {
  private readonly http = inject(HttpClient);

  /** Búsqueda exacta: cero o un paciente. Cero es el caso "ofrecer el alta". */
  async buscarPorDni(dni: string): Promise<Paciente[]> {
    return this.buscar(new HttpParams().set('dni', dni));
  }

  /** Coincidencia parcial de al menos tres caracteres; a lo sumo 20 resultados. */
  async buscarPorNombre(nombre: string): Promise<Paciente[]> {
    return this.buscar(new HttpParams().set('nombre', nombre));
  }

  async obtener(id: number): Promise<Paciente> {
    const { paciente } = await firstValueFrom(
      this.http.get<{ paciente: Paciente }>(`/api/pacientes/${id}`),
    );
    return paciente;
  }

  async crear(datos: DatosPaciente): Promise<Paciente> {
    const { paciente } = await firstValueFrom(
      this.http.post<{ paciente: Paciente }>('/api/pacientes', datos),
    );
    return paciente;
  }

  /** Reemplaza todos los datos (PUT). */
  async editar(id: number, datos: DatosPaciente): Promise<Paciente> {
    const { paciente } = await firstValueFrom(
      this.http.put<{ paciente: Paciente }>(`/api/pacientes/${id}`, datos),
    );
    return paciente;
  }

  /** Obras sociales ya guardadas, para sugerir al cargar un paciente (RF-49). Solo secretaría y administrador. */
  async obrasSociales(): Promise<string[]> {
    const { obrasSociales } = await firstValueFrom(
      this.http.get<{ obrasSociales: string[] }>('/api/obras-sociales'),
    );
    return obrasSociales;
  }

  private async buscar(params: HttpParams): Promise<Paciente[]> {
    const { pacientes } = await firstValueFrom(
      this.http.get<{ pacientes: Paciente[] }>('/api/pacientes', { params }),
    );
    return pacientes;
  }
}

/**
 * Sugerencias de obra social (RF-49): «Particular» primero y las guardadas después, sin repetir las
 * variantes que solo difieren en mayúsculas ni los espacios sobrantes. Gana la primera que aparece.
 */
export function sugerenciasDeObraSocial(guardadas: readonly string[]): string[] {
  const vistas = new Set<string>();
  const sugerencias: string[] = [];
  for (const nombre of ['Particular', ...guardadas]) {
    const limpio = nombre.trim().replace(/\s+/g, ' ');
    const clave = limpio.toLocaleLowerCase('es');
    if (clave === '' || vistas.has(clave)) continue;
    vistas.add(clave);
    sugerencias.push(limpio);
  }
  return sugerencias;
}
