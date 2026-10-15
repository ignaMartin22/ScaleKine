import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { normalizarDni } from '../nucleo/pacientes/dni';
import { Pacientes, type DatosPaciente, type Paciente } from '../nucleo/pacientes/pacientes';
import {
  Disponibilidad,
  type Bloque,
  type KinesiologoDisponible,
} from '../nucleo/turnos/disponibilidad';
import { normalizarMonto, traducirErrorAsignacion } from '../nucleo/turnos/errores-asignacion';
import { Turnos, type TurnoAsignado } from '../nucleo/turnos/turnos';
import { enfocar, mensajeDe } from '../nucleo/ui/enfocar';
import {
  FormularioPaciente,
  enfocarPrimerError,
  erroresDeCampo,
  type ErroresPaciente,
} from './formulario-paciente';

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
 * Asignación de turnos (RF-22 a RF-28) para secretaría y administrador. Orden: fecha y bloque, luego
 * el paciente por DNI (o su alta en el mismo flujo), la franja libre, los coseguros y la
 * confirmación. La disponibilidad se muestra apenas hay fecha y bloque, y se vuelve a pedir con
 * `pacienteId` al elegir el paciente, para no ofrecer una franja que el paciente ya tiene ocupada
 * (RF-25). Ningún dato personal va a la URL ni al almacenamiento del navegador.
 */
