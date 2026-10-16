import { Component, computed, inject, signal } from '@angular/core';
import { normalizarDni } from '../nucleo/pacientes/dni';
import { Pacientes, type DatosPaciente, type Paciente } from '../nucleo/pacientes/pacientes';
import {
  Disponibilidad,
  type Bloque,
  type KinesiologoDisponible,
} from '../nucleo/turnos/disponibilidad';
import { normalizarMonto, traducirErrorAsignacion } from '../nucleo/turnos/errores-asignacion';
import { Turnos, type TurnoAsignado } from '../nucleo/turnos/turnos';
import { descargarArchivo } from '../nucleo/ui/descargar';
import { enfocar, mensajeDe } from '../nucleo/ui/enfocar';
import {
  FormularioPaciente,
  enfocarPrimerError,
  erroresDeCampo,
  type ErroresPaciente,
} from './formulario-paciente';
import { VolverAlInicio } from './volver-al-inicio';
import { Icono } from '../nucleo/ui/icono';
import { PacienteTarjeta } from '../nucleo/ui/paciente-tarjeta';

interface Consulta {
  fecha: string;
  bloque: Bloque;
}

interface Seleccion {
  kinesiologoId: number;
  kinesiologo: string;
  inicio: string;
  fin: string;
}

interface Asignado {
  turno: TurnoAsignado;
  seleccion: Seleccion;
  paciente: string;
}

type Paso = 1 | 2 | 3 | 4;

/** Los cuatro pasos del asistente, en orden (DESIGN.md §6.1). */
const PASOS: readonly { numero: Paso; titulo: string }[] = [
  { numero: 1, titulo: 'Paciente' },
  { numero: 2, titulo: 'Fecha y bloque' },
  { numero: 3, titulo: 'Kinesiólogo y franja' },
  { numero: 4, titulo: 'Coseguro abonado y confirmación' },
];

const FORMATO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** 'AAAA-MM-DD' a 'DD/MM/AAAA'. */
export function fechaLegible(fecha: string): string {
  const [anio, mes, dia] = fecha.split('-');
  return `${dia}/${mes}/${anio}`;
}

/** Sábado o domingo (RF-15): el consultorio no agenda esos días. */
export function esFinDeSemana(fecha: string): boolean {
  const dia = new Date(`${fecha}T00:00:00Z`).getUTCDay();
  return dia === 0 || dia === 6;
}

/**
 * Asignación de turnos (RF-19, RF-22 a RF-28) para secretaría y administrador, como asistente por
 * pasos (DESIGN.md §6.1): 1. paciente por DNI (o su alta en el mismo paso), 2. fecha y bloque,
 * 3. kinesiólogo y franja libre, 4. coseguro abonado y confirmación. Con el paciente ya elegido, la
 * disponibilidad se pide con su `pacienteId` para no ofrecer una franja que ya tiene ocupada
 * (RF-25). Si cambia el paciente, la fecha o el bloque, la franja elegida se descarta y se avisa.
 * Ningún dato personal va a la URL ni al almacenamiento del navegador.
 */
