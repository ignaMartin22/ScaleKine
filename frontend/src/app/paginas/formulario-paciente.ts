import { Component, input, output, signal } from '@angular/core';
import { ErrorApi } from '../nucleo/http/error-api';
import { normalizarDni } from '../nucleo/pacientes/dni';
import type { DatosPaciente } from '../nucleo/pacientes/pacientes';
import { enfocar } from '../nucleo/ui/enfocar';
import { Icono } from '../nucleo/ui/icono';

export type CampoPaciente = 'dni' | 'nombre' | 'telefono' | 'obraSocial';
export type ErroresPaciente = Partial<Record<CampoPaciente, string>>;

const ORDEN: readonly CampoPaciente[] = ['dni', 'nombre', 'telefono', 'obraSocial'];

/** Id del control de cada campo; el prefijo evita choques con el buscador de la misma pantalla. */
export const ID_CAMPO: Readonly<Record<CampoPaciente, string>> = {
  dni: 'paciente-dni',
  nombre: 'paciente-nombre',
  telefono: 'paciente-telefono',
  obraSocial: 'paciente-obra-social',
};

/** Lleva el foco al primer campo con error, en el orden del formulario. */
export function enfocarPrimerError(errores: ErroresPaciente): void {
  const primero = ORDEN.find((campo) => errores[campo]);
  if (primero) enfocar(ID_CAMPO[primero]);
}

/**
 * Traduce un error de la API a errores por campo (RF-17, RF-18, RF-20). `dni_en_uso` va al campo
 * DNI. Devuelve `null` si el error no pertenece a ningún campo y hay que mostrarlo aparte.
 */
export function erroresDeCampo(error: unknown): ErroresPaciente | null {
  if (!(error instanceof ErrorApi)) return null;
  if (error.codigo === 'dni_en_uso') {
    return { dni: 'Ya existe un paciente con ese DNI.' };
  }
  if (error.codigo === 'datos_invalidos') {
    const errores: ErroresPaciente = {};
    const toca = (clave: string) =>
      error.campos.some((c) => c === clave || c.endsWith('.' + clave));
    if (toca('dni')) errores.dni = 'El DNI debe tener 7 u 8 dígitos.';
    if (toca('nombre')) errores.nombre = 'El nombre no es válido.';
    if (toca('telefono')) errores.telefono = 'El teléfono no es válido.';
    if (toca('obraSocial')) errores.obraSocial = 'La obra social no es válida.';
    return Object.keys(errores).length > 0 ? errores : null;
  }
  return null;
}

/**
 * Formulario de los cuatro datos obligatorios del paciente, compartido por el alta y la edición.
 * Valida en el cliente (campos vacíos y formato del DNI) y emite los datos limpios; los errores que
 * decide el backend llegan por `erroresServidor`. "Particular" se sugiere pero no se completa solo.
 */
