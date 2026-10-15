import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  Agenda,
  ESTADOS,
  NOMBRE_DEL_ESTADO,
  type AccionTurno,
  type EstadoTurno,
  type TurnoDeAgenda,
  type TurnoPendiente,
} from '../nucleo/agenda/agenda';
import {
  Disponibilidad,
  type Bloque,
  type KinesiologoDisponible,
} from '../nucleo/turnos/disponibilidad';
import { normalizarMonto } from '../nucleo/turnos/errores-asignacion';
import { traducirErrorAccion, type ContextoAccion } from '../nucleo/turnos/errores-agenda';
import { Turnos } from '../nucleo/turnos/turnos';
import { Kinesiologos, type Kinesiologo } from '../nucleo/kinesiologos/kinesiologos';
import { IndicadorConexion } from '../nucleo/tiempo-real/indicador-conexion';
import { TiempoReal } from '../nucleo/tiempo-real/tiempo-real';
import { descargarArchivo } from '../nucleo/ui/descargar';
import { enfocar, mensajeDe } from '../nucleo/ui/enfocar';
import { fechaLegible } from './asignar-turno';
import { Dialogo } from './dialogo';
import { VolverAlInicio } from './volver-al-inicio';

/** Acciones que cierran el turno: piden confirmación antes de aplicarse (RF-32, RF-33). */
const CIERRAN_EL_TURNO: readonly EstadoTurno[] = ['no_asistio', 'anulado'];

type TipoDialogo = 'confirmar' | 'corregir' | 'reprogramar' | 'coseguros';

interface DialogoAbierto {
  tipo: TipoDialogo;
  turno: TurnoDeAgenda;
  accion?: AccionTurno;
}

interface MensajeDeTurno {
  tipo: 'ok' | 'error';
  texto: string;
}

interface FranjaElegida {
  kinesiologoId: number;
  kinesiologo: string;
  inicio: string;
  fin: string;
}

/**
 * Agenda de la secretaría (RF-41) para secretaría y administrador. Los botones de cada turno salen
 * de `acciones` que manda la API (RF-34): el cliente no calcula qué corresponde. Ningún dato
 * personal va a la URL ni al almacenamiento del navegador.
 */
