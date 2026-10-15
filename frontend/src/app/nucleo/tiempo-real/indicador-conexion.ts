import { Component, computed, inject } from '@angular/core';
import { TiempoReal } from './tiempo-real';

/**
 * Indicador de conexión (RF-45; DESIGN.md §7): barra ámbar visible mientras la conexión de tiempo
 * real está caída o reconectando. El ícono es SVG en línea hasta que exista el módulo de íconos.
 */
@Component({
  selector: 'app-indicador-conexion',
  template: `
    @if (sinConexion()) {
      <p class="indicador-conexion" id="indicador-conexion" role="status">
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path
            d="M2 8.8a15 15 0 0 1 4.2-2.6M22 8.8a15 15 0 0 0-9.5-3.7M5 12.9a10 10 0 0 1 5-2.7"
          />
          <path d="M19 12.9a10 10 0 0 0-3-2.3M8.5 16.4a5 5 0 0 1 7 0" />
          <path d="M12 20h.01M2 2l20 20" />
        </svg>
        <span>Sin conexión: la agenda puede estar desactualizada</span>
      </p>
    }
  `,
  styles: `
    .indicador-conexion {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin: 0 0 1rem;
      padding: 0.5rem 0.75rem;
      border: 1px solid var(--advertencia, #b45309);
      border-radius: 0.375rem;
      background: var(--advertencia-fondo, #fef3c7);
      color: var(--advertencia-texto, #78350f);
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
