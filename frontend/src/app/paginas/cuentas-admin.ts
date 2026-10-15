import { Component, OnInit, inject, signal } from '@angular/core';
import { Cuentas, type CuentaListada } from '../nucleo/cuentas/cuentas';
import { ErrorApi } from '../nucleo/http/error-api';
import { enfocar, mensajeDe } from '../nucleo/ui/enfocar';
import { Icono } from '../nucleo/ui/icono';
import { VolverAlInicio } from './volver-al-inicio';

/** Mismo mínimo que la política del backend (RNF-03). */
const LARGO_MINIMO = 12;
const LARGO_MINIMO_USUARIO = 3;

const CODIGOS_DE_POLITICA = ['contrasena_en_blanco', 'contrasena_corta', 'contrasena_comun'];

const NOMBRE_DEL_ROL = {
  administrador: 'Administrador',
  secretaria: 'Secretaría',
  kinesiologo: 'Kinesiólogo',
} as const;

const MENSAJE_POR_CODIGO: Readonly<Record<string, string>> = {
  cuenta_inactiva: 'La cuenta está desactivada: no se puede restablecer su contraseña.',
  cuenta_de_administrador:
    'La cuenta del administrador no se gestiona desde acá: se restablece por línea de comandos.',
  cuenta_no_encontrada: 'La cuenta ya no existe.',
};

type CampoAlta = 'usuario' | 'temporal';
type ErroresAlta = Partial<Record<CampoAlta, string>>;

interface Panel {
  tipo: 'restablecer' | 'desactivar';
  cuenta: CuentaListada;
}

/**
 * Administración de cuentas (RF-04, RF-08, RF-09). Solo para el administrador: la ruta lo exige y
 * el backend lo vuelve a comprobar con el rol de la sesión. Después de cada operación se vuelve a
 * pedir el listado al backend. Las contraseñas temporales no se guardan: el campo se limpia apenas
 * se usa.
 */