@Component({
  selector: 'app-agenda-secretaria',
  imports: [VolverAlInicio, Dialogo, IndicadorConexion],
  template: `
    <app-volver-al-inicio />
    <h1>Agenda de turnos</h1>
    <app-indicador-conexion />

    @if (errorPendientes(); as mensaje) {
      <p class="error" id="error-pendientes" role="alert">{{ mensaje }}</p>
    }
    @if (pendientes().length > 0) {
      <section
        class="aviso"
        id="aviso-pendientes"
        aria-labelledby="titulo-pendientes"
        role="status"
      >
        <h2 id="titulo-pendientes">
          @if (pendientes().length === 1) {
            Hay 1 turno pendiente de marcar
          } @else {
            Hay {{ pendientes().length }} turnos pendientes de marcar
          }
        </h2>
        <p>Son turnos activos cuya hora ya pasó y siguen sin cerrarse.</p>
        <details>
          <summary>Ver los turnos pendientes</summary>
          <ul>
            @for (p of pendientes(); track p.id) {
              <li>
                {{ legible(p.fecha) }} {{ p.horaInicio }}, {{ p.kinesiologoNombre }},
                {{ p.pacienteNombre }}
                <button type="button" class="enlace" (click)="irAPendiente(p)">
                  Ver en la agenda<span class="solo-lectores"> el turno {{ p.id }}</span>
                </button>
              </li>
            }
          </ul>
        </details>
      </section>
    }

    <form class="formulario" novalidate (submit)="$event.preventDefault()">
      <div class="campo">
        <label for="agenda-fecha">Fecha</label>
        <input
          id="agenda-fecha"
          name="fecha"
          type="date"
          [value]="fecha()"
          (change)="cambiarFecha($event)"
        />
      </div>
      <div class="campo">
        <label for="agenda-kinesiologo">Kinesiólogo</label>
        <select id="agenda-kinesiologo" name="kinesiologo" (change)="cambiarKinesiologo($event)">
          <option value="" [selected]="kinesiologoId() === ''">Todos</option>
          @for (k of kinesiologos(); track k.id) {
            <option [value]="k.id" [selected]="kinesiologoId() === '' + k.id">
              {{ k.nombre }}{{ k.activo ? '' : ' (cuenta desactivada)' }}
            </option>
          }
        </select>
      </div>
    </form>

    @if (errorCarga(); as mensaje) {
      <p class="error" id="error-carga" role="alert">{{ mensaje }}</p>
    }

    <section aria-labelledby="titulo-turnos" [attr.aria-busy]="cargando()">
      <h2 id="titulo-turnos">
        Turnos del {{ legible(fecha()) }}
        @if (turnos(); as lista) {
          <span>({{ lista.length }})</span>
        }
      </h2>
      @if (turnos(); as lista) {
        @if (lista.length === 0) {
          <p id="sin-turnos">No hay turnos para esta fecha con el filtro elegido.</p>
        } @else {
          <div class="tabla-contenedor">
            <table class="tabla">
              <caption class="solo-lectores">
                Turnos de la fecha elegida
              </caption>
              <thead>
                <tr>
                  <th scope="col">Franja</th>
                  <th scope="col">Paciente</th>
                  <th scope="col">Kinesiólogo</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Coseguros</th>
                  <th scope="col">Acciones</th>
                </tr>
              </thead>
              <tbody>
                @for (t of lista; track t.id) {
                  <tr [id]="'turno-' + t.id" tabindex="-1" [class.pendiente]="esPendiente(t.id)">
                    <td>{{ t.horaInicio }} a {{ t.horaFin }}</td>
                    <td>
                      <strong>{{ t.paciente.nombre }}</strong
                      ><br />
                      DNI {{ t.paciente.dni }}<br />
                      Tel. {{ t.paciente.telefono }}<br />
                      {{ t.paciente.obraSocial }}
                    </td>
                    <td>{{ t.kinesiologo.nombre }}</td>
                    <td>
                      <span [class.estado-cerrado]="cerrado(t.estado)">{{ estado(t.estado) }}</span>
                      @if (t.horaLlegada; as llegada) {
                        <br />Llegó a las {{ llegada }}
                      }
                      @if (esPendiente(t.id)) {
                        <br /><strong>Pendiente de marcar</strong>
                      }
                    </td>
                    <td>
                      Obra social: {{ monto(t.coseguroObraSocial) }}<br />
                      Adicional: {{ monto(t.coseguroAdicional) }}
                    </td>
                    <td>
                      <div class="acciones">
                        @for (a of t.acciones.transiciones; track a.hacia) {
                          <button
                            type="button"
                            class="boton"
                            [class.peligro]="cierra(a)"
                            [disabled]="trabajando()"
                            [attr.aria-label]="a.accion + ', turno de ' + t.paciente.nombre"
                            (click)="accionar(t, a)"
                          >
                            {{ a.accion }}
                          </button>
                        }
                        @if (t.estado === 'reservado') {
                          <button
                            type="button"
                            class="boton secundario"
                            [disabled]="trabajando()"
                            [attr.aria-label]="'Reprogramar, turno de ' + t.paciente.nombre"
                            (click)="abrir('reprogramar', t)"
                          >
                            Reprogramar
                          </button>
                        }
                        <button
                          type="button"
                          class="boton secundario"
                          [disabled]="trabajando()"
                          [attr.aria-label]="'Coseguros, turno de ' + t.paciente.nombre"
                          (click)="abrir('coseguros', t)"
                        >
                          Coseguros
                        </button>
                        <button
                          type="button"
                          class="boton secundario"
                          [disabled]="trabajando()"
                          [attr.aria-label]="'Descargar ticket, turno de ' + t.paciente.nombre"
                          (click)="descargarTicket(t)"
                        >
                          Ticket (PDF)
                        </button>
                        @if (t.acciones.puedeCorregir) {
                          <button
                            type="button"
                            class="enlace"
                            [disabled]="trabajando()"
                            [attr.aria-label]="'Corregir estado, turno de ' + t.paciente.nombre"
                            (click)="abrir('corregir', t)"
                          >
                            Corregir estado
                          </button>
                        }
                      </div>
                      @if (mensajes()[t.id]; as m) {
                        <p
                          [id]="'mensaje-turno-' + t.id"
                          tabindex="-1"
                          [class.error]="m.tipo === 'error'"
                          [attr.role]="m.tipo === 'error' ? 'alert' : 'status'"
                        >
                          {{ m.texto }}
                        </p>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      }
    </section>

    @if (dialogo(); as d) {
      @switch (d.tipo) {
        @case ('confirmar') {
          <app-dialogo
            [titulo]="'Confirmar: ' + (d.accion?.accion ?? '')"
            (cerrar)="cerrarDialogo()"
          >
            <p id="texto-confirmar">
              Vas a aplicar «{{ d.accion?.accion }}» al turno de {{ d.turno.paciente.nombre }}, el
              {{ legible(d.turno.fecha) }} a las {{ d.turno.horaInicio }}. Cierra el turno: si fue
              un error, después hay que corregirlo.
            </p>
            @if (errorDialogo(); as mensaje) {
              <p class="error" id="error-dialogo" role="alert" tabindex="-1">{{ mensaje }}</p>
            }
            <div class="acciones">
              <button
                type="button"
                class="boton peligro"
                id="confirmar-accion"
                data-foco-inicial
                [disabled]="enviando()"
                (click)="aplicar(d.turno, d.accion!)"
              >
                {{ enviando() ? 'Aplicando…' : 'Sí, ' + (d.accion?.accion ?? '').toLowerCase() }}
              </button>
              <button type="button" class="boton secundario" (click)="cerrarDialogo()">
                Cancelar
              </button>
            </div>
          </app-dialogo>
        }
        @case ('corregir') {
          <app-dialogo titulo="Corregir el estado del turno" (cerrar)="cerrarDialogo()">
            <p class="aviso">
              Esto es una corrección, no el flujo normal: lleva el turno de «{{
                estado(d.turno.estado)
              }}» al estado que elijas y queda registrada. Turno de {{ d.turno.paciente.nombre }},
              el {{ legible(d.turno.fecha) }} a las {{ d.turno.horaInicio }}.
            </p>
            <form class="formulario" novalidate (submit)="corregir($event, d.turno)">
              <fieldset>
                <legend>Estado al que pasa el turno</legend>
                @for (e of estados; track e) {
                  <label>
                    <input
                      type="radio"
                      name="estado-corregido"
                      [value]="e"
                      [disabled]="e === d.turno.estado"
                      [checked]="estadoCorregido() === e"
                      [attr.data-foco-inicial]="e === primerDestino(d.turno) ? '' : null"
                      (change)="estadoCorregido.set(e)"
                    />
                    {{ estado(e) }}{{ e === d.turno.estado ? ' (estado actual)' : '' }}
                  </label>
                }
              </fieldset>
              @if (errorDialogo(); as mensaje) {
                <p class="error" id="error-dialogo" role="alert" tabindex="-1">{{ mensaje }}</p>
              }
              <div class="acciones">
                <button
                  type="submit"
                  class="boton peligro"
                  id="confirmar-correccion"
                  [disabled]="enviando()"
                >
                  {{ enviando() ? 'Corrigiendo…' : 'Corregir estado' }}
                </button>
                <button type="button" class="boton secundario" (click)="cerrarDialogo()">
                  Cancelar
                </button>
              </div>
            </form>
          </app-dialogo>
        }
        @case ('coseguros') {
          <app-dialogo titulo="Coseguros del turno" (cerrar)="cerrarDialogo()">
            <p>
              Turno de {{ d.turno.paciente.nombre }}, el {{ legible(d.turno.fecha) }} a las
              {{ d.turno.horaInicio }}. Dejar un monto vacío lo deja sin cargar.
            </p>
            <form
              class="formulario"
              novalidate
              (submit)="guardarCoseguros($event, d.turno, os, ad)"
            >
              <div class="campo">
                <label for="editar-coseguro-obra-social">Coseguro según obra social</label>
                <input
                  #os
                  id="editar-coseguro-obra-social"
                  type="text"
                  inputmode="decimal"
                  autocomplete="off"
                  data-foco-inicial
                  aria-describedby="ayuda-editar-coseguros"
                  [value]="d.turno.coseguroObraSocial ?? ''"
                  [attr.aria-invalid]="errorDialogo() ? 'true' : null"
                />
              </div>
              <div class="campo">
                <label for="editar-coseguro-adicional">Coseguro adicional</label>
                <input
                  #ad
                  id="editar-coseguro-adicional"
                  type="text"
                  inputmode="decimal"
                  autocomplete="off"
                  aria-describedby="ayuda-editar-coseguros"
                  [value]="d.turno.coseguroAdicional ?? ''"
                  [attr.aria-invalid]="errorDialogo() ? 'true' : null"
                />
                <p id="ayuda-editar-coseguros">Monto en pesos, con hasta dos decimales.</p>
              </div>
              @if (errorDialogo(); as mensaje) {
                <p class="error" id="error-dialogo" role="alert" tabindex="-1">{{ mensaje }}</p>
              }
              <div class="acciones">
                <button type="submit" class="boton" id="guardar-coseguros" [disabled]="enviando()">
                  {{ enviando() ? 'Guardando…' : 'Guardar coseguros' }}
                </button>
                <button type="button" class="boton secundario" (click)="cerrarDialogo()">
                  Cancelar
                </button>
              </div>
            </form>
          </app-dialogo>
        }
        @case ('reprogramar') {
          <app-dialogo titulo="Reprogramar el turno" (cerrar)="cerrarDialogo()">
            <p>
              Turno de {{ d.turno.paciente.nombre }}, reservado para el
              {{ legible(d.turno.fecha) }} a las {{ d.turno.horaInicio }} con
              {{ d.turno.kinesiologo.nombre }}. Se mueve el mismo turno: no cambian su estado ni sus
              coseguros.
            </p>
            <form class="formulario" novalidate (submit)="reprogramar($event, d.turno)">
              <div class="campo">
                <label for="reprogramar-fecha">Nueva fecha</label>
                <input
                  id="reprogramar-fecha"
                  type="date"
                  data-foco-inicial
                  [value]="repFecha()"
                  (change)="cambiarFechaReprogramacion($event, d.turno)"
                />
              </div>
              <fieldset>
                <legend>Bloque</legend>
                <label>
                  <input
                    type="radio"
                    name="reprogramar-bloque"
                    value="manana"
                    [checked]="repBloque() === 'manana'"
                    (change)="cambiarBloqueReprogramacion('manana', d.turno)"
                  />
                  Mañana
                </label>
                <label>
                  <input
                    type="radio"
                    name="reprogramar-bloque"
                    value="tarde"
                    [checked]="repBloque() === 'tarde'"
                    (change)="cambiarBloqueReprogramacion('tarde', d.turno)"
                  />
                  Tarde
                </label>
              </fieldset>
              <div [attr.aria-busy]="repCargando()">
                @if (repLista(); as lista) {
                  @if (lista.length === 0) {
                    <p id="sin-franjas-reprogramar">
                      No hay kinesiólogos que atiendan en ese bloque.
                    </p>
                  } @else if (sinFranjas(lista)) {
                    <p id="sin-franjas-reprogramar">No quedan franjas libres en ese bloque.</p>
                  } @else {
                    @for (k of lista; track k.kinesiologoId) {
                      <fieldset>
                        <legend>{{ k.nombre }}</legend>
                        @if (k.franjas.length === 0) {
                          <p>Sin franjas libres.</p>
                        }
                        @for (f of k.franjas; track f.inicio) {
                          <label>
                            <input
                              type="radio"
                              name="reprogramar-franja"
                              [id]="
                                'rep-franja-' + k.kinesiologoId + '-' + f.inicio.replace(':', '')
                              "
                              [checked]="repEstaElegida(k.kinesiologoId, f.inicio)"
                              (change)="elegirFranja(k, f.inicio, f.fin)"
                            />
                            {{ f.inicio }} a {{ f.fin }}
                          </label>
                        }
                      </fieldset>
                    }
                  }
                }
              </div>
              @if (repAviso(); as mensaje) {
                <p class="aviso" role="status">{{ mensaje }}</p>
              }
              @if (errorDialogo(); as mensaje) {
                <p class="error" id="error-dialogo" role="alert" tabindex="-1">{{ mensaje }}</p>
              }
              <div class="acciones">
                <button
                  type="submit"
                  class="boton"
                  id="confirmar-reprogramacion"
                  [disabled]="enviando() || repCargando()"
                >
                  {{ enviando() ? 'Reprogramando…' : 'Reprogramar turno' }}
                </button>
                <button type="button" class="boton secundario" (click)="cerrarDialogo()">
                  Cancelar
                </button>
              </div>
            </form>
          </app-dialogo>
        }
      }
    }
  `,
})
export class AgendaSecretaria {
  private readonly agenda = inject(Agenda);
  private readonly kinesiologosApi = inject(Kinesiologos);
  private readonly disponibilidad = inject(Disponibilidad);
  private readonly turnosApi = inject(Turnos);
  private cargaActual = 0;
  private disponibilidadActual = 0;