@Component({
  imports: [Icono],
  selector: 'app-formulario-paciente',
  template: `
    <form
      class="formulario"
      novalidate
      (submit)="enviar($event, dni, nombre, telefono, obraSocial)"
    >
      <div class="campo">
        <label for="paciente-dni">DNI</label>
        <input
          #dni
          id="paciente-dni"
          name="dni"
          type="text"
          inputmode="numeric"
          autocomplete="off"
          [value]="inicial().dni"
          [attr.aria-invalid]="error('dni') ? 'true' : null"
          [attr.aria-describedby]="error('dni') ? 'error-paciente-dni' : null"
        />
        @if (error('dni'); as mensaje) {
          <p class="error" id="error-paciente-dni"><app-icono nombre="alerta" />{{ mensaje }}</p>
        }
      </div>
      <div class="campo">
        <label for="paciente-nombre">Nombre y apellido</label>
        <input
          #nombre
          id="paciente-nombre"
          name="nombre"
          type="text"
          autocomplete="off"
          [value]="inicial().nombre"
          [attr.aria-invalid]="error('nombre') ? 'true' : null"
          [attr.aria-describedby]="error('nombre') ? 'error-paciente-nombre' : null"
        />
        @if (error('nombre'); as mensaje) {
          <p class="error" id="error-paciente-nombre"><app-icono nombre="alerta" />{{ mensaje }}</p>
        }
      </div>
      <div class="campo">
        <label for="paciente-telefono">Teléfono</label>
        <input
          #telefono
          id="paciente-telefono"
          name="telefono"
          type="tel"
          autocomplete="off"
          [value]="inicial().telefono"
          [attr.aria-invalid]="error('telefono') ? 'true' : null"
          [attr.aria-describedby]="error('telefono') ? 'error-paciente-telefono' : null"
        />
        @if (error('telefono'); as mensaje) {
          <p class="error" id="error-paciente-telefono">
            <app-icono nombre="alerta" />{{ mensaje }}
          </p>
        }
      </div>
      <div class="campo">
        <label for="paciente-obra-social">Obra social</label>
        <input
          #obraSocial
          id="paciente-obra-social"
          name="obraSocial"
          type="text"
          list="sugerencias-obra-social"
          autocomplete="off"
          aria-describedby="ayuda-paciente-obra-social"
          [value]="inicial().obraSocial"
          [attr.aria-invalid]="error('obraSocial') ? 'true' : null"
        />
        <datalist id="sugerencias-obra-social">
          <option value="Particular"></option>
        </datalist>
        <p id="ayuda-paciente-obra-social">
          Escribila o elegí «Particular» si no tiene. No se completa sola.
        </p>
        @if (error('obraSocial'); as mensaje) {
          <p class="error" id="error-paciente-obra-social">
            <app-icono nombre="alerta" />{{ mensaje }}
          </p>
        }
      </div>
      <div class="acciones">
        <button type="submit" class="boton" [disabled]="ocupado()">
          {{ ocupado() ? 'Guardando…' : etiqueta() }}
        </button>
        @if (cancelable()) {
          <button type="button" class="boton secundario" (click)="cancelar.emit()">Cancelar</button>
        }
      </div>
    </form>
  `,
})
export class FormularioPaciente {
  readonly inicial = input<DatosPaciente>({ dni: '', nombre: '', telefono: '', obraSocial: '' });
  readonly etiqueta = input('Guardar');
  readonly ocupado = input(false);
  readonly cancelable = input(false);
  /** Errores que decidió el backend (por ejemplo `dni_en_uso`). */
  readonly erroresServidor = input<ErroresPaciente>({});

  readonly guardar = output<DatosPaciente>();
  readonly cancelar = output<void>();

  private readonly locales = signal<ErroresPaciente>({});

  protected error(campo: CampoPaciente): string | undefined {
    return this.locales()[campo] ?? this.erroresServidor()[campo];
  }

  protected enviar(
    evento: Event,
    dni: HTMLInputElement,
    nombre: HTMLInputElement,
    telefono: HTMLInputElement,
    obraSocial: HTMLInputElement,
  ): void {
    evento.preventDefault();
    if (this.ocupado()) return;

    const dniNormalizado = normalizarDni(dni.value);
    const datos = {
      nombre: nombre.value.trim(),
      telefono: telefono.value.trim(),
      obraSocial: obraSocial.value.trim(),
    };
    const errores: ErroresPaciente = {};
    if (dni.value.trim().length === 0) errores.dni = 'El DNI es obligatorio.';
    else if (dniNormalizado === null) errores.dni = 'El DNI debe tener 7 u 8 dígitos.';
    if (datos.nombre.length === 0) errores.nombre = 'El nombre es obligatorio.';
    if (datos.telefono.length === 0) errores.telefono = 'El teléfono es obligatorio.';
    if (datos.obraSocial.length === 0) {
      errores.obraSocial = 'La obra social es obligatoria. Escribí «Particular» si no tiene.';
    }
    this.locales.set(errores);
    const primero = ORDEN.find((campo) => errores[campo]);
    if (primero || dniNormalizado === null) {
      if (primero) enfocar(ID_CAMPO[primero]);
      return;
    }
    this.guardar.emit({ dni: dniNormalizado, ...datos });
  }
}
