import { Component, inject, signal } from '@angular/core';
import {
  Agenda,
  NOMBRE_DEL_ESTADO,
  type EstadoTurno,
  type TurnoPropio,
} from '../nucleo/agenda/agenda';
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
 * cambiar la fecha y con «Actualizar» (el tiempo real es T-32). Ningún dato personal va a la URL ni
 * al almacenamiento del navegador.
 */
@Component({
  selector: 'app-inicio-kinesiologo',
  template: `
    <h1>Mi agenda</h1>

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

  constructor() {
    void this.cargar();
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