  protected readonly legible = fechaLegible;
  protected readonly estados = ESTADOS;
  protected readonly estado = (e: EstadoTurno) => NOMBRE_DEL_ESTADO[e];

  protected readonly fecha = signal('');
  protected readonly kinesiologoId = signal('');
  protected readonly turnos = signal<TurnoDeAgenda[] | null>(null);
  protected readonly kinesiologos = signal<Kinesiologo[]>([]);
  protected readonly pendientes = signal<TurnoPendiente[]>([]);
  protected readonly cargando = signal(false);
  protected readonly trabajando = signal(false);
  protected readonly errorCarga = signal<string | null>(null);
  protected readonly errorPendientes = signal<string | null>(null);
  protected readonly mensajes = signal<Record<number, MensajeDeTurno>>({});

  protected readonly dialogo = signal<DialogoAbierto | null>(null);
  protected readonly enviando = signal(false);
  protected readonly errorDialogo = signal<string | null>(null);
  protected readonly estadoCorregido = signal<EstadoTurno | null>(null);
  protected readonly repFecha = signal('');
  protected readonly repBloque = signal<Bloque>('manana');
  protected readonly repLista = signal<KinesiologoDisponible[] | null>(null);
  protected readonly repCargando = signal(false);
  protected readonly repSeleccion = signal<FranjaElegida | null>(null);
  protected readonly repAviso = signal<string | null>(null);

