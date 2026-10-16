import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { normalizarDni } from '../nucleo/pacientes/dni';
import {
  MINIMO_BUSQUEDA_NOMBRE,
  Pacientes,
  type DatosPaciente,
  type Paciente,
} from '../nucleo/pacientes/pacientes';
import { enfocar, mensajeDe } from '../nucleo/ui/enfocar';
import {
  FormularioPaciente,
  enfocarPrimerError,
  erroresDeCampo,
  ID_CAMPO,
  type ErroresPaciente,
} from './formulario-paciente';
import { VolverAlInicio } from './volver-al-inicio';
import { Icono } from '../nucleo/ui/icono';
import { PacienteTarjeta } from '../nucleo/ui/paciente-tarjeta';

type Modo = 'dni' | 'nombre';

/**
 * Pacientes (RF-17, RF-19, RF-21): buscador por DNI o por nombre y alta. La usan la secretaría y el
 * administrador. Una búsqueda por DNI sin resultados ofrece el alta con ese DNI precargado; el DNI
 * y el nombre buscados nunca van a la URL ni a ningún almacenamiento del navegador.
 */
@Component({
  selector: 'app-pacientes',
  imports: [RouterLink, VolverAlInicio, FormularioPaciente, Icono, PacienteTarjeta],
  template: `
    <app-volver-al-inicio />
    <h1>Pacientes</h1>

    @if (errorGeneral(); as mensaje) {
      <p class="error" id="error-pacientes" role="alert" tabindex="-1">
        <app-icono nombre="alerta" />{{ mensaje }}
      </p>
    }

    <section class="tarjeta ancha" aria-labelledby="titulo-buscar">
      <h2 id="titulo-buscar">Buscar</h2>
      <form class="formulario" novalidate (submit)="buscar($event, texto)">
        <fieldset>
          <legend>Buscar por</legend>
          <label>
            <input
              type="radio"
              name="modo"
              value="dni"
              [checked]="modo() === 'dni'"
              (change)="cambiarModo('dni')"
            />
            DNI
          </label>
          <label>
            <input
              type="radio"
              name="modo"
              value="nombre"
              [checked]="modo() === 'nombre'"
              (change)="cambiarModo('nombre')"
            />
            Nombre
          </label>
        </fieldset>
        <div class="campo">
          <label for="buscar-texto">{{ modo() === 'dni' ? 'DNI' : 'Nombre o apellido' }}</label>
          <input
            #texto
            id="buscar-texto"
            name="texto"
            type="text"
            autocomplete="off"
            [attr.inputmode]="modo() === 'dni' ? 'numeric' : null"
            [attr.aria-invalid]="errorBusqueda() ? 'true' : null"
            [attr.aria-describedby]="errorBusqueda() ? 'error-buscar-texto' : null"
          />
          @if (errorBusqueda(); as mensaje) {
            <p class="error" id="error-buscar-texto"><app-icono nombre="alerta" />{{ mensaje }}</p>
          }
        </div>
        <button type="submit" class="boton" [disabled]="buscando()">
          <app-icono nombre="buscar" />{{ buscando() ? 'Buscando…' : 'Buscar' }}
        </button>
      </form>

      @if (resultados(); as lista) {
        <div id="resultados" tabindex="-1" role="status">
          @if (lista.length > 0) {
            <h3>{{ lista.length === 1 ? '1 paciente' : lista.length + ' pacientes' }}</h3>
            <ul class="lista-pacientes">
              @for (p of lista; track p.id) {
                <li>
                  <a [routerLink]="['/secretaria/pacientes', p.id]">
                    <app-paciente-tarjeta [paciente]="p" />
                    <app-icono nombre="siguiente" />
                  </a>
                </li>
              }
            </ul>
          } @else if (dniSinResultados(); as dni) {
            <p class="info">
              <app-icono nombre="info" />No hay ningún paciente con el DNI {{ dni }}.
            </p>
            <button type="button" class="boton" id="ofrecer-alta" (click)="abrirAlta(dni)">
              <app-icono nombre="usuario" />Dar de alta con este DNI
            </button>
          } @else {
            <p class="info">
              <app-icono nombre="info" />No hay pacientes que coincidan con la búsqueda.
            </p>
          }
        </div>
      }
    </section>

    @if (alta(); as precarga) {
      <section class="tarjeta ancha" aria-labelledby="titulo-alta">
        <h2 id="titulo-alta">Nuevo paciente</h2>
        <app-formulario-paciente
          etiqueta="Crear paciente"
          [inicial]="precarga"
          [ocupado]="creando()"
          [cancelable]="true"
          [erroresServidor]="erroresAlta()"
          (guardar)="crear($event)"
          (cancelar)="cerrarAlta()"
        />
      </section>
    } @else {
      <p>
        <button type="button" class="boton secundario" id="nuevo-paciente" (click)="abrirAlta('')">
          Nuevo paciente
        </button>
      </p>
    }
  `,
})
export class PacientesPagina {
  private readonly servicio = inject(Pacientes);
  private readonly router = inject(Router);
  private busquedaActual = 0;

