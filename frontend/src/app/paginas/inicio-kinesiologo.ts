import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  Agenda,
  NOMBRE_DEL_ESTADO,
  type EstadoTurno,
  type TurnoPropio,
} from '../nucleo/agenda/agenda';
import { IndicadorConexion } from '../nucleo/tiempo-real/indicador-conexion';
import { TiempoReal } from '../nucleo/tiempo-real/tiempo-real';
import { enfocar, mensajeDe } from '../nucleo/ui/enfocar';
import { fechaLegible } from './asignar-turno';

/** Ordena la espera por hora de llegada (RF-40); a igual llegada, por franja. 'HH:MM' ordena como texto. */
export function ordenarEspera(turnos: readonly TurnoPropio[]): TurnoPropio[] {
  return [...turnos].sort(
    (a, b) =>
      (a.horaLlegada ?? '99:99').localeCompare(b.horaLlegada ?? '99:99') ||
      a.horaInicio.localeCompare(b.horaInicio) ||
      a.id - b.id,
  );
}

/** Ordena los próximos por franja. */
export function ordenarProximos(turnos: readonly TurnoPropio[]): TurnoPropio[] {
  return [...turnos].sort((a, b) => a.horaInicio.localeCompare(b.horaInicio) || a.id - b.id);
}

/**
 * Agenda del kinesiólogo (RF-40): sus pacientes en espera, por hora de llegada, y sus próximos
 * turnos de la fecha elegida. Es de solo lectura (D-15, RF-34): no hay botones de estado, ni
 * corrección, ni ticket, ni enlaces a la ficha del paciente ni a agendas ajenas (D-16). El
 * kinesiólogo sale de la sesión: la consulta no lleva ningún identificador. Se carga al entrar, al
 * cambiar la fecha, con «Actualizar» y en vivo por tiempo real (RF-43): los eventos reemplazan el
 * turno, y al reconectar se vuelve a pedir la agenda completa (RF-45). Ningún dato personal va a la URL ni
 * al almacenamiento del navegador.
 */
@Component({
  selector: 'app-inicio-kinesiologo',
  imports: [IndicadorConexion],
  template: `
    <h1>Mi agenda</h1>
    <app-indicador-conexion />

    <form class="formulario" novalidate (submit)="$event.preventDefault()">
      <div class="campo">
        <label for="mi-agenda-fecha">Fecha</label>
        <input
          id="mi-agenda-fecha"
          name="fecha"
          type="date"
          [value]="fecha()"
          (change)="cambiarFecha($event)"
        />
      </div>
      <div class="acciones">
        <button
          type="button"
          class="boton secundario"
          id="actualizar"
          [disabled]="cargando()"
          (click)="cargar()"
        >
          {{ cargando() ? 'Actualizando…' : 'Actualizar' }}
        </button>
      </div>
    </form>

    @if (error(); as mensaje) {
      <p class="error" id="error-carga" role="alert" tabindex="-1">{{ mensaje }}</p>
    }

    @if (agenda(); as a) {
      <section aria-labelledby="titulo-espera" [attr.aria-busy]="cargando()">
        <h2 id="titulo-espera">En espera ({{ a.enEspera.length }})</h2>
        @if (a.enEspera.length === 0) {
          <p id="sin-espera">No hay pacientes en espera el {{ legible(a.fecha) }}.</p>
        } @else {
          <div class="tabla-contenedor">
            <table class="tabla" id="tabla-espera">
              <caption class="solo-lectores">
                Pacientes en espera, por hora de llegada
              </caption>
              <thead>
                <tr>
                  <th scope="col">Llegó</th>
                  <th scope="col">Franja</th>
                  <th scope="col">Paciente</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Coseguros</th>
                </tr>
              </thead>
              <tbody>
                @for (t of a.enEspera; track t.id) {
                  <tr>
                    <td>{{ t.horaLlegada ?? 'sin dato' }}</td>
                    <td>{{ t.horaInicio }} a {{ t.horaFin }}</td>
                    <td>
                      <strong>{{ t.paciente.nombre }}</strong
                      ><br />
                      DNI {{ t.paciente.dni }}<br />
                      Tel. {{ t.paciente.telefono }}<br />
                      {{ t.paciente.obraSocial }}
                    </td>
                    <td>{{ estado(t.estado) }}</td>
                    <td>
                      Obra social: {{ monto(t.coseguroObraSocial) }}<br />
                      Adicional: {{ monto(t.coseguroAdicional) }}
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </section>

      <section aria-labelledby="titulo-proximos" [attr.aria-busy]="cargando()">
        <h2 id="titulo-proximos">Próximos ({{ a.proximos.length }})</h2>
        @if (a.proximos.length === 0) {
          <p id="sin-proximos">No hay turnos próximos el {{ legible(a.fecha) }}.</p>
        } @else {
          <div class="tabla-contenedor">
            <table class="tabla" id="tabla-proximos">
              <caption class="solo-lectores">
                Próximos turnos, por franja
              </caption>
              <thead>
                <tr>
                  <th scope="col">Franja</th>
                  <th scope="col">Paciente</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Coseguros</th>
                </tr>
              </thead>
              <tbody>
                @for (t of a.proximos; track t.id) {
                  <tr>
                    <td>{{ t.horaInicio }} a {{ t.horaFin }}</td>
                    <td>
                      <strong>{{ t.paciente.nombre }}</strong
                      ><br />
                      DNI {{ t.paciente.dni }}<br />
                      Tel. {{ t.paciente.telefono }}<br />
                      {{ t.paciente.obraSocial }}
                    </td>
                    <td>{{ estado(t.estado) }}</td>
                    <td>
                      Obra social: {{ monto(t.coseguroObraSocial) }}<br />
                      Adicional: {{ monto(t.coseguroAdicional) }}
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </section>
    } @else if (cargando()) {
      <p role="status">Cargando tu agenda…</p>
    }
  `,
})
export class InicioKinesiologo {
  private readonly servicio = inject(Agenda);
  private cargaActual = 0;

