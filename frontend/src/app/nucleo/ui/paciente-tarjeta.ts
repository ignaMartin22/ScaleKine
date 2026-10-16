import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { mostrarDni } from '../pacientes/dni';
import type { Paciente } from '../pacientes/pacientes';
import { Icono } from './icono';

/** Lo que muestra la tarjeta; el teléfono es opcional para la versión compacta del resumen. */
export type PacienteVisible = Pick<Paciente, 'nombre' | 'dni' | 'obraSocial'> &
  Partial<Pick<Paciente, 'telefono'>>;

/**
 * Tarjeta de paciente (DESIGN.md §6.2): ícono en un círculo, nombre y, debajo, «DNI · obra social ·
 * teléfono». Las acciones (por ejemplo «Cambiar paciente») van a la derecha, como contenido. La
 * versión compacta, sin teléfono, es la del resumen del asistente.
 */
@Component({
  selector: 'app-paciente-tarjeta',
  imports: [Icono],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'paciente-tarjeta', '[class.compacta]': 'compacta()' },
  template: `
    <span class="paciente-icono"><app-icono nombre="usuario" /></span>
    <span class="paciente-datos">
      <strong class="paciente-nombre">{{ paciente().nombre }}</strong>
      <span class="paciente-detalle">{{ detalle() }}</span>
    </span>
    <ng-content />
  `,
})
export class PacienteTarjeta {
  readonly paciente = input.required<PacienteVisible>();
  readonly compacta = input(false);

  protected readonly detalle = computed(() => {
    const p = this.paciente();
    const partes = ['DNI ' + mostrarDni(p.dni), p.obraSocial];
    if (!this.compacta() && p.telefono) partes.push(p.telefono);
    return partes.join(' · ');
  });
}