@Component({
  selector: 'app-asignar-turno',
  imports: [VolverAlInicio, FormularioPaciente, Icono, PacienteTarjeta],
  template: `
    <app-volver-al-inicio />
    <h1>Asignar turno</h1>

    @if (asignado(); as a) {
      <section class="tarjeta ancha" aria-labelledby="titulo-asignado">
        <h2 id="titulo-asignado" tabindex="-1">Turno asignado</h2>
        <p role="status">
          Turno número {{ a.turno.id }} para {{ a.paciente }}, con {{ a.seleccion.kinesiologo }}, el
          {{ legible(a.turno.fecha) }} a las {{ a.turno.horaInicio }}.
        </p>
        @if (errorTicket(); as mensaje) {
          <p class="error" id="error-ticket" role="alert" tabindex="-1">
            <app-icono nombre="alerta" />{{ mensaje }}
          </p>
        }
        <div class="acciones">
          <button
            type="button"
            class="boton"
            id="descargar-ticket"
            [disabled]="descargando()"
            (click)="descargarTicket(a.turno.id)"
          >
            <app-icono nombre="ticket" />{{
              descargando() ? 'Descargando…' : 'Descargar ticket (PDF)'
            }}
          </button>
          <button type="button" class="boton secundario" id="asignar-otro" (click)="reiniciar()">
            <app-icono nombre="asignar" />Asignar otro turno
          </button>
        </div>
      </section>
    } @else {
      <nav aria-label="Pasos de la asignación">
        <ol class="pasos" id="pasos">
          @for (p of pasos; track p.numero) {
            <li [class.actual]="paso() === p.numero" [class.completo]="paso() > p.numero">
              @if (paso() > p.numero) {
                <button type="button" class="enlace" (click)="irA(p.numero)">
                  <app-icono nombre="check" [tamano]="16" />{{ p.numero }}. {{ p.titulo }}
                </button>
              } @else {
                <span [attr.aria-current]="paso() === p.numero ? 'step' : null"
                  >{{ p.numero }}. {{ p.titulo }}</span
                >
              }
            </li>
          }
        </ol>
        <p class="pasos-corto" id="pasos-corto">Paso {{ paso() }} de 4 · {{ tituloDelPaso() }}</p>
      </nav>

      <div class="asistente">
        <section class="tarjeta ancha asistente-paso" aria-labelledby="titulo-paso">
          @switch (paso()) {
            @case (1) {
              <h2 id="titulo-paso" tabindex="-1">1. Paciente</h2>
              @if (errorPaciente(); as mensaje) {
                <p class="error" id="error-paciente" role="alert" tabindex="-1">
                  <app-icono nombre="alerta" />{{ mensaje }}
                </p>
              }
              @if (paciente(); as p) {
                <div id="paciente-elegido" role="status">
                  <app-paciente-tarjeta [paciente]="p">
                    <button
                      type="button"
                      class="boton secundario"
                      id="cambiar-paciente"
                      (click)="cambiarPaciente()"
                    >
                      Cambiar paciente
                    </button>
                  </app-paciente-tarjeta>
                </div>
              } @else {
                <form class="formulario" novalidate (submit)="buscarPaciente($event, dni)">
                  <div class="campo">
                    <label for="dni-turno">DNI del paciente</label>
                    <input
                      #dni
                      id="dni-turno"
                      name="dni"
                      type="text"
                      inputmode="numeric"
                      autocomplete="off"
                      [attr.aria-invalid]="errorDni() ? 'true' : null"
                      [attr.aria-describedby]="errorDni() ? 'error-dni-turno' : null"
                    />
                    @if (errorDni(); as mensaje) {
                      <p class="error" id="error-dni-turno">
                        <app-icono nombre="alerta" />{{ mensaje }}
                      </p>
                    }
                  </div>
                  <div class="acciones">
                    <button type="submit" class="boton secundario" [disabled]="buscando()">
                      <app-icono nombre="buscar" />{{
                        buscando() ? 'Buscando…' : 'Buscar paciente'
                      }}
                    </button>
                  </div>
                </form>
                @if (dniSinResultados(); as sinPaciente) {
                  <div id="sin-paciente" tabindex="-1">
                    <p class="info" role="status">
                      <app-icono nombre="info" />No hay ningún paciente con el DNI
                      {{ sinPaciente }}.
                    </p>
                    @if (!alta()) {
                      <button
                        type="button"
                        class="boton secundario"
                        id="ofrecer-alta"
                        (click)="abrirAlta(sinPaciente)"
                      >
                        <app-icono nombre="usuario" />Dar de alta con este DNI
                      </button>
                    }
                  </div>
                }
                @if (alta(); as precarga) {
                  <h3>Nuevo paciente</h3>
                  <app-formulario-paciente
                    etiqueta="Crear paciente y elegirlo"
                    [inicial]="precarga"
                    [ocupado]="creando()"
                    [cancelable]="true"
                    [erroresServidor]="erroresAlta()"
                    (guardar)="crearPaciente($event)"
                    (cancelar)="cerrarAlta()"
                  />
                }
              }
              <div class="asistente-botones">
                <button
                  type="button"
                  class="boton"
                  id="siguiente"
                  [disabled]="!paciente()"
                  (click)="irAPaso(2)"
                >
                  Siguiente<app-icono nombre="siguiente" />
                </button>
              </div>
            }
            @case (2) {
              <h2 id="titulo-paso" tabindex="-1">2. Fecha y bloque</h2>
              <form class="formulario" novalidate (submit)="elegirFechaYBloque($event)">
                <div class="campo">
                  <label for="fecha-turno">Fecha</label>
                  <input
                    id="fecha-turno"
                    name="fecha"
                    type="date"
                    [value]="fechaElegida()"
                    (input)="fechaElegida.set($any($event.target).value)"
                    [attr.aria-invalid]="errorFecha() ? 'true' : null"
                    [attr.aria-describedby]="errorFecha() ? 'error-fecha-turno' : null"
                  />
                  @if (errorFecha(); as mensaje) {
                    <p class="error" id="error-fecha-turno">
                      <app-icono nombre="alerta" />{{ mensaje }}
                    </p>
                  }
                </div>
                <fieldset>
                  <legend>Bloque</legend>
                  <label>
                    <input
                      type="radio"
                      name="bloque"
                      value="manana"
                      [checked]="bloque() === 'manana'"
                      (change)="bloque.set('manana')"
                    />
                    Mañana
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="bloque"
                      value="tarde"
                      [checked]="bloque() === 'tarde'"
                      (change)="bloque.set('tarde')"
                    />
                    Tarde
                  </label>
                </fieldset>
                <div class="asistente-botones">
                  <button type="button" class="boton secundario" id="atras" (click)="atras()">
                    <app-icono nombre="volver" />Atrás
                  </button>
                  <button
                    type="submit"
                    class="boton"
                    id="siguiente"
                    [disabled]="!fechaValida() || cargando()"
                  >
                    Siguiente<app-icono nombre="siguiente" />
                  </button>
                </div>
              </form>
            }
            @case (3) {
              <h2 id="titulo-paso" tabindex="-1" [attr.aria-busy]="cargando()">
                3. Kinesiólogo y franja
              </h2>
              @if (consulta(); as c) {
                <p>
                  {{ legible(c.fecha) }}, {{ c.bloque === 'manana' ? 'mañana' : 'tarde' }}. Sin las
                  horas en que el paciente ya tiene turno.
                </p>
              }
              @if (errorFranja(); as mensaje) {
                <p class="error" id="error-franja" role="alert" tabindex="-1">
                  <app-icono nombre="alerta" />{{ mensaje }}
                </p>
              }
              @if (avisoFranja(); as mensaje) {
                <p class="aviso" id="aviso-franja" role="status">
                  <app-icono nombre="alerta" />{{ mensaje }}
                </p>
              }
              @if (errorDisponibilidad(); as mensaje) {
                <p class="error" id="error-disponibilidad" role="alert" tabindex="-1">
                  <app-icono nombre="alerta" />
                  {{ mensaje }}
                </p>
              }
              <form class="formulario" novalidate (submit)="avanzarDesdeFranja($event)">
                @if (kinesiologos(); as lista) {
                  @if (consulta(); as c) {
                    @if (esFinDeSemana(c.fecha)) {
                      <p id="sin-franjas">
                        Los sábados y domingos no hay turnos. Elegí un día de lunes a viernes.
                      </p>
                    } @else if (lista.length === 0) {
                      <p id="sin-franjas">No hay kinesiólogos que atiendan en ese bloque.</p>
                    } @else if (sinFranjas(lista)) {
                      <p id="sin-franjas">No quedan franjas libres en ese bloque.</p>
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
                                name="franja"
                                [id]="'franja-' + k.kinesiologoId + '-' + f.inicio.replace(':', '')"
                                [disabled]="cargando()"
                                [checked]="estaElegida(k.kinesiologoId, f.inicio)"
                                (change)="elegirFranja(k, f.inicio, f.fin)"
                              />
                              {{ f.inicio }} a {{ f.fin }}
                            </label>
                          }
                        </fieldset>
                      }
                    }
                  }
                } @else if (cargando()) {
                  <p role="status">Buscando la disponibilidad…</p>
                }
                <div class="asistente-botones">
                  <button type="button" class="boton secundario" id="atras" (click)="atras()">
                    <app-icono nombre="volver" />Atrás
                  </button>
                  <button
                    type="submit"
                    class="boton"
                    id="siguiente"
                    [disabled]="!seleccion() || cargando()"
                  >
                    Siguiente<app-icono nombre="siguiente" />
                  </button>
                </div>
              </form>
            }
            @case (4) {
              <h2 id="titulo-paso" tabindex="-1">4. Coseguro abonado y confirmación</h2>
              <form class="formulario" novalidate (submit)="confirmar($event, coseguroAbonado)">
                <div class="campo">
                  <label for="coseguro-abonado">Coseguro abonado (opcional)</label>
                  <input
                    #coseguroAbonado
                    id="coseguro-abonado"
                    name="coseguroAbonado"
                    type="text"
                    inputmode="decimal"
                    autocomplete="off"
                    aria-describedby="ayuda-coseguros"
                    [value]="abonoTexto()"
                    (input)="abonoTexto.set(coseguroAbonado.value)"
                    [attr.aria-invalid]="errorCoseguros() ? 'true' : null"
                  />
                  <p id="ayuda-coseguros">
                    Monto en pesos, con hasta dos decimales. Se puede cargar después.
                  </p>
                  @if (errorCoseguros(); as mensaje) {
                    <p class="error" id="error-coseguros" role="alert" tabindex="-1">
                      <app-icono nombre="alerta" />{{ mensaje }}
                    </p>
                  }
                </div>
                @if (errorConfirmar(); as mensaje) {
                  <p class="error" id="error-confirmar" role="alert" tabindex="-1">
                    <app-icono nombre="alerta" />{{ mensaje }}
                  </p>
                }
                <div class="asistente-botones">
                  <button type="button" class="boton secundario" id="atras" (click)="atras()">
                    <app-icono nombre="volver" />Atrás
                  </button>
                  <button
                    type="submit"
                    class="boton"
                    id="confirmar-turno"
                    [disabled]="confirmando()"
                  >
                    <app-icono nombre="asignar" />{{
                      confirmando() ? 'Asignando…' : 'Confirmar turno'
                    }}
                  </button>
                </div>
              </form>
            }
          }
        </section>

        <aside class="resumen" aria-labelledby="titulo-resumen">
          <h2 id="titulo-resumen">Tu turno</h2>
          @if (!paciente() && !consulta() && !seleccion()) {
            <p class="resumen-vacio">Todavía no elegiste nada.</p>
          }
          <ul>
            @if (paciente(); as p) {
              <li id="resumen-paciente">
                <app-paciente-tarjeta [paciente]="p" [compacta]="true" />
                @if (paso() > 1) {
                  <button type="button" class="enlace" (click)="irA(1)">
                    Cambiar<span class="solo-lectores"> el paciente</span>
                  </button>
                }
              </li>
            }
            @if (consulta(); as c) {
              <li id="resumen-fecha" class="resumen-dato">
                <app-icono nombre="agenda" />
                <span
                  ><strong>{{ legible(c.fecha) }}</strong
                  ><br />{{ c.bloque === 'manana' ? 'Mañana' : 'Tarde' }}</span
                >
                @if (paso() > 2) {
                  <button type="button" class="enlace" (click)="irA(2)">
                    Cambiar<span class="solo-lectores"> la fecha y el bloque</span>
                  </button>
                }
              </li>
            }
            @if (seleccion(); as s) {
              <li id="resumen-franja" class="resumen-dato">
                <app-icono nombre="kinesiologos" />
                <span
                  ><strong>{{ s.kinesiologo }}</strong
                  ><br />{{ s.inicio }} a {{ s.fin }}</span
                >
                @if (paso() > 3) {
                  <button type="button" class="enlace" (click)="irA(3)">
                    Cambiar<span class="solo-lectores"> el kinesiólogo y la franja</span>
                  </button>
                }
              </li>
            }
          </ul>
        </aside>
      </div>
    }
  `,
})
export class AsignarTurno {
  private readonly pacientes = inject(Pacientes);
  private readonly disponibilidad = inject(Disponibilidad);
  private readonly turnos = inject(Turnos);
  private cargaActual = 0;
  private busquedaActual = 0;

