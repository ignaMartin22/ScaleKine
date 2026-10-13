import { Component, OnInit, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ErrorApi } from '../nucleo/http/error-api';
import { Pacientes, type DatosPaciente, type Paciente } from '../nucleo/pacientes/pacientes';
import { enfocar, mensajeDe } from '../nucleo/ui/enfocar';
import {
  FormularioPaciente,
  enfocarPrimerError,
  erroresDeCampo,
  ID_CAMPO,
  type ErroresPaciente,
} from './formulario-paciente';

/**
 * Ficha del paciente (RF-20, RF-21): datos de M2 y edición. El PUT reemplaza todos los datos. Las
 * listas de turnos de la ficha llegan en T-30. El id viene de la ruta (no es un dato personal).
 */
@Component({
  selector: 'app-paciente-ficha',
  imports: [RouterLink, FormularioPaciente],
  template: `
    <p><a routerLink="/secretaria/pacientes">Volver a pacientes</a></p>
    <h1 id="titulo-ficha" tabindex="-1">Ficha del paciente</h1>

    @if (aviso(); as mensaje) {
      <p class="aviso" role="status">{{ mensaje }}</p>
    }
    @if (errorGeneral(); as mensaje) {
      <p class="error" id="error-ficha" role="alert" tabindex="-1">{{ mensaje }}</p>
    }

    @if (cargando()) {
      <p role="status">Cargando la ficha…</p>
    } @else if (paciente(); as p) {
      @if (editando()) {
        <section class="tarjeta ancha" aria-labelledby="titulo-editar">
          <h2 id="titulo-editar">Editar datos</h2>
          <app-formulario-paciente
            etiqueta="Guardar cambios"
            [inicial]="p"
            [ocupado]="guardando()"
            [cancelable]="true"
            [erroresServidor]="errores()"
            (guardar)="guardar(p.id, $event)"
            (cancelar)="cerrarEdicion()"
          />
        </section>
      } @else {
        <section class="tarjeta ancha" aria-labelledby="titulo-datos">
          <h2 id="titulo-datos">Datos</h2>
          <dl>
            <dt>Nombre</dt>
            <dd id="ficha-nombre">{{ p.nombre }}</dd>
            <dt>DNI</dt>
            <dd id="ficha-dni">{{ p.dni }}</dd>
            <dt>Teléfono</dt>
            <dd id="ficha-telefono">{{ p.telefono }}</dd>
            <dt>Obra social</dt>
            <dd id="ficha-obra-social">{{ p.obraSocial }}</dd>
          </dl>
          <button type="button" class="boton" id="editar" (click)="abrirEdicion()">
            Editar datos
          </button>
        </section>
      }
    }
  `,
})
export class PacienteFicha implements OnInit {
  private readonly servicio = inject(Pacientes);
  private readonly router = inject(Router);

  /** Parámetro `:id` de la ruta. */
  readonly id = input<string>();

  protected readonly paciente = signal<Paciente | null>(null);
  protected readonly cargando = signal(true);
  protected readonly editando = signal(false);
  protected readonly guardando = signal(false);
  protected readonly aviso = signal<string | null>(null);
  protected readonly errorGeneral = signal<string | null>(null);
  protected readonly errores = signal<ErroresPaciente>({});

  ngOnInit(): void {
    if (this.router.currentNavigation()?.extras.state?.['alta'] === true) {
      this.aviso.set('Se creó el paciente.');
    }
    void this.cargar();
  }

  protected abrirEdicion(): void {
    this.aviso.set(null);
    this.errores.set({});
    this.editando.set(true);
    enfocar(ID_CAMPO.dni);
  }

  protected cerrarEdicion(): void {
    this.editando.set(false);
    this.errores.set({});
    enfocar('editar');
  }

  protected async guardar(id: number, datos: DatosPaciente): Promise<void> {
    if (this.guardando()) return;
    this.errores.set({});
    this.errorGeneral.set(null);
    this.guardando.set(true);
    try {
      this.paciente.set(await this.servicio.editar(id, datos));
      this.editando.set(false);
      this.aviso.set('Se guardaron los datos.');
      enfocar('titulo-ficha');
    } catch (error) {
      const deCampo = erroresDeCampo(error);
      if (deCampo) {
        this.errores.set(deCampo);
        enfocarPrimerError(deCampo);
      } else {
        this.mostrarError(error);
      }
    } finally {
      this.guardando.set(false);
    }
  }

  private async cargar(): Promise<void> {
    const texto = this.id() ?? '';
    const numero = /^\d{1,10}$/.test(texto) ? Number(texto) : 0;
    if (numero === 0) {
      this.cargando.set(false);
      this.mostrarError(new ErrorApi(404, 'paciente_no_encontrado', ''));
      return;
    }
    try {
      this.paciente.set(await this.servicio.obtener(numero));
    } catch (error) {
      this.mostrarError(error);
    } finally {
      this.cargando.set(false);
    }
  }

  private mostrarError(error: unknown): void {
    const noExiste = error instanceof ErrorApi && error.estado === 404;
    this.editando.set(false);
    if (noExiste) this.paciente.set(null);
    this.errorGeneral.set(
      noExiste ? 'El paciente no existe o ya no está disponible.' : mensajeDe(error),
    );
    enfocar('error-ficha');
  }
}
