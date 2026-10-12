import { Component, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { Sesion } from '../nucleo/sesion/sesion';

const NOMBRE_DEL_ROL = {
  administrador: 'Administración',
  secretaria: 'Secretaría',
  kinesiologo: 'Kinesiología',
} as const;

/** Estructura común de las pantallas con sesión: encabezado con el menú de la cuenta y contenido de la ruta. */
@Component({
  selector: 'app-disposicion',
  imports: [RouterOutlet, RouterLink],
  templateUrl: './disposicion.html',
  styleUrl: './disposicion.css',
})
export class Disposicion {
  private readonly sesion = inject(Sesion);
  private readonly router = inject(Router);

  /** Título de la sección, definido en los datos de la ruta. */
  readonly seccion = input<string>('');

  protected readonly usuario = this.sesion.usuario;
  protected readonly cerrando = signal(false);
  protected readonly nombreDelRol = computed(() => {
    const rol = this.sesion.rol();
    return rol ? NOMBRE_DEL_ROL[rol] : '';
  });
  /** Con un paso pendiente, el menú no ofrece nada más que cerrar sesión: el backend lo bloquearía igual. */
  protected readonly puedeCambiarContrasena = computed(() => this.sesion.pasoPendiente() === null);

  /** Cierra la sesión en el servidor y vuelve al ingreso (RF-10). */
  protected async cerrarSesion(): Promise<void> {
    this.cerrando.set(true);
    try {
      await this.sesion.cerrar();
    } catch {
      // El cliente ya olvidó la sesión; si la revocación falló, la cookie vence sola (RF-11).
    } finally {
      this.cerrando.set(false);
    }
    await this.router.navigateByUrl('/ingresar');
  }
}