  protected readonly legible = fechaLegible;
  protected readonly esFinDeSemana = esFinDeSemana;
  protected readonly pasos = PASOS;

  protected readonly paso = signal<Paso>(1);
  protected readonly tituloDelPaso = computed(() => PASOS[this.paso() - 1].titulo);

  protected readonly fechaElegida = signal('');
  protected readonly bloque = signal<Bloque>('manana');
  protected readonly abonoTexto = signal('');
  protected readonly fechaValida = computed(() => FORMATO_FECHA.test(this.fechaElegida()));

  /** Fecha y bloque confirmados al salir del paso 2; la disponibilidad se pide para esta consulta. */
  protected readonly consulta = signal<Consulta | null>(null);
  protected readonly kinesiologos = signal<KinesiologoDisponible[] | null>(null);
  protected readonly seleccion = signal<Seleccion | null>(null);
  protected readonly paciente = signal<Paciente | null>(null);
  protected readonly asignado = signal<Asignado | null>(null);

  protected readonly cargando = signal(false);
  protected readonly buscando = signal(false);
  protected readonly creando = signal(false);
  protected readonly confirmando = signal(false);
  protected readonly descargando = signal(false);

  protected readonly errorFecha = signal<string | null>(null);
  protected readonly errorDni = signal<string | null>(null);
  protected readonly errorPaciente = signal<string | null>(null);
  protected readonly errorDisponibilidad = signal<string | null>(null);
  protected readonly errorFranja = signal<string | null>(null);
  protected readonly avisoFranja = signal<string | null>(null);
  protected readonly errorCoseguros = signal<string | null>(null);
  protected readonly errorConfirmar = signal<string | null>(null);
  protected readonly errorTicket = signal<string | null>(null);

