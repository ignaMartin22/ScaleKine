import { Component, OnInit, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  Agenda,
  NOMBRE_DEL_ESTADO,
  type EstadoTurno,
  type TurnoDePaciente,
} from '../nucleo/agenda/agenda';
import { ErrorApi } from '../nucleo/http/error-api';
import { Pacientes, type DatosPaciente, type Paciente } from '../nucleo/pacientes/pacientes';
import { enfocar, mensajeDe } from '../nucleo/ui/enfocar';
import { fechaLegible } from './asignar-turno';
import {
  FormularioPaciente,
  enfocarPrimerError,
  erroresDeCampo,
  ID_CAMPO,
  type ErroresPaciente,
} from './formulario-paciente';
import { EstadoDelTurno } from '../nucleo/ui/estado-turno';
import { montoAbonado } from '../nucleo/turnos/montos';
import { Icono } from '../nucleo/ui/icono';

/**
 * Ficha del paciente (RF-20, RF-21, RF-47): datos de M2, edición y listas de turnos próximos (del
 * más cercano al más lejano) e historial (del más reciente al más antiguo), solo de lectura. El PUT
 * reemplaza todos los datos. El id viene de la ruta (no es un dato personal).
 */
@Component({
  selector: 'app-paciente-ficha',
  imports: [RouterLink, FormularioPaciente, EstadoDelTurno, Icono],
  template: `
    <p>
      <a routerLink="/secretaria/pacientes" class="enlace-icono"
        ><app-icono nombre="volver" />Volver a pacientes</a
      >
    </p>
    <h1 id="titulo-ficha" tabindex="-1">Ficha del paciente</h1>

    @if (aviso(); as mensaje) {
      <p class="info" role="status"><app-icono nombre="info" />{{ mensaje }}</p>
    }
    @if (errorGeneral(); as mensaje) {
      <p class="error" id="error-ficha" role="alert" tabindex="-1">
        <app-icono nombre="alerta" />{{ mensaje }}
      </p>
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
            <app-icono nombre="lapiz" />Editar datos
          </button>
        </section>
      }

      <section class="tarjeta ancha" aria-labelledby="titulo-proximos">
        <h2 id="titulo-proximos">
          Próximos turnos
          @if (turnos(); as t) {
            <span>({{ t.proximos.length }})</span>
          }
        </h2>
        @if (turnos(); as t) {
          @if (t.proximos.length === 0) {
            <p id="sin-proximos">El paciente no tiene turnos próximos.</p>
          } @else {
            <div class="tabla-contenedor">
              <table class="tabla apilable" id="tabla-proximos">
                <caption class="solo-lectores">
                  Próximos turnos del paciente, del más cercano al más lejano
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Fecha</th>
                    <th scope="col">Franja</th>
                    <th scope="col">Kinesiólogo</th>
                    <th scope="col">Estado</th>
                    <th scope="col">Coseguro abonado</th>
                  </tr>
                </thead>
                <tbody>
                  @for (x of t.proximos; track x.id) {
                    <tr>
                      <td data-label="Fecha">{{ legible(x.fecha) }}</td>
                      <td data-label="Franja">{{ x.horaInicio }} a {{ x.horaFin }}</td>
                      <td data-label="Kinesiólogo">{{ x.kinesiologo.nombre }}</td>
                      <td data-label="Estado"><app-estado-turno [estado]="x.estado" /></td>
                      <td data-label="Coseguro abonado">
                        {{ monto(x.coseguroAbonado) }}
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        } @else if (errorTurnos(); as mensaje) {
          <p class="error" id="error-turnos" role="alert">
            <app-icono nombre="alerta" />{{ mensaje }}
          </p>
        } @else {
          <p role="status">Cargando los turnos…</p>
        }
      </section>
      <section class="tarjeta ancha" aria-labelledby="titulo-historial">
        <h2 id="titulo-historial">
          Historial
          @if (turnos(); as t) {
            <span>({{ t.historial.length }})</span>
          }
        </h2>
        @if (turnos(); as t) {
          @if (t.historial.length === 0) {
            <p id="sin-historial">El paciente no tiene turnos en su historial.</p>
          } @else {
            <div class="tabla-contenedor">
              <table class="tabla apilable" id="tabla-historial">
                <caption class="solo-lectores">
                  Historial de turnos del paciente, del más reciente al más antiguo
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Fecha</th>
                    <th scope="col">Franja</th>
                    <th scope="col">Kinesiólogo</th>
                    <th scope="col">Estado</th>
                    <th scope="col">Coseguro abonado</th>
                  </tr>
                </thead>
                <tbody>
                  @for (x of t.historial; track x.id) {
                    <tr>
                      <td data-label="Fecha">{{ legible(x.fecha) }}</td>
                      <td data-label="Franja">{{ x.horaInicio }} a {{ x.horaFin }}</td>
                      <td data-label="Kinesiólogo">{{ x.kinesiologo.nombre }}</td>
                      <td data-label="Estado"><app-estado-turno [estado]="x.estado" /></td>
                      <td data-label="Coseguro abonado">
                        {{ monto(x.coseguroAbonado) }}
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        } @else if (errorTurnos(); as mensaje) {
          <p class="error" id="error-turnos" role="alert">
            <app-icono nombre="alerta" />{{ mensaje }}
          </p>
        } @else {
          <p role="status">Cargando los turnos…</p>
        }
      </section>
    }
  `,
})
export class PacienteFicha implements OnInit {
  private readonly servicio = inject(Pacientes);
  private readonly agenda = inject(Agenda);
  private readonly router = inject(Router);

  /** Parámetro `:id` de la ruta. */
  readonly id = input<string>();

  protected readonly legible = fechaLegible;
  protected readonly estado = (e: EstadoTurno) => NOMBRE_DEL_ESTADO[e];
  protected readonly paciente = signal<Paciente | null>(null);
  protected readonly turnos = signal<{
    proximos: TurnoDePaciente[];
    historial: TurnoDePaciente[];
  } | null>(null);
  protected readonly errorTurnos = signal<string | null>(null);
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

  protected readonly monto = montoAbonado;

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
    void this.cargarTurnos(numero);
    try {
      this.paciente.set(await this.servicio.obtener(numero));
    } catch (error) {
      this.mostrarError(error);
    } finally {
      this.cargando.set(false);
    }
  }

  /** Las listas fallan por separado: un error acá no oculta los datos del paciente. */
  private async cargarTurnos(id: number): Promise<void> {
    try {
      const { proximos, historial } = await this.agenda.delPaciente(id);
      this.turnos.set({
        proximos: [...proximos].sort(
          (a, b) => a.fecha.localeCompare(b.fecha) || a.horaInicio.localeCompare(b.horaInicio),
        ),
        historial: [...historial].sort(
          (a, b) => b.fecha.localeCompare(a.fecha) || b.horaInicio.localeCompare(a.horaInicio),
        ),
      });
    } catch (error) {
      this.errorTurnos.set('No se pudieron cargar los turnos del paciente. ' + mensajeDe(error));
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
