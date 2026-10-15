import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ErrorApi } from '../nucleo/http/error-api';
import {
  Kinesiologos,
  NOMBRE_DEL_BLOQUE,
  type Bloque,
  type Kinesiologo,
} from '../nucleo/kinesiologos/kinesiologos';
import { enfocar, mensajeDe } from '../nucleo/ui/enfocar';
import { Icono } from '../nucleo/ui/icono';
import { VolverAlInicio } from './volver-al-inicio';

/** Mismo mínimo que la política del backend (RNF-03). */
const LARGO_MINIMO = 12;
const LARGO_MINIMO_USUARIO = 3;

const CODIGOS_DE_POLITICA = ['contrasena_en_blanco', 'contrasena_corta', 'contrasena_comun'];

type Campo = 'nombre' | 'bloque' | 'usuario' | 'temporal';
type Errores = Partial<Record<Campo, string>>;
const ORDEN: readonly Campo[] = ['nombre', 'bloque', 'usuario', 'temporal'];

const esBloque = (valor: string): valor is Bloque => valor === 'manana' || valor === 'tarde';

/**
 * Kinesiólogos (RF-14, RF-16). Solo para el administrador: la ruta lo exige y el backend lo vuelve
 * a comprobar con el rol de la sesión. Después de cada operación se vuelve a pedir el listado. La
 * contraseña temporal no se guarda: el campo se limpia después de cada intento.
 */
@Component({
  selector: 'app-kinesiologos-admin',
  imports: [RouterLink, Icono, VolverAlInicio],
  template: `
    <app-volver-al-inicio />
    <h1>Kinesiólogos</h1>

    @if (aviso(); as mensaje) {
      <p class="info" role="status"><app-icono nombre="info" />{{ mensaje }}</p>
    }
    @if (errorGeneral(); as mensaje) {
      <p class="error" id="error-kinesiologos" role="alert" tabindex="-1">
        <app-icono nombre="alerta" />{{ mensaje }}
      </p>
    }

    <section class="tarjeta ancha" aria-labelledby="titulo-alta">
      <h2 id="titulo-alta">Nuevo kinesiólogo</h2>
      <p id="ayuda-temporal">
        Se crean juntos su perfil, su agenda y su cuenta. Elegí una contraseña temporal de al menos
        {{ largoMinimo }} caracteres que no sea una contraseña muy común: tendrá que cambiarla en su
        primer ingreso. Después, la cuenta se gestiona desde
        <a routerLink="/admin/cuentas">Cuentas</a> (restablecer la contraseña o desactivarla).
      </p>
      <form
        class="formulario"
        novalidate
        (submit)="crear($event, nombre, bloqueAlta, usuario, temporal)"
      >
        <div class="campo">
          <label for="nombre">Nombre</label>
          <input
            #nombre
            id="nombre"
            name="nombre"
            type="text"
            autocomplete="off"
            [attr.aria-invalid]="erroresAlta().nombre ? 'true' : null"
            [attr.aria-describedby]="erroresAlta().nombre ? 'error-nombre' : null"
          />
          @if (erroresAlta().nombre; as mensaje) {
            <p class="error" id="error-nombre"><app-icono nombre="alerta" />{{ mensaje }}</p>
          }
        </div>
        <div class="campo">
          <label for="bloque">Bloque</label>
          <select
            #bloqueAlta
            id="bloque"
            name="bloque"
            [attr.aria-invalid]="erroresAlta().bloque ? 'true' : null"
            [attr.aria-describedby]="erroresAlta().bloque ? 'error-bloque' : null"
          >
            <option value="">Elegí un bloque</option>
            <option value="manana">Mañana</option>
            <option value="tarde">Tarde</option>
          </select>
          @if (erroresAlta().bloque; as mensaje) {
            <p class="error" id="error-bloque"><app-icono nombre="alerta" />{{ mensaje }}</p>
          }
        </div>
        <div class="campo">
          <label for="usuario">Nombre de usuario</label>
          <input
            #usuario
            id="usuario"
            name="usuario"
            type="text"
            autocomplete="off"
            autocapitalize="none"
            spellcheck="false"
            [attr.aria-invalid]="erroresAlta().usuario ? 'true' : null"
            [attr.aria-describedby]="erroresAlta().usuario ? 'error-usuario' : null"
          />
          @if (erroresAlta().usuario; as mensaje) {
            <p class="error" id="error-usuario"><app-icono nombre="alerta" />{{ mensaje }}</p>
          }
        </div>
        <div class="campo">
          <label for="temporal">Contraseña temporal</label>
          <input
            #temporal
            id="temporal"
            name="temporal"
            type="password"
            autocomplete="new-password"
            [attr.aria-invalid]="erroresAlta().temporal ? 'true' : null"
            [attr.aria-describedby]="
              erroresAlta().temporal ? 'ayuda-temporal error-temporal' : 'ayuda-temporal'
            "
          />
          @if (erroresAlta().temporal; as mensaje) {
            <p class="error" id="error-temporal"><app-icono nombre="alerta" />{{ mensaje }}</p>
          }
        </div>
        <button type="submit" class="boton" [disabled]="creando()">
          {{ creando() ? 'Creando…' : 'Crear kinesiólogo' }}
        </button>
      </form>
    </section>

    @if (panel(); as p) {
      <section class="tarjeta ancha" aria-labelledby="titulo-panel">
        <h2 id="titulo-panel">Cambiar el bloque de {{ p.nombre }}</h2>
        <p id="ayuda-bloque">
          Los turnos que ya tiene asignados no se mueven: si hace falta, se reprograman a mano.
        </p>
        <form class="formulario" novalidate (submit)="cambiarBloque($event, p, nuevoBloque)">
          <div class="campo">
            <label for="nuevo-bloque">Bloque nuevo</label>
            <select
              #nuevoBloque
              id="nuevo-bloque"
              name="nuevo-bloque"
              aria-describedby="ayuda-bloque"
            >
              <option value="manana" [selected]="p.bloque === 'tarde'">Mañana</option>
              <option value="tarde" [selected]="p.bloque === 'manana'">Tarde</option>
            </select>
          </div>
          @if (errorPanel(); as mensaje) {
            <p class="error" id="error-panel" role="alert">
              <app-icono nombre="alerta" />{{ mensaje }}
            </p>
          }
          <div class="acciones">
            <button type="submit" class="boton" [disabled]="trabajando()">
              {{ trabajando() ? 'Guardando…' : 'Cambiar bloque' }}
            </button>
            <button type="button" class="boton secundario" (click)="cerrarPanel()">Cancelar</button>
          </div>
        </form>
      </section>
    }

    <section aria-labelledby="titulo-listado">
      <h2 id="titulo-listado">Kinesiólogos existentes</h2>
      <div class="campo">
        <label for="filtro">Filtrar por bloque</label>
        <select #filtroBloque id="filtro" name="filtro" (change)="filtrar(filtroBloque.value)">
          <option value="">Todos</option>
          <option value="manana">Mañana</option>
          <option value="tarde">Tarde</option>
        </select>
      </div>
      @if (cargando()) {
        <p role="status">Cargando kinesiólogos…</p>
      } @else if (kinesiologos().length === 0 && !errorGeneral()) {
        <p>No hay kinesiólogos para mostrar.</p>
      } @else if (kinesiologos().length > 0) {
        <div class="tabla-contenedor">
          <table class="tabla">
            <caption class="solo-lectores">
              Kinesiólogos del consultorio
            </caption>
            <thead>
              <tr>
                <th scope="col">Nombre</th>
                <th scope="col">Bloque</th>
                <th scope="col">Cuenta</th>
                <th scope="col">Acciones</th>
              </tr>
            </thead>
            <tbody>
              @for (k of kinesiologos(); track k.id) {
                <tr>
                  <th scope="row">{{ k.nombre }}</th>
                  <td>{{ nombreDelBloque(k.bloque) }}</td>
                  <td>{{ k.activo ? 'Activa' : 'Desactivada' }}</td>
                  <td>
                    <button
                      type="button"
                      class="boton secundario"
                      [attr.id]="'bloque-' + k.id"
                      (click)="abrirPanel(k)"
                    >
                      <app-icono nombre="lapiz" />Cambiar bloque
                      <span class="solo-lectores"> de {{ k.nombre }}</span>
                    </button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </section>
  `,
})
export class KinesiologosAdmin implements OnInit {
  private readonly servicio = inject(Kinesiologos);
  private filtro: Bloque | undefined;

