import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { UsuarioSesion } from './modelo';

/**
 * Estado de la sesión en el cliente. Solo sirve para decidir qué pantalla mostrar: el backend es el
 * que autoriza cada petición con el rol de la sesión, nunca con lo que diga el cliente.
 */
@Injectable({ providedIn: 'root' })
export class Sesion {
  private readonly http = inject(HttpClient);

  private readonly usuarioActual = signal<UsuarioSesion | null>(null);
  private consultada = false;

  readonly usuario = this.usuarioActual.asReadonly();
  readonly rol = computed(() => this.usuarioActual()?.rol ?? null);

  /**
   * Pregunta al backend por la sesión de la cookie, una sola vez por carga de la aplicación. Si no
   * hay sesión válida, el usuario queda en null.
   */
  async asegurarCargada(): Promise<UsuarioSesion | null> {
    if (!this.consultada) {
      this.consultada = true;
      try {
        const respuesta = await firstValueFrom(this.http.get<{ usuario: UsuarioSesion }>('/api/sesion'));
        this.usuarioActual.set(respuesta.usuario);
      } catch {
        this.usuarioActual.set(null);
      }
    }
    return this.usuarioActual();
  }

  establecer(usuario: UsuarioSesion): void {
    this.consultada = true;
    this.usuarioActual.set(usuario);
  }

  /** Olvida la sesión del cliente: la pantalla deja de mostrar datos (RF-10, RF-11). */
  limpiar(): void {
    this.consultada = true;
    this.usuarioActual.set(null);
  }
}