  protected readonly dniSinResultados = signal<string | null>(null);
  protected readonly alta = signal<DatosPaciente | null>(null);
  protected readonly erroresAlta = signal<ErroresPaciente>({});

  // Navegación entre pasos

  /** Pasa a un paso y deja el foco en su título (DESIGN.md §6.1). */
  protected irAPaso(paso: Paso): void {
    this.paso.set(paso);
    enfocar('titulo-paso');
  }

  /** Vuelve a un paso ya completo desde el indicador o desde «Cambiar» del resumen. */
  protected irA(paso: Paso): void {
    if (paso < this.paso()) this.irAPaso(paso);
  }

  protected atras(): void {
    const actual = this.paso();
    if (actual > 1) this.irAPaso((actual - 1) as Paso);
  }

  /** Descarta la franja elegida y lo avisa en el paso 3, porque ya no corresponde. */
  private descartarFranja(motivo: string): void {
    if (this.seleccion() === null) return;
    this.seleccion.set(null);
    this.errorFranja.set(null);
    this.avisoFranja.set(`${motivo} La franja que habías elegido se descartó: elegí otra.`);
  }

  /** Paso 2: confirma fecha y bloque, descarta la franja si cambiaron y pide la disponibilidad. */
  protected async elegirFechaYBloque(evento: Event): Promise<void> {
    evento.preventDefault();
    if (this.cargando()) return;
    const fecha = this.fechaElegida();
    if (!FORMATO_FECHA.test(fecha)) {
      this.errorFecha.set('Elegí la fecha del turno.');
      enfocar('fecha-turno');
      return;
    }
    this.errorFecha.set(null);
    const nueva: Consulta = { fecha, bloque: this.bloque() };
    const previa = this.consulta();
    if (previa === null || previa.fecha !== nueva.fecha || previa.bloque !== nueva.bloque) {
      this.descartarFranja('Cambió la fecha o el bloque.');
      this.kinesiologos.set(null);
    }
    this.errorFranja.set(null);
    this.consulta.set(nueva);
    this.irAPaso(3);
    await this.cargar();
  }