  private readonly tiempoReal = inject(TiempoReal);

  constructor() {
    void this.iniciar();
    const destruccion = inject(DestroyRef);
    this.tiempoReal
      .cambios<TurnoDeAgenda>()
      .pipe(takeUntilDestroyed(destruccion))
      .subscribe((turno) => this.aplicarCambio(turno));
    this.tiempoReal.quitado$
      .pipe(takeUntilDestroyed(destruccion))
      .subscribe((id) => this.quitar(id));
    this.tiempoReal.reconectado$
      .pipe(takeUntilDestroyed(destruccion))
      .subscribe(() => void this.refrescar());
  }

  /**
   * `turno:cambio` (RF-44): reemplaza o agrega el turno si es de la fecha y del kinesiólogo que se
   * miran; si no, lo saca. Las acciones disponibles vienen en el turno que manda el servidor.
   */
  private aplicarCambio(turno: TurnoDeAgenda): void {
    const actuales = this.turnos();
    if (actuales === null) return;
    const filtro = this.kinesiologoId();
    const corresponde =
      turno.fecha === this.fecha() && (filtro === '' || turno.kinesiologo.id === Number(filtro));
    const resto = actuales.filter((t) => t.id !== turno.id);
    if (corresponde) resto.push(turno);
    resto.sort(
      (a, b) =>
        a.horaInicio.localeCompare(b.horaInicio) ||
        a.kinesiologo.nombre.localeCompare(b.kinesiologo.nombre) ||
        a.id - b.id,
    );
    this.turnos.set(resto);
    void this.cargarPendientes();
  }

