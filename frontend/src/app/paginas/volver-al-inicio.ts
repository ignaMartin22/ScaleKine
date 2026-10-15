import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { INICIO_POR_ROL } from '../nucleo/sesion/modelo';
import { Sesion } from '../nucleo/sesion/sesion';

/** Enlace al inicio del rol de la sesión (el administrador no vuelve a la agenda de secretaría). */
@Component({
  selector: 'app-volver-al-inicio',
  imports: [RouterLink],
  template: `<p><a [routerLink]="destino()">Volver al inicio</a></p>`,
})
export class VolverAlInicio {
  private readonly sesion = inject(Sesion);
  protected readonly destino = computed(() => {
    const rol = this.sesion.rol();
    return rol ? INICIO_POR_ROL[rol] : '/';
  });
}