  protected readonly largoMinimo = LARGO_MINIMO;
  protected readonly kinesiologos = signal<Kinesiologo[]>([]);
  protected readonly cargando = signal(true);
  protected readonly creando = signal(false);
  protected readonly trabajando = signal(false);
  protected readonly aviso = signal<string | null>(null);
  protected readonly errorGeneral = signal<string | null>(null);
  protected readonly erroresAlta = signal<Errores>({});
  protected readonly panel = signal<Kinesiologo | null>(null);
  protected readonly errorPanel = signal<string | null>(null);

  ngOnInit(): void {
    void this.recargar();
  }

  protected nombreDelBloque(bloque: Bloque): string {
    return NOMBRE_DEL_BLOQUE[bloque];
  }

  protected filtrar(valor: string): void {
    this.filtro = esBloque(valor) ? valor : undefined;
    this.aviso.set(null);
    this.errorGeneral.set(null);
    void this.recargar();
  }

  protected async crear(
    evento: Event,
    campoNombre: HTMLInputElement,
    campoBloque: HTMLSelectElement,
    campoUsuario: HTMLInputElement,
    campoTemporal: HTMLInputElement,
  ): Promise<void> {
    evento.preventDefault();
    if (this.creando()) return;
    this.aviso.set(null);
    this.errorGeneral.set(null);

    const nombre = campoNombre.value.trim();
    const usuario = campoUsuario.value.trim();
    const temporal = campoTemporal.value;
    const bloque = campoBloque.value;
    const errores: Errores = {};
    if (nombre.length === 0) errores.nombre = 'El nombre es obligatorio.';
    if (!esBloque(bloque)) errores.bloque = 'Elegí el bloque: mañana o tarde.';
    if ([...usuario].length < LARGO_MINIMO_USUARIO) {
      errores.usuario = `El nombre de usuario debe tener al menos ${LARGO_MINIMO_USUARIO} caracteres.`;
    }
    if ([...temporal.trim()].length < LARGO_MINIMO) {
      errores.temporal = `La contraseña temporal debe tener al menos ${LARGO_MINIMO} caracteres.`;
    }
    if (this.mostrarErroresAlta(errores) || !esBloque(bloque)) {
      campoTemporal.value = '';
      return;
    }

    this.creando.set(true);
    try {
      const creado = await this.servicio.crear({
        nombre,
        bloque,
        nombreUsuario: usuario,
        contrasenaTemporal: temporal,
      });
      this.erroresAlta.set({});
      campoNombre.value = '';
      campoBloque.value = '';
      campoUsuario.value = '';
      this.aviso.set(
        `Se creó el kinesiólogo ${creado.nombre} (bloque ${NOMBRE_DEL_BLOQUE[creado.bloque].toLowerCase()}). Pasale la contraseña temporal por un canal seguro: tendrá que cambiarla al ingresar.`,
      );
      await this.recargar();
    } catch (error) {
      this.mostrarErrorDeAlta(error);
    } finally {
      campoTemporal.value = '';
      this.creando.set(false);
    }
  }