  /** `turno:quitado`: el turno ya no corresponde a esta agenda. */
  private quitar(turnoId: number): void {
    const actuales = this.turnos();
    if (actuales === null) return;
    this.turnos.set(actuales.filter((t) => t.id !== turnoId));
  }

  private async iniciar(): Promise<void> {
    void this.cargarKinesiologos();
    await Promise.all([this.cargar(), this.cargarPendientes()]);
  }

  private async cargarKinesiologos(): Promise<void> {
    try {
      this.kinesiologos.set(await this.kinesiologosApi.listar());
    } catch (error) {
      this.errorCarga.set(mensajeDe(error));
    }
  }

  /** Lee la agenda de la fecha y el kinesiólogo vigentes; sin fecha, la API usa hoy. */
  private async cargar(): Promise<void> {
    const numero = ++this.cargaActual;
    this.cargando.set(true);
    this.errorCarga.set(null);
    try {
      const filtro = this.kinesiologoId();
      const dia = await this.agenda.consultar(
        this.fecha() || undefined,
        filtro === '' ? undefined : Number(filtro),
      );
      if (numero !== this.cargaActual) return;
      this.fecha.set(dia.fecha);
      this.turnos.set(dia.turnos);
    } catch (error) {
      if (numero !== this.cargaActual) return;
      this.errorCarga.set(mensajeDe(error));
      enfocar('error-carga');
    } finally {
      if (numero === this.cargaActual) this.cargando.set(false);
    }
  }