@Component({
  selector: 'app-asignar-turno',
  imports: [RouterLink, FormularioPaciente],
  template: `
    <p><a routerLink="/secretaria">Volver a la agenda</a></p>
    <h1>Asignar turno</h1>

    @if (asignado(); as a) {
      <section class="tarjeta ancha" aria-labelledby="titulo-asignado">
        <h2 id="titulo-asignado" tabindex="-1">Turno asignado</h2>
        <p role="status">
          Turno número {{ a.turno.id }} para {{ a.paciente }}, con {{ a.seleccion.kinesiologo }}, el
          {{ legible(a.turno.fecha) }} a las {{ a.turno.horaInicio }}.
        </p>
        @if (errorTicket(); as mensaje) {
          <p class="error" id="error-ticket" role="alert" tabindex="-1">{{ mensaje }}</p>
        }
        <div class="acciones">
          <button
            type="button"
            class="boton"
            id="descargar-ticket"
            [disabled]="descargando()"
            (click)="descargarTicket(a.turno.id)"
          >
            {{ descargando() ? 'Descargando…' : 'Descargar ticket (PDF)' }}
          </button>
          <button type="button" class="boton secundario" id="asignar-otro" (click)="reiniciar()">
            Asignar otro turno
          </button>
        </div>
      </section>
    } @else {
      <section class="tarjeta ancha" aria-labelledby="titulo-fecha">
        <h2 id="titulo-fecha">1. Fecha y bloque</h2>
        <form class="formulario" novalidate (submit)="consultar($event, fecha)">
          <div class="campo">
            <label for="fecha-turno">Fecha</label>
            <input
              #fecha
              id="fecha-turno"
              name="fecha"
              type="date"
              [attr.aria-invalid]="errorFecha() ? 'true' : null"
              [attr.aria-describedby]="errorFecha() ? 'error-fecha-turno' : null"
            />
            @if (errorFecha(); as mensaje) {
              <p class="error" id="error-fecha-turno">{{ mensaje }}</p>
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
          <div class="acciones">
            <button type="submit" class="boton" [disabled]="cargando()">
              {{ cargando() ? 'Buscando…' : 'Ver disponibilidad' }}
            </button>
          </div>
        </form>
      </section>

      @if (consulta(); as c) {
        <section class="tarjeta ancha" aria-labelledby="titulo-paciente">
          <h2 id="titulo-paciente">2. Paciente</h2>
          @if (errorPaciente(); as mensaje) {
            <p class="error" id="error-paciente" role="alert" tabindex="-1">{{ mensaje }}</p>
          }
          @if (paciente(); as p) {
            <p id="paciente-elegido" role="status">Paciente: {{ p.nombre }}, DNI {{ p.dni }}.</p>
            <button
              type="button"
              class="boton secundario"
              id="cambiar-paciente"
              (click)="cambiarPaciente()"
            >
              Cambiar paciente
            </button>
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
                  <p class="error" id="error-dni-turno">{{ mensaje }}</p>
                }
              </div>
              <div class="acciones">
                <button type="submit" class="boton" [disabled]="buscando()">
                  {{ buscando() ? 'Buscando…' : 'Buscar paciente' }}
                </button>
              </div>
            </form>
            @if (dniSinResultados(); as sinPaciente) {
              <div role="status" id="sin-paciente" tabindex="-1">
                <p>No hay ningún paciente con el DNI {{ sinPaciente }}.</p>
                @if (!alta()) {
                  <button
                    type="button"
                    class="boton secundario"
                    id="ofrecer-alta"
                    (click)="abrirAlta(sinPaciente)"
                  >
                    Dar de alta con este DNI
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
        </section>

        <section
          class="tarjeta ancha"
          aria-labelledby="titulo-franja"
          [attr.aria-busy]="cargando()"
        >
          <h2 id="titulo-franja">3. Kinesiólogo y franja</h2>
          <p>
            {{ legible(c.fecha) }}, {{ c.bloque === 'manana' ? 'mañana' : 'tarde' }}.
            @if (paciente()) {
              Sin las horas en que el paciente ya tiene turno.
            } @else {
              Elegí el paciente para descartar las horas en que ya tiene turno.
            }
          </p>
          @if (errorFranja(); as mensaje) {
            <p class="error" id="error-franja" role="alert" tabindex="-1">{{ mensaje }}</p>
          }
          @if (avisoFranja(); as mensaje) {
            <p class="aviso" id="aviso-franja" role="status">{{ mensaje }}</p>
          }
          @if (errorDisponibilidad(); as mensaje) {
            <p class="error" id="error-disponibilidad" role="alert" tabindex="-1">
              {{ mensaje }}
            </p>
          }
          @if (kinesiologos(); as lista) {
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
        </section>

        <section class="tarjeta ancha" aria-labelledby="titulo-confirmar">
          <h2 id="titulo-confirmar">4. Coseguros y confirmación</h2>
          @if (seleccion(); as s) {
            <p id="resumen-franja">
              Turno con {{ s.kinesiologo }}, {{ legible(c.fecha) }} de {{ s.inicio }} a {{ s.fin }}.
            </p>
          }
          <form class="formulario" novalidate (submit)="confirmar($event, coseguroOS, coseguroAd)">
            <div class="campo">
              <label for="coseguro-obra-social">Coseguro según obra social (opcional)</label>
              <input
                #coseguroOS
                id="coseguro-obra-social"
                name="coseguroObraSocial"
                type="text"
                inputmode="decimal"
                autocomplete="off"
                aria-describedby="ayuda-coseguros"
                [attr.aria-invalid]="errorCoseguros() ? 'true' : null"
              />
            </div>
            <div class="campo">
              <label for="coseguro-adicional">Coseguro adicional (opcional)</label>
              <input
                #coseguroAd
                id="coseguro-adicional"
                name="coseguroAdicional"
                type="text"
                inputmode="decimal"
                autocomplete="off"
                aria-describedby="ayuda-coseguros"
                [attr.aria-invalid]="errorCoseguros() ? 'true' : null"
              />
              <p id="ayuda-coseguros">
                Monto en pesos, con hasta dos decimales. Se pueden cargar después.
              </p>
              @if (errorCoseguros(); as mensaje) {
                <p class="error" id="error-coseguros" role="alert" tabindex="-1">{{ mensaje }}</p>
              }
            </div>
            @if (errorConfirmar(); as mensaje) {
              <p class="error" id="error-confirmar" role="alert" tabindex="-1">{{ mensaje }}</p>
            }
            <div class="acciones">
              <button type="submit" class="boton" id="confirmar-turno" [disabled]="confirmando()">
                {{ confirmando() ? 'Asignando…' : 'Confirmar turno' }}
              </button>
            </div>
          </form>
        </section>
      }
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

  protected readonly bloque = signal<Bloque>('manana');
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

  protected async consultar(evento: Event, campo: HTMLInputElement): Promise<void> {
    evento.preventDefault();
    if (this.cargando()) return;
    const fecha = campo.value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      this.errorFecha.set('Elegí la fecha del turno.');
      enfocar('fecha-turno');
      return;
    }
    this.errorFecha.set(null);
    this.seleccion.set(null);
    this.errorFranja.set(null);
    this.avisoFranja.set(null);
    this.consulta.set({ fecha, bloque: this.bloque() });
    await this.cargar();
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
        await this.elegirPaciente(lista[0]);
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

  private async elegirPaciente(paciente: Paciente): Promise<void> {
    this.dniSinResultados.set(null);
    this.cerrarAlta();
    this.paciente.set(paciente);
    await this.cargar();
  }

  protected async cambiarPaciente(): Promise<void> {
    this.paciente.set(null);
    this.errorPaciente.set(null);
    enfocar('dni-turno');
    // Sin paciente la disponibilidad vuelve a ser la general; la franja elegida se revalida.
    await this.cargar();
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
      await this.elegirPaciente(creado);
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

  protected async confirmar(
    evento: Event,
    obraSocial: HTMLInputElement,
    adicional: HTMLInputElement,
  ): Promise<void> {
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
      enfocar('error-paciente');
      return;
    }
    if (!s) {
      this.errorFranja.set('Falta elegir una franja libre.');
      enfocar('error-franja');
      return;
    }
    const montoOS = normalizarMonto(obraSocial.value);
    const montoAd = normalizarMonto(adicional.value);
    if (montoOS === null || montoAd === null) {
      this.errorCoseguros.set(
        'Los coseguros deben ser montos en pesos, con hasta dos decimales (por ejemplo 1500 o 1500,50).',
      );
      enfocar(montoOS === null ? 'coseguro-obra-social' : 'coseguro-adicional');
      return;
    }

    this.confirmando.set(true);
    try {
      const turno = await this.turnos.asignar({
        pacienteId: paciente.id,
        kinesiologoId: s.kinesiologoId,
        fecha: c.fecha,
        horaInicio: s.inicio,
        ...(montoOS !== undefined ? { coseguroObraSocial: montoOS } : {}),
        ...(montoAd !== undefined ? { coseguroAdicional: montoAd } : {}),
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
          enfocar('error-paciente');
          break;
        case 'franja':
          this.errorFranja.set(t.mensaje);
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
      const direccion = URL.createObjectURL(pdf);
      const enlace = document.createElement('a');
      enlace.href = direccion;
      enlace.download = `turno-${id}.pdf`;
      document.body.appendChild(enlace);
      enlace.click();
      enlace.remove();
      setTimeout(() => URL.revokeObjectURL(direccion));
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
    enfocar('fecha-turno');
  }
}
