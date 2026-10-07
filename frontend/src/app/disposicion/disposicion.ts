import { Component, computed, inject, input } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Sesion } from '../nucleo/sesion/sesion';

const NOMBRE_DEL_ROL = {
  administrador: 'Administración',
  secretaria: 'Secretaría',
  kinesiologo: 'Kinesiología',
} as const;

/** Estructura común de las pantallas con sesión: encabezado y contenido de la ruta. */
@Component({
  selector: 'app-disposicion',
  imports: [RouterOutlet],
  templateUrl: './disposicion.html',
  styleUrl: './disposicion.css',
})
export class Disposicion {
  private readonly sesion = inject(Sesion);

  /** Título de la sección, definido en los datos de la ruta. */
  readonly seccion = input<string>('');

  protected readonly usuario = this.sesion.usuario;
  protected readonly nombreDelRol = computed(() => {
    const rol = this.sesion.rol();
    return rol ? NOMBRE_DEL_ROL[rol] : '';
  });
}