  /** Paso 3: sigue solo con una franja elegida. */
  protected avanzarDesdeFranja(evento: Event): void {
    evento.preventDefault();
    if (this.cargando() || !this.seleccion()) return;
    this.errorFranja.set(null);
    this.irAPaso(4);
  }

  // Paso 3: franjas

  protected sinFranjas(lista: KinesiologoDisponible[]): boolean {
    return lista.every((k) => k.franjas.length === 0);
  }

  protected estaElegida(kinesiologoId: number, inicio: string): boolean {
    const s = this.seleccion();
    return s !== null && s.kinesiologoId === kinesiologoId && s.inicio === inicio;
  }

  protected elegirFranja(k: KinesiologoDisponible, inicio: string, fin: string): void {
    this.errorFranja.set(null);
    this.avisoFranja.set(null);
    this.seleccion.set({ kinesiologoId: k.kinesiologoId, kinesiologo: k.nombre, inicio, fin });
  }

  /** Pide la disponibilidad de la consulta vigente, con el paciente elegido si lo hay (RF-25). */
  private async cargar(): Promise<void> {
    const c = this.consulta();
    if (!c) return;
    const numero = ++this.cargaActual;
    this.cargando.set(true);
    this.errorDisponibilidad.set(null);
    try {
      const lista = await this.disponibilidad.consultar(c.fecha, c.bloque, this.paciente()?.id);
      if (numero !== this.cargaActual) return;
      this.kinesiologos.set(lista);
      const s = this.seleccion();
      const sigueLibre =
        s === null ||
        lista.some(
          (k) =>
            k.kinesiologoId === s.kinesiologoId && k.franjas.some((f) => f.inicio === s.inicio),
        );
      if (!sigueLibre) {
        this.seleccion.set(null);
        this.avisoFranja.set('La franja que habías elegido ya no está libre. Elegí otra.');
      }
    } catch (error) {
      if (numero !== this.cargaActual) return;
      this.kinesiologos.set(null);
      this.seleccion.set(null);
      this.errorDisponibilidad.set(mensajeDe(error));
      enfocar('error-disponibilidad');
    } finally {
      if (numero === this.cargaActual) this.cargando.set(false);
    }
  }