  protected readonly modo = signal<Modo>('dni');
  protected readonly buscando = signal(false);
  protected readonly errorBusqueda = signal<string | null>(null);
  protected readonly errorGeneral = signal<string | null>(null);
  protected readonly resultados = signal<Paciente[] | null>(null);
  /** DNI normalizado de una búsqueda por DNI que no encontró a nadie. */
  protected readonly dniSinResultados = signal<string | null>(null);
  protected readonly alta = signal<DatosPaciente | null>(null);
  protected readonly creando = signal(false);
  protected readonly erroresAlta = signal<ErroresPaciente>({});

  protected cambiarModo(modo: Modo): void {
    this.modo.set(modo);
    this.errorBusqueda.set(null);
    this.resultados.set(null);
    this.dniSinResultados.set(null);
  }

  protected async buscar(evento: Event, campo: HTMLInputElement): Promise<void> {
    evento.preventDefault();
    if (this.buscando()) return;
    this.errorGeneral.set(null);
    this.errorBusqueda.set(null);

    const entrada = campo.value.trim();
    let dni: string | null = null;
    if (this.modo() === 'dni') {
      if (entrada.length === 0) return this.fallarBusqueda('Escribí el DNI.');
      dni = normalizarDni(entrada);
      if (dni === null) return this.fallarBusqueda('El DNI debe tener 7 u 8 dígitos.');
    } else if ([...entrada].length < MINIMO_BUSQUEDA_NOMBRE) {
      return this.fallarBusqueda(
        `Escribí al menos ${MINIMO_BUSQUEDA_NOMBRE} letras del nombre o del apellido.`,
      );
    }

    const numero = ++this.busquedaActual;
    this.buscando.set(true);
    try {
      const lista =
        dni !== null
          ? await this.servicio.buscarPorDni(dni)
          : await this.servicio.buscarPorNombre(entrada);
      if (numero !== this.busquedaActual) return;
      this.resultados.set(lista);
      this.dniSinResultados.set(dni !== null && lista.length === 0 ? dni : null);
      enfocar('resultados');
    } catch (error) {
      if (numero !== this.busquedaActual) return;
      this.resultados.set(null);
      this.dniSinResultados.set(null);
      this.errorGeneral.set(mensajeDe(error));
      enfocar('error-pacientes');
    } finally {
      if (numero === this.busquedaActual) this.buscando.set(false);
    }
  }

  protected abrirAlta(dni: string): void {
    this.erroresAlta.set({});
    this.alta.set({ dni, nombre: '', telefono: '', obraSocial: '' });
    enfocar(dni ? ID_CAMPO.nombre : ID_CAMPO.dni);
  }

  protected cerrarAlta(): void {
    this.alta.set(null);
    this.erroresAlta.set({});
  }

  protected async crear(datos: DatosPaciente): Promise<void> {
    if (this.creando()) return;
    this.erroresAlta.set({});
    this.errorGeneral.set(null);
    this.creando.set(true);
    try {
      const creado = await this.servicio.crear(datos);
      await this.router.navigate(['/secretaria/pacientes', creado.id], {
        state: { alta: true },
      });
    } catch (error) {
      const errores = erroresDeCampo(error);
      if (errores) {
        this.erroresAlta.set(errores);
        enfocarPrimerError(errores);
      } else {
        this.errorGeneral.set(mensajeDe(error));
        enfocar('error-pacientes');
      }
    } finally {
      this.creando.set(false);
    }
  }

  private fallarBusqueda(mensaje: string): void {
    this.errorBusqueda.set(mensaje);
    this.resultados.set(null);
    this.dniSinResultados.set(null);
    enfocar('buscar-texto');
  }
}