@Component({
  selector: 'app-cuentas-admin',
  imports: [Icono, VolverAlInicio],
  template: `
    <app-volver-al-inicio />
    <h1>Cuentas</h1>

    @if (aviso(); as mensaje) {
      <p class="info" role="status"><app-icono nombre="info" />{{ mensaje }}</p>
    }
    @if (errorGeneral(); as mensaje) {
      <p class="error" id="error-cuentas" role="alert" tabindex="-1">
        <app-icono nombre="alerta" />{{ mensaje }}
      </p>
    }

    <section class="tarjeta ancha" aria-labelledby="titulo-alta">
      <h2 id="titulo-alta">Nueva cuenta de secretaría</h2>
      <p id="ayuda-temporal">
        Elegí una contraseña temporal de al menos {{ largoMinimo }} caracteres que no sea una
        contraseña muy común. La secretaria tendrá que cambiarla en su primer ingreso. Las cuentas
        de kinesiólogo se crean junto con su perfil.
      </p>
      <form class="formulario" novalidate (submit)="crear($event, usuario, temporal)">
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
          {{ creando() ? 'Creando…' : 'Crear cuenta' }}
        </button>
      </form>
    </section>

    @if (panel(); as p) {
      <section class="tarjeta ancha" aria-labelledby="titulo-panel">
        @if (p.tipo === 'restablecer') {
          <h2 id="titulo-panel">Restablecer la contraseña de {{ p.cuenta.nombreUsuario }}</h2>
          <p id="ayuda-restablecer">
            Se cierran todas sus sesiones abiertas y se levanta el bloqueo por intentos fallidos.
            Tendrá que cambiar la contraseña en su próximo ingreso. Debe tener al menos
            {{ largoMinimo }} caracteres y no ser una contraseña muy común.
          </p>
          <form class="formulario" novalidate (submit)="restablecer($event, p.cuenta, nueva)">
            <div class="campo">
              <label for="nueva-temporal">Contraseña temporal nueva</label>
              <input
                #nueva
                id="nueva-temporal"
                name="nueva-temporal"
                type="password"
                autocomplete="new-password"
                [attr.aria-invalid]="errorPanel() ? 'true' : null"
                [attr.aria-describedby]="
                  errorPanel() ? 'ayuda-restablecer error-nueva-temporal' : 'ayuda-restablecer'
                "
              />
              @if (errorPanel(); as mensaje) {
                <p class="error" id="error-nueva-temporal">
                  <app-icono nombre="alerta" />{{ mensaje }}
                </p>
              }
            </div>
            <div class="acciones">
              <button type="submit" class="boton peligro" [disabled]="trabajando()">
                <app-icono nombre="contrasena" />{{
                  trabajando() ? 'Restableciendo…' : 'Restablecer contraseña'
                }}
              </button>
              <button type="button" class="boton secundario" (click)="cerrarPanel()">
                Cancelar
              </button>
            </div>
          </form>
        } @else {
          <h2 id="titulo-panel" tabindex="-1">Desactivar la cuenta {{ p.cuenta.nombreUsuario }}</h2>
          <p>
            La cuenta no podrá volver a ingresar y se cierran sus sesiones abiertas. Esta acción no
            se puede deshacer: las cuentas no se reactivan ni se borran.
          </p>
          @if (errorPanel(); as mensaje) {
            <p class="error" id="error-desactivar" role="alert">
              <app-icono nombre="alerta" />{{ mensaje }}
            </p>
          }
          <div class="acciones">
            <button
              type="button"
              class="boton peligro"
              [disabled]="trabajando()"
              (click)="desactivar(p.cuenta)"
            >
              <app-icono nombre="usuario-baja" />{{
                trabajando() ? 'Desactivando…' : 'Sí, desactivar la cuenta'
              }}
            </button>
            <button type="button" class="boton secundario" (click)="cerrarPanel()">
              No, cancelar
            </button>
          </div>
        }
      </section>
    }

    <section aria-labelledby="titulo-listado">
      <h2 id="titulo-listado">Cuentas existentes</h2>
      @if (cargando()) {
        <p role="status">Cargando cuentas…</p>
      } @else if (cuentas().length === 0 && !errorGeneral()) {
        <p>No hay cuentas para mostrar.</p>
      } @else if (cuentas().length > 0) {
        <div class="tabla-contenedor">
          <table class="tabla">
            <caption class="solo-lectores">
              Cuentas del sistema
            </caption>
            <thead>
              <tr>
                <th scope="col">Usuario</th>
                <th scope="col">Rol</th>
                <th scope="col">Estado</th>
                <th scope="col">Contraseña</th>
                <th scope="col">Acciones</th>
              </tr>
            </thead>
            <tbody>
              @for (c of cuentas(); track c.id) {
                <tr>
                  <th scope="row">{{ c.nombreUsuario }}</th>
                  <td>{{ nombreDelRol(c.rol) }}</td>
                  <td>{{ c.activo ? 'Activa' : 'Desactivada' }}</td>
                  <td>{{ c.debeCambiarContrasena ? 'Debe cambiarla' : 'Vigente' }}</td>
                  <td>
                    @if (c.rol === 'administrador') {
                      <span>Sin acciones (se gestiona por línea de comandos)</span>
                    } @else if (!c.activo) {
                      <span>Sin acciones</span>
                    } @else {
                      <div class="acciones">
                        <button
                          type="button"
                          class="boton peligro"
                          [attr.id]="'restablecer-' + c.id"
                          (click)="abrirPanel('restablecer', c)"
                        >
                          <app-icono nombre="contrasena" />Restablecer contraseña
                          <span class="solo-lectores"> de {{ c.nombreUsuario }}</span>
                        </button>
                        <button
                          type="button"
                          class="boton peligro"
                          [attr.id]="'desactivar-' + c.id"
                          (click)="abrirPanel('desactivar', c)"
                        >
                          <app-icono nombre="usuario-baja" />Desactivar
                          <span class="solo-lectores"> la cuenta de {{ c.nombreUsuario }}</span>
                        </button>
                      </div>
                    }
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
export class CuentasAdmin implements OnInit {
  private readonly servicio = inject(Cuentas);

  protected readonly largoMinimo = LARGO_MINIMO;
  protected readonly cuentas = signal<CuentaListada[]>([]);
  protected readonly cargando = signal(true);
  protected readonly creando = signal(false);
  protected readonly trabajando = signal(false);
  protected readonly aviso = signal<string | null>(null);
  protected readonly errorGeneral = signal<string | null>(null);
  protected readonly erroresAlta = signal<ErroresAlta>({});
  protected readonly panel = signal<Panel | null>(null);
  protected readonly errorPanel = signal<string | null>(null);

  ngOnInit(): void {
    void this.recargar();
  }

  protected nombreDelRol(rol: CuentaListada['rol']): string {
    return NOMBRE_DEL_ROL[rol];
  }

  protected async crear(
    evento: Event,
    campoUsuario: HTMLInputElement,
    campoTemporal: HTMLInputElement,
  ): Promise<void> {
    evento.preventDefault();
    if (this.creando()) return;
    this.aviso.set(null);
    this.errorGeneral.set(null);

    const nombre = campoUsuario.value.trim();
    const temporal = campoTemporal.value;
    const errores: ErroresAlta = {};
    if ([...nombre].length < LARGO_MINIMO_USUARIO) {
      errores.usuario = `El nombre de usuario debe tener al menos ${LARGO_MINIMO_USUARIO} caracteres.`;
    }
    if ([...temporal.trim()].length < LARGO_MINIMO) {
      errores.temporal = `La contraseña temporal debe tener al menos ${LARGO_MINIMO} caracteres.`;
    }
    if (this.mostrarErroresAlta(errores)) return;

    this.creando.set(true);
    try {
      const cuenta = await this.servicio.crearSecretaria(nombre, temporal);
      this.erroresAlta.set({});
      campoUsuario.value = '';
      this.aviso.set(
        `Se creó la cuenta ${cuenta.nombreUsuario}. Pasale la contraseña temporal por un canal seguro: tendrá que cambiarla al ingresar.`,
      );
      await this.recargar();
    } catch (error) {
      this.mostrarErrorDeAlta(error);
    } finally {
      campoTemporal.value = '';
      this.creando.set(false);
    }
  }

  protected abrirPanel(tipo: Panel['tipo'], cuenta: CuentaListada): void {
    this.aviso.set(null);
    this.errorGeneral.set(null);
    this.errorPanel.set(null);
    this.panel.set({ tipo, cuenta });
    enfocar(tipo === 'restablecer' ? 'nueva-temporal' : 'titulo-panel');
  }

  protected cerrarPanel(): void {
    const abierto = this.panel();
    this.panel.set(null);
    this.errorPanel.set(null);
    if (abierto) enfocar(`${abierto.tipo}-${abierto.cuenta.id}`);
  }

  protected async restablecer(
    evento: Event,
    cuenta: CuentaListada,
    campo: HTMLInputElement,
  ): Promise<void> {
    evento.preventDefault();
    if (this.trabajando()) return;
    this.errorPanel.set(null);
    const temporal = campo.value;
    if ([...temporal.trim()].length < LARGO_MINIMO) {
      this.errorPanel.set(`La contraseña temporal debe tener al menos ${LARGO_MINIMO} caracteres.`);
      enfocar('nueva-temporal');
      return;
    }

    this.trabajando.set(true);
    try {
      await this.servicio.restablecer(cuenta.id, temporal);
      campo.value = '';
      this.panel.set(null);
      this.aviso.set(
        `Se restableció la contraseña de ${cuenta.nombreUsuario}: sus sesiones se cerraron y se levantó el bloqueo. Tendrá que cambiarla al ingresar.`,
      );
      await this.recargar();
    } catch (error) {
      campo.value = '';
      await this.mostrarErrorDelPanel(error);
    } finally {
      this.trabajando.set(false);
    }
  }

  protected async desactivar(cuenta: CuentaListada): Promise<void> {
    if (this.trabajando()) return;
    this.errorPanel.set(null);
    this.trabajando.set(true);
    try {
      await this.servicio.desactivar(cuenta.id);
      this.panel.set(null);
      this.aviso.set(`Se desactivó la cuenta ${cuenta.nombreUsuario} y se cerraron sus sesiones.`);
      await this.recargar();
    } catch (error) {
      await this.mostrarErrorDelPanel(error);
    } finally {
      this.trabajando.set(false);
    }
  }

  private async recargar(): Promise<void> {
    try {
      this.cuentas.set(await this.servicio.listar());
    } catch (error) {
      this.mostrarErrorGeneral(mensajeDe(error));
    } finally {
      this.cargando.set(false);
    }
  }

  private mostrarErroresAlta(errores: ErroresAlta): boolean {
    this.erroresAlta.set(errores);
    const primero = (['usuario', 'temporal'] as const).find((campo) => errores[campo]);
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
      const errores: ErroresAlta = {};
      if (campos.some((c) => c.includes('nombreUsuario'))) {
        errores.usuario = 'El nombre de usuario no es válido.';
      }
      if (campos.some((c) => c.includes('contrasenaTemporal'))) {
        errores.temporal = 'La contraseña temporal no es válida.';
      }
      if (!this.mostrarErroresAlta(errores)) this.mostrarErrorGeneral(mensaje);
    } else {
      this.erroresAlta.set({});
      this.mostrarErrorGeneral(mensaje);
    }
  }

  /** Política: va en el campo. Estado de la cuenta: mensaje claro y listado al día. */
  private async mostrarErrorDelPanel(error: unknown): Promise<void> {
    const codigo = error instanceof ErrorApi ? error.codigo : '';
    if (CODIGOS_DE_POLITICA.includes(codigo) || codigo === 'datos_invalidos') {
      this.errorPanel.set(mensajeDe(error));
      enfocar('nueva-temporal');
      return;
    }
    this.panel.set(null);
    this.mostrarErrorGeneral(
      Object.hasOwn(MENSAJE_POR_CODIGO, codigo) ? MENSAJE_POR_CODIGO[codigo]! : mensajeDe(error),
    );
    await this.recargar();
  }

  private mostrarErrorGeneral(mensaje: string): void {
    this.errorGeneral.set(mensaje);
    enfocar('error-cuentas');
  }
}