  // Paso 1: paciente

  protected async buscarPaciente(evento: Event, campo: HTMLInputElement): Promise<void> {
    evento.preventDefault();
    if (this.buscando()) return;
    this.errorDni.set(null);
    this.errorPaciente.set(null);
    this.dniSinResultados.set(null);
    this.cerrarAlta();

    const entrada = campo.value.trim();
    if (entrada.length === 0) return this.fallarDni('Escribí el DNI del paciente.');
    const dni = normalizarDni(entrada);
    if (dni === null) return this.fallarDni('El DNI debe tener 7 u 8 dígitos.');

    const numero = ++this.busquedaActual;
    this.buscando.set(true);
    try {
      const lista = await this.pacientes.buscarPorDni(dni);
      if (numero !== this.busquedaActual) return;
      if (lista.length > 0) {
        this.elegirPaciente(lista[0]);
      } else {
        this.dniSinResultados.set(dni);
        enfocar('sin-paciente');
      }
    } catch (error) {
      if (numero !== this.busquedaActual) return;
      this.errorPaciente.set(mensajeDe(error));
      enfocar('error-paciente');
    } finally {
      if (numero === this.busquedaActual) this.buscando.set(false);
    }
  }

  private fallarDni(mensaje: string): void {
    this.errorDni.set(mensaje);
    enfocar('dni-turno');
  }

  private elegirPaciente(paciente: Paciente): void {
    this.dniSinResultados.set(null);
    this.cerrarAlta();
    this.paciente.set(paciente);
    enfocar('siguiente');
  }

  protected cambiarPaciente(): void {
    this.paciente.set(null);
    this.errorPaciente.set(null);
    // La disponibilidad depende del paciente (RF-25): la franja elegida ya no vale.
    this.descartarFranja('Cambió el paciente.');
    enfocar('dni-turno');
  }

  protected abrirAlta(dni: string): void {
    this.erroresAlta.set({});
    this.alta.set({ dni, nombre: '', telefono: '', obraSocial: '' });
    enfocar('paciente-nombre');
  }

  protected cerrarAlta(): void {
    this.alta.set(null);
    this.erroresAlta.set({});
  }

  protected async crearPaciente(datos: DatosPaciente): Promise<void> {
    if (this.creando()) return;
    this.erroresAlta.set({});
    this.errorPaciente.set(null);
    this.creando.set(true);
    try {
      const creado = await this.pacientes.crear(datos);
      this.elegirPaciente(creado);
    } catch (error) {
      const errores = erroresDeCampo(error);
      if (errores) {
        this.erroresAlta.set(errores);
        enfocarPrimerError(errores);
      } else {
        this.errorPaciente.set(mensajeDe(error));
        enfocar('error-paciente');
      }
    } finally {
      this.creando.set(false);
    }
  }

