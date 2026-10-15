import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { NOMBRE_DEL_ESTADO, type EstadoTurno } from '../agenda/agenda';
import { Icono, type NombreDeIcono } from './icono';

/** Ícono de cada estado del turno (DESIGN.md §2.4). */
export const ICONO_DEL_ESTADO: Readonly<Record<EstadoTurno, NombreDeIcono>> = {
  reservado: 'reloj',
  en_espera: 'reloj-arena',
  asistio: 'check',
  no_asistio: 'usuario-x',
  anulado: 'prohibido',
};

/** Pastilla de estado del turno: color, ícono y texto (RNF-15, DESIGN.md §2.4). */
@Component({
  selector: 'app-estado-turno',
  imports: [Icono],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="estado" [class]="clase()"
    ><app-icono [nombre]="icono()" [tamano]="16" />{{ texto() }}</span
  >`,
})
export class EstadoDelTurno {
  readonly estado = input.required<EstadoTurno>();

  protected readonly texto = computed(() => NOMBRE_DEL_ESTADO[this.estado()]);
  protected readonly icono = computed(() => ICONO_DEL_ESTADO[this.estado()]);
  protected readonly clase = computed(() => 'estado-' + this.estado());
}

/** Ícono de la acción que lleva un turno a cada estado (DESIGN.md §5): Llegó, Asistió, etc. */
export const ICONO_DE_LA_ACCION: Readonly<Record<EstadoTurno, NombreDeIcono>> = {
  reservado: 'reloj',
  en_espera: 'llego',
  asistio: 'check',
  no_asistio: 'usuario-x',
  anulado: 'prohibido',
};