  private async cargarPendientes(): Promise<void> {
    try {
      this.pendientes.set((await this.agenda.pendientes()).turnos);
      this.errorPendientes.set(null);
    } catch (error) {
      this.errorPendientes.set(
        'No se pudo consultar los turnos pendientes de marcar. ' + mensajeDe(error),
      );
    }
  }

  /** Vuelve a leer agenda y pendientes tras una acción o un conflicto. */
  private async refrescar(): Promise<void> {
    await Promise.all([this.cargar(), this.cargarPendientes()]);
  }

  protected esPendiente(id: number): boolean {
    return this.pendientes().some((p) => p.id === id);
  }

  protected cerrado(e: EstadoTurno): boolean {
    return e === 'asistio' || e === 'no_asistio' || e === 'anulado';
  }

  protected cierra(a: AccionTurno): boolean {
    return CIERRAN_EL_TURNO.includes(a.hacia);
  }

  protected monto(valor: string | null): string {
    return valor === null ? 'sin cargar' : '$ ' + valor;
  }

  protected async cambiarFecha(evento: Event): Promise<void> {
    this.fecha.set((evento.target as HTMLInputElement).value);
    this.mensajes.set({});
    await this.cargar();
  }

  protected async cambiarKinesiologo(evento: Event): Promise<void> {
    this.kinesiologoId.set((evento.target as HTMLSelectElement).value);
    this.mensajes.set({});
    await this.cargar();
  }

  /** Lleva la agenda a la fecha del turno pendiente, sin filtro, y deja el foco en su fila (RF-42). */
  protected async irAPendiente(p: TurnoPendiente): Promise<void> {
    this.kinesiologoId.set('');
    this.fecha.set(p.fecha);
    this.mensajes.set({});
    await this.cargar();
    enfocar('turno-' + p.id);
  }

  // Acciones del flujo (RF-30 a RF-33)

  protected accionar(turno: TurnoDeAgenda, accion: AccionTurno): void {
    if (this.cierra(accion)) {
      this.abrir('confirmar', turno, accion);
    } else {
      void this.aplicar(turno, accion);
    }
  }

  protected async aplicar(turno: TurnoDeAgenda, accion: AccionTurno): Promise<void> {
    await this.escribir(
      turno,
      'transicion',
      () => this.turnosApi.transicionar(turno.id, accion.hacia),
      `Listo: el turno pasó a «${NOMBRE_DEL_ESTADO[accion.hacia]}».`,
    );
  }

