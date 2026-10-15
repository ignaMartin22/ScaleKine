import { Component, OnInit, inject, signal } from '@angular/core';
import { Consultorio, type DatosConsultorio } from '../nucleo/consultorio/consultorio';
import { ErrorApi } from '../nucleo/http/error-api';
import { enfocar, mensajeDe } from '../nucleo/ui/enfocar';
import { VolverAlInicio } from './volver-al-inicio';

type Campo = 'nombre' | 'direccion' | 'telefono';
type Errores = Partial<Record<Campo, string>>;

const CAMPOS: readonly Campo[] = ['nombre', 'direccion', 'telefono'];
const ROTULO: Readonly<Record<Campo, string>> = {
  nombre: 'El nombre',
  direccion: 'La dirección',
  telefono: 'El teléfono',
};
const MAXIMO: Readonly<Record<Campo, number>> = { nombre: 120, direccion: 200, telefono: 40 };

/**
 * Datos del consultorio (RF-13). La usan la secretaría y el administrador. Al guardar se muestra
 * lo que devolvió el backend.
 */
@Component({
  selector: 'app-consultorio',
  imports: [VolverAlInicio],
  template: `
    <app-volver-al-inicio />
    <h1>Datos del consultorio</h1>

    @if (aviso(); as mensaje) {
      <p class="aviso" role="status">{{ mensaje }}</p>
    }
    @if (errorGeneral(); as mensaje) {
      <p class="error" id="error-consultorio" role="alert" tabindex="-1">{{ mensaje }}</p>
    }

    @if (cargando()) {
      <p role="status">Cargando los datos…</p>
    } @else if (datos(); as d) {
      <section class="tarjeta ancha" aria-labelledby="titulo-vigentes">
        <h2 id="titulo-vigentes">Datos vigentes</h2>
        <dl>
          <dt>Nombre</dt>
          <dd id="vigente-nombre">{{ d.nombre }}</dd>
          <dt>Dirección</dt>
          <dd id="vigente-direccion">{{ d.direccion }}</dd>
          <dt>Teléfono</dt>
          <dd id="vigente-telefono">{{ d.telefono }}</dd>
        </dl>
      </section>

      <section class="tarjeta ancha" aria-labelledby="titulo-editar">
        <h2 id="titulo-editar">Editar</h2>
        <form class="formulario" novalidate (submit)="guardar($event, nombre, direccion, telefono)">
          <div class="campo">
            <label for="nombre">Nombre</label>
            <input
              #nombre
              id="nombre"
              name="nombre"
              type="text"
              autocomplete="off"
              [value]="d.nombre"
              [attr.aria-invalid]="errores().nombre ? 'true' : null"
              [attr.aria-describedby]="errores().nombre ? 'error-nombre' : null"
            />
            @if (errores().nombre; as mensaje) {
              <p class="error" id="error-nombre">{{ mensaje }}</p>
            }
          </div>
          <div class="campo">
            <label for="direccion">Dirección</label>
            <input
              #direccion
              id="direccion"
              name="direccion"
              type="text"
              autocomplete="off"
              [value]="d.direccion"
              [attr.aria-invalid]="errores().direccion ? 'true' : null"
              [attr.aria-describedby]="errores().direccion ? 'error-direccion' : null"
            />
            @if (errores().direccion; as mensaje) {
              <p class="error" id="error-direccion">{{ mensaje }}</p>
            }
          </div>
          <div class="campo">
            <label for="telefono">Teléfono</label>
            <input
              #telefono
              id="telefono"
              name="telefono"
              type="text"
              autocomplete="off"
              [value]="d.telefono"
              [attr.aria-invalid]="errores().telefono ? 'true' : null"
              [attr.aria-describedby]="errores().telefono ? 'error-telefono' : null"
            />
            @if (errores().telefono; as mensaje) {
              <p class="error" id="error-telefono">{{ mensaje }}</p>
            }
          </div>
          <button type="submit" class="boton" [disabled]="guardando()">
            {{ guardando() ? 'Guardando…' : 'Guardar cambios' }}
          </button>
        </form>
      </section>
    }
  `,
})
export class ConsultorioPagina implements OnInit {
  private readonly servicio = inject(Consultorio);

  protected readonly datos = signal<DatosConsultorio | null>(null);
  protected readonly cargando = signal(true);
  protected readonly guardando = signal(false);
  protected readonly aviso = signal<string | null>(null);
  protected readonly errorGeneral = signal<string | null>(null);
  protected readonly errores = signal<Errores>({});

  ngOnInit(): void {
    void this.cargar();
  }

  protected async guardar(
    evento: Event,
    nombre: HTMLInputElement,
    direccion: HTMLInputElement,
    telefono: HTMLInputElement,
  ): Promise<void> {
    evento.preventDefault();
    if (this.guardando()) return;
    this.aviso.set(null);
    this.errorGeneral.set(null);

    const nuevos: DatosConsultorio = {
      nombre: nombre.value.trim(),
      direccion: direccion.value.trim(),
      telefono: telefono.value.trim(),
    };
    const errores: Errores = {};
    for (const campo of CAMPOS) {
      if (nuevos[campo].length === 0) {
        errores[campo] = `${ROTULO[campo]} es obligatorio.`;
      } else if ([...nuevos[campo]].length > MAXIMO[campo]) {
        errores[campo] = `${ROTULO[campo]} puede tener hasta ${MAXIMO[campo]} caracteres.`;
      }
    }
    if (this.mostrarErrores(errores)) return;

    this.guardando.set(true);
    try {
      this.datos.set(await this.servicio.editar(nuevos));
      this.errores.set({});
      this.aviso.set('Se guardaron los datos del consultorio.');
    } catch (error) {
      this.mostrarError(error);
    } finally {
      this.guardando.set(false);
    }
  }

  private async cargar(): Promise<void> {
    try {
      this.datos.set(await this.servicio.obtener());
    } catch (error) {
      this.mostrarError(error);
    } finally {
      this.cargando.set(false);
    }
  }

  private mostrarErrores(errores: Errores): boolean {
    this.errores.set(errores);
    const primero = CAMPOS.find((campo) => errores[campo]);
    if (primero) enfocar(primero);
    return primero !== undefined;
  }

  private mostrarError(error: unknown): void {
    const codigo = error instanceof ErrorApi ? error.codigo : '';
    const campos = error instanceof ErrorApi ? error.campos : [];
    if (codigo === 'datos_invalidos' && campos.length > 0) {
      const errores: Errores = {};
      for (const campo of CAMPOS) {
        if (campos.some((c) => c.includes(campo)))
          errores[campo] = `${ROTULO[campo]} no es válido.`;
      }
      if (this.mostrarErrores(errores)) return;
    }
    this.errores.set({});
    this.errorGeneral.set(
      codigo === 'consultorio_no_instalado'
        ? 'El consultorio todavía no está instalado: sus datos se cargan con el comando de instalación. Avisale al administrador.'
        : mensajeDe(error),
    );
    enfocar('error-consultorio');
  }
}