  protected abrirPanel(kinesiologo: Kinesiologo): void {
    this.aviso.set(null);
    this.errorGeneral.set(null);
    this.errorPanel.set(null);
    this.panel.set(kinesiologo);
    enfocar('nuevo-bloque');
  }

  protected cerrarPanel(): void {
    const abierto = this.panel();
    this.panel.set(null);
    this.errorPanel.set(null);
    if (abierto) enfocar(`bloque-${abierto.id}`);
  }

  protected async cambiarBloque(
    evento: Event,
    kinesiologo: Kinesiologo,
    campo: HTMLSelectElement,
  ): Promise<void> {
    evento.preventDefault();
    if (this.trabajando()) return;
    this.errorPanel.set(null);
    const bloque = campo.value;
    if (!esBloque(bloque)) return;

    this.trabajando.set(true);
    try {
      const actualizado = await this.servicio.cambiarBloque(kinesiologo.id, bloque);
      this.panel.set(null);
      this.aviso.set(
        `${actualizado.nombre} ahora atiende en el bloque ${NOMBRE_DEL_BLOQUE[actualizado.bloque].toLowerCase()}. Sus turnos ya asignados no se movieron.`,
      );
      await this.recargar();
      enfocar(`bloque-${actualizado.id}`);
    } catch (error) {
      if (error instanceof ErrorApi && error.codigo === 'kinesiologo_no_encontrado') {
        this.panel.set(null);
        this.mostrarErrorGeneral('El kinesiólogo ya no existe.');
        await this.recargar();
      } else {
        this.errorPanel.set(mensajeDe(error));
        enfocar('nuevo-bloque');
      }
    } finally {
      this.trabajando.set(false);
    }
  }

  private async recargar(): Promise<void> {
    try {
      this.kinesiologos.set(await this.servicio.listar(this.filtro));
    } catch (error) {
      this.mostrarErrorGeneral(mensajeDe(error));
    } finally {
      this.cargando.set(false);
    }
  }

  private mostrarErroresAlta(errores: Errores): boolean {
    this.erroresAlta.set(errores);
    const primero = ORDEN.find((campo) => errores[campo]);
    if (primero) enfocar(primero);
    return primero !== undefined;
  }

  private mostrarErrorDeAlta(error: unknown): void {
    const mensaje = mensajeDe(error);
    const codigo = error instanceof ErrorApi ? error.codigo : '';
    const campos = error instanceof ErrorApi ? error.campos : [];
    if (codigo === 'nombre_usuario_en_uso') {
      this.mostrarErroresAlta({ usuario: 'Ya existe una cuenta con ese nombre de usuario.' });
    } else if (CODIGOS_DE_POLITICA.includes(codigo)) {
      this.mostrarErroresAlta({ temporal: mensaje });
    } else if (codigo === 'datos_invalidos' && campos.length > 0) {
      const errores: Errores = {};
      if (campos.some((c) => c.includes('nombreUsuario'))) {
        errores.usuario = 'El nombre de usuario no es válido.';
      }
      if (campos.some((c) => c === 'nombre' || c.endsWith('.nombre'))) {
        errores.nombre = 'El nombre no es válido.';
      }
      if (campos.some((c) => c.includes('bloque'))) errores.bloque = 'El bloque no es válido.';
      if (campos.some((c) => c.includes('contrasenaTemporal'))) {
        errores.temporal = mensaje;
      }
      if (!this.mostrarErroresAlta(errores)) this.mostrarErrorGeneral(mensaje);
    } else {
      this.erroresAlta.set({});
      this.mostrarErrorGeneral(mensaje);
    }
  }

  private mostrarErrorGeneral(mensaje: string): void {
    this.errorGeneral.set(mensaje);
    enfocar('error-kinesiologos');
  }
}
