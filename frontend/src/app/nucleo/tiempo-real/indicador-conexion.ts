import { Component, computed, inject } from '@angular/core';
import { Icono } from '../ui/icono';
import { TiempoReal } from './tiempo-real';

/**
 * Indicador de conexión (RF-45; DESIGN.md §7): barra ámbar visible mientras la conexión de tiempo
 * real está caída o reconectando. Usa la clase `.conexion` de `styles.css`.
 */
@Component({
  selector: 'app-indicador-conexion',
  imports: [Icono],
  template: `
    @if (sinConexion()) {
      <p class="conexion" id="indicador-conexion" role="status">
        <app-icono nombre="sin-conexion" />
        <span>Sin conexión: la agenda puede estar desactualizada</span>
      </p>
    }
  `,
})
export class IndicadorConexion {
  private readonly tiempoReal = inject(TiempoReal);
  protected readonly sinConexion = computed(() => {
    const estado = this.tiempoReal.estado();
    return estado === 'caido' || estado === 'reconectando';
  });
}