  // Paso 4: confirmar

  protected async confirmar(evento: Event, abonado: HTMLInputElement): Promise<void> {
    evento.preventDefault();
    if (this.confirmando()) return;
    this.errorPaciente.set(null);
    this.errorFranja.set(null);
    this.errorCoseguros.set(null);
    this.errorConfirmar.set(null);

    const c = this.consulta();
    const paciente = this.paciente();
    const s = this.seleccion();
    if (!c) return;
    if (!paciente) {
      this.errorPaciente.set('Falta elegir el paciente. Buscalo por DNI o dalo de alta.');
      this.irAPaso(1);
      enfocar('error-paciente');
      return;
    }
    if (!s) {
      this.errorFranja.set('Falta elegir una franja libre.');
      this.irAPaso(3);
      enfocar('error-franja');
      return;
    }
    const monto = normalizarMonto(abonado.value);
    if (monto === null) {
      this.errorCoseguros.set(
        'El coseguro abonado debe ser un monto en pesos, con hasta dos decimales (por ejemplo 1500 o 1500,50).',
      );
      enfocar('coseguro-abonado');
      return;
    }

    this.confirmando.set(true);
    try {
      const turno = await this.turnos.asignar({
        pacienteId: paciente.id,
        kinesiologoId: s.kinesiologoId,
        fecha: c.fecha,
        horaInicio: s.inicio,
        ...(monto !== undefined ? { coseguroAbonado: monto } : {}),
      });
      this.asignado.set({ turno, seleccion: s, paciente: paciente.nombre });
      this.errorTicket.set(null);
      enfocar('titulo-asignado');
    } catch (error) {
      const t = traducirErrorAsignacion(error);
      if (t.olvidarPaciente) this.paciente.set(null);
      if (t.refrescar) this.seleccion.set(null);
      switch (t.paso) {
        case 'paciente':
          this.errorPaciente.set(t.mensaje);
          this.irAPaso(1);
          enfocar('error-paciente');
          break;
        case 'franja':
          this.errorFranja.set(t.mensaje);
          this.irAPaso(3);
          enfocar('error-franja');
          break;
        case 'coseguros':
          this.errorCoseguros.set(t.mensaje);
          enfocar('error-coseguros');
          break;
        default:
          this.errorConfirmar.set(t.mensaje);
          enfocar('error-confirmar');
      }
      if (t.refrescar || t.olvidarPaciente) await this.cargar();
    } finally {
      this.confirmando.set(false);
    }
  }

  /** Descarga el PDF (RF-28). El nombre del archivo lleva solo el número de turno. */
  protected async descargarTicket(id: number): Promise<void> {
    if (this.descargando()) return;
    this.errorTicket.set(null);
    this.descargando.set(true);
    try {
      const pdf = await this.turnos.descargarTicket(id);
      descargarArchivo(pdf, `turno-${id}.pdf`);
    } catch (error) {
      this.errorTicket.set(mensajeDe(error));
      enfocar('error-ticket');
    } finally {
      this.descargando.set(false);
    }
  }

  protected reiniciar(): void {
    this.cargaActual++;
    this.busquedaActual++;
    this.asignado.set(null);
    this.paso.set(1);
    this.fechaElegida.set('');
    this.bloque.set('manana');
    this.abonoTexto.set('');
    this.consulta.set(null);
    this.kinesiologos.set(null);
    this.seleccion.set(null);
    this.paciente.set(null);
    this.dniSinResultados.set(null);
    this.cerrarAlta();
    for (const e of [
      this.errorFecha,
      this.errorDni,
      this.errorPaciente,
      this.errorDisponibilidad,
      this.errorFranja,
      this.avisoFranja,
      this.errorCoseguros,
      this.errorConfirmar,
      this.errorTicket,
    ]) {
      e.set(null);
    }
    this.cargando.set(false);
    this.buscando.set(false);
    enfocar('dni-turno');
  }
}