  protected async corregir(evento: Event, turno: TurnoDeAgenda): Promise<void> {
    evento.preventDefault();
    const destino = this.estadoCorregido();
    if (!destino) {
      this.errorDialogo.set('Elegí el estado al que pasa el turno.');
      enfocar('error-dialogo');
      return;
    }
    await this.escribir(
      turno,
      'correccion',
      () => this.turnosApi.corregir(turno.id, destino),
      `Corregido: el turno pasó a «${NOMBRE_DEL_ESTADO[destino]}».`,
    );
  }

  protected primerDestino(turno: TurnoDeAgenda): EstadoTurno {
    return ESTADOS.find((e) => e !== turno.estado) ?? 'reservado';
  }

  protected async guardarCoseguros(
    evento: Event,
    turno: TurnoDeAgenda,
    obraSocial: HTMLInputElement,
    adicional: HTMLInputElement,
  ): Promise<void> {
    evento.preventDefault();
    const montoOS = normalizarMonto(obraSocial.value);
    const montoAd = normalizarMonto(adicional.value);
    if (montoOS === null || montoAd === null) {
      this.errorDialogo.set(
        'Los coseguros deben ser montos en pesos, con hasta dos decimales (por ejemplo 1500 o 1500,50).',
      );
      enfocar('error-dialogo');
      return;
    }
    await this.escribir(
      turno,
      'coseguros',
      () =>
        this.turnosApi.modificarCoseguros(turno.id, {
          coseguroObraSocial: montoOS ?? null,
          coseguroAdicional: montoAd ?? null,
        }),
      'Coseguros guardados.',
    );
  }

  // Reprogramación (RF-36, RF-37)

  protected sinFranjas(lista: KinesiologoDisponible[]): boolean {
    return lista.every((k) => k.franjas.length === 0);
  }

  protected repEstaElegida(kinesiologoId: number, inicio: string): boolean {
    const s = this.repSeleccion();
    return s !== null && s.kinesiologoId === kinesiologoId && s.inicio === inicio;
  }

  protected elegirFranja(k: KinesiologoDisponible, inicio: string, fin: string): void {
    this.errorDialogo.set(null);
    this.repAviso.set(null);
    this.repSeleccion.set({ kinesiologoId: k.kinesiologoId, kinesiologo: k.nombre, inicio, fin });
  }

  protected async cambiarFechaReprogramacion(evento: Event, turno: TurnoDeAgenda): Promise<void> {
    this.repFecha.set((evento.target as HTMLInputElement).value);
    await this.cargarDisponibilidad(turno);
  }

  protected async cambiarBloqueReprogramacion(bloque: Bloque, turno: TurnoDeAgenda): Promise<void> {
    this.repBloque.set(bloque);
    await this.cargarDisponibilidad(turno);
  }