  protected readonly legible = fechaLegible;
  protected readonly estado = (e: EstadoTurno) => NOMBRE_DEL_ESTADO[e];

  protected readonly fecha = signal('');
  protected readonly agenda = signal<{
    fecha: string;
    enEspera: TurnoPropio[];
    proximos: TurnoPropio[];
  } | null>(null);
  protected readonly cargando = signal(false);
  protected readonly error = signal<string | null>(null);

  private readonly tiempoReal = inject(TiempoReal);

  constructor() {
    void this.cargar();
    const destruccion = inject(DestroyRef);
    this.tiempoReal
      .cambios<TurnoPropio>()
      .pipe(takeUntilDestroyed(destruccion))
      .subscribe((turno) => this.aplicarCambio(turno));
    this.tiempoReal.quitado$
      .pipe(takeUntilDestroyed(destruccion))
      .subscribe((id) => this.quitar(id));
    this.tiempoReal.reconectado$
      .pipe(takeUntilDestroyed(destruccion))
      .subscribe(() => void this.cargar());
  }

  /**
   * `turno:cambio`: el turno completo y actual. Se saca de donde estaba y se pone donde le toca:
   * `en_espera` a la espera, por hora de llegada (RF-43), `reservado` a próximos; los demás estados
   * y los de otra fecha no se muestran. Las dos listas siguen el mismo orden que la API (RF-40).
   */
  private aplicarCambio(turno: TurnoPropio): void {
    const actual = this.agenda();
    if (!actual) return;
    const enEspera = actual.enEspera.filter((t) => t.id !== turno.id);
    const proximos = actual.proximos.filter((t) => t.id !== turno.id);
    if (turno.fecha === actual.fecha) {
      if (turno.estado === 'en_espera') enEspera.push(turno);
      else if (turno.estado === 'reservado') proximos.push(turno);
    }
    this.agenda.set({
      fecha: actual.fecha,
      enEspera: ordenarEspera(enEspera),
      proximos: ordenarProximos(proximos),
    });
  }

  /** `turno:quitado`: el turno pasó a otro kinesiólogo; se saca sin esperar datos. */
  private quitar(turnoId: number): void {
    const actual = this.agenda();
    if (!actual) return;
    this.agenda.set({
      ...actual,
      enEspera: actual.enEspera.filter((t) => t.id !== turnoId),
      proximos: actual.proximos.filter((t) => t.id !== turnoId),
    });
  }

  protected monto(valor: string | null): string {
    return valor === null ? 'sin cargar' : '$ ' + valor;
  }

  protected async cambiarFecha(evento: Event): Promise<void> {
    this.fecha.set((evento.target as HTMLInputElement).value);
    await this.cargar();
  }

  /** Lee la agenda de la fecha elegida; sin fecha, la API usa hoy en la zona del consultorio. */
  protected async cargar(): Promise<void> {
    const numero = ++this.cargaActual;
    this.cargando.set(true);
    this.error.set(null);
    try {
      const dia = await this.servicio.miAgenda(this.fecha() || undefined);
      if (numero !== this.cargaActual) return;
      this.fecha.set(dia.fecha);
      this.agenda.set({
        fecha: dia.fecha,
        enEspera: ordenarEspera(dia.enEspera),
        proximos: ordenarProximos(dia.proximos),
      });
    } catch (error) {
      if (numero !== this.cargaActual) return;
      this.error.set(mensajeDe(error));
      enfocar('error-carga');
    } finally {
      if (numero === this.cargaActual) this.cargando.set(false);
    }
  }
}