  /**
   * Pide la disponibilidad con el `pacienteId` del turno, para no ofrecer horas en que el paciente
   * ya tiene otro turno (RF-25, RF-37).
   */
  private async cargarDisponibilidad(turno: TurnoDeAgenda): Promise<void> {
    const fecha = this.repFecha();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      this.repLista.set(null);
      this.repSeleccion.set(null);
      return;
    }
    const numero = ++this.disponibilidadActual;
    this.repCargando.set(true);
    try {
      const lista = await this.disponibilidad.consultar(fecha, this.repBloque(), turno.paciente.id);
      if (numero !== this.disponibilidadActual) return;
      this.repLista.set(lista);
      const s = this.repSeleccion();
      const sigueLibre =
        s === null ||
        lista.some(
          (k) =>
            k.kinesiologoId === s.kinesiologoId && k.franjas.some((f) => f.inicio === s.inicio),
        );
      if (!sigueLibre) {
        this.repSeleccion.set(null);
        this.repAviso.set('La franja que habías elegido ya no está libre. Elegí otra.');
      }
    } catch (error) {
      if (numero !== this.disponibilidadActual) return;
      this.repLista.set(null);
      this.repSeleccion.set(null);
      this.errorDialogo.set(mensajeDe(error));
      enfocar('error-dialogo');
    } finally {
      if (numero === this.disponibilidadActual) this.repCargando.set(false);
    }
  }

  protected async reprogramar(evento: Event, turno: TurnoDeAgenda): Promise<void> {
    evento.preventDefault();
    const s = this.repSeleccion();
    if (!s) {
      this.errorDialogo.set('Falta elegir una franja libre.');
      enfocar('error-dialogo');
      return;
    }
    await this.escribir(
      turno,
      'reprogramacion',
      () =>
        this.turnosApi.reprogramar(turno.id, {
          kinesiologoId: s.kinesiologoId,
          fecha: this.repFecha(),
          horaInicio: s.inicio,
        }),
      `Reprogramado: ahora es el ${fechaLegible(this.repFecha())} a las ${s.inicio}, con ${s.kinesiologo}. El ticket vigente se descarga desde el turno.`,
    );
  }

  // Ticket (RF-28)

  protected async descargarTicket(turno: TurnoDeAgenda): Promise<void> {
    if (this.trabajando()) return;
    this.ponerMensaje(turno.id, null);
    this.trabajando.set(true);
    try {
      descargarArchivo(await this.turnosApi.descargarTicket(turno.id), `turno-${turno.id}.pdf`);
    } catch (error) {
      this.ponerMensaje(turno.id, {
        tipo: 'error',
        texto: traducirErrorAccion(error, 'ticket').mensaje,
      });
      enfocar('mensaje-turno-' + turno.id);
    } finally {
      this.trabajando.set(false);
    }
  }

  // Escritura común y diálogos

  /**
   * Aplica una escritura sobre un turno. Si sale bien, cierra el diálogo, deja un aviso en el turno y
   * vuelve a leer la agenda. Si falla, traduce el error y, cuando el turno quedó desactualizado
   * (`turno_modificado`, `transicion_no_permitida`…), avisa en el turno y vuelve a leer la agenda.
   */
  private async escribir(
    turno: TurnoDeAgenda,
    contexto: ContextoAccion,
    operacion: () => Promise<unknown>,
    exito: string,
  ): Promise<void> {
    if (this.enviando() || this.trabajando()) return;
    this.errorDialogo.set(null);
    this.ponerMensaje(turno.id, null);
    this.enviando.set(true);
    this.trabajando.set(true);
    try {
      await operacion();
      this.cerrarDialogo();
      this.ponerMensaje(turno.id, { tipo: 'ok', texto: exito });
      await this.refrescar();
    } catch (error) {
      const t = traducirErrorAccion(error, contexto);
      if (t.cerrar || this.dialogo() === null) {
        this.cerrarDialogo();
        this.ponerMensaje(turno.id, { tipo: 'error', texto: t.mensaje });
        enfocar('mensaje-turno-' + turno.id);
      } else {
        this.errorDialogo.set(t.mensaje);
        enfocar('error-dialogo');
      }
      this.enviando.set(false);
      this.trabajando.set(false);
      const lecturas: Promise<void>[] = [];
      if (t.refrescarAgenda) lecturas.push(this.refrescar());
      if (t.refrescarDisponibilidad && this.dialogo())
        lecturas.push(this.cargarDisponibilidad(turno));
      await Promise.all(lecturas);
    } finally {
      this.enviando.set(false);
      this.trabajando.set(false);
    }
  }

  private ponerMensaje(id: number, mensaje: MensajeDeTurno | null): void {
    this.mensajes.update((actuales) => {
      const copia = { ...actuales };
      if (mensaje) copia[id] = mensaje;
      else delete copia[id];
      return copia;
    });
  }

  protected abrir(tipo: TipoDialogo, turno: TurnoDeAgenda, accion?: AccionTurno): void {
    this.errorDialogo.set(null);
    this.enviando.set(false);
    this.estadoCorregido.set(null);
    this.repSeleccion.set(null);
    this.repAviso.set(null);
    this.repLista.set(null);
    this.dialogo.set({ tipo, turno, accion });
    if (tipo === 'reprogramar') {
      this.repFecha.set(turno.fecha);
      this.repBloque.set('manana');
      void this.cargarDisponibilidad(turno);
    }
  }

  protected cerrarDialogo(): void {
    this.disponibilidadActual++;
    this.repCargando.set(false);
    this.errorDialogo.set(null);
    this.dialogo.set(null);
  }
}
