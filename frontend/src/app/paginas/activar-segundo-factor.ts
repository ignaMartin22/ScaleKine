import { Component, HostListener, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ErrorApi } from '../nucleo/http/error-api';
import { destinoDeSesion } from '../nucleo/sesion/modelo';
import { Sesion } from '../nucleo/sesion/sesion';
import { enfocar, mensajeDe } from '../nucleo/ui/enfocar';

/**
 * Activación del segundo factor del administrador (RNF-04): QR para la aplicación autenticadora,
 * confirmación con un código y entrega única de los códigos de recuperación. Los códigos viven solo
 * en la memoria de este componente: nunca en el almacenamiento del navegador ni en la consola.
 */
@Component({
  selector: 'app-activar-segundo-factor',
  template: `
    <section class="tarjeta">
      <h1>Activar el segundo factor</h1>

      @if (codigos(); as lista) {
        <div class="no-imprimir">
          <p>
            El segundo factor quedó activo. Estos son tus códigos de recuperación: sirven para
            ingresar si perdés el acceso a la aplicación autenticadora. Cada uno se puede usar una
            sola vez.
          </p>
          <p class="aviso" role="status">
            Es la única vez que se muestran. Guardalos ahora en un lugar seguro.
          </p>
        </div>
        <h2 class="solo-imprimir">Códigos de recuperación de ScaleKine</h2>
        <ul class="codigos" aria-label="Códigos de recuperación">
          @for (codigo of lista; track codigo) {
            <li>
              <code>{{ codigo }}</code>
            </li>
          }
        </ul>
        <div class="acciones no-imprimir">
          <button type="button" class="boton secundario" (click)="descargar(lista)">
            Descargar como .txt
          </button>
          <button type="button" class="boton secundario" (click)="imprimir()">Imprimir</button>
        </div>
        <div class="no-imprimir">
          <div class="campo casilla">
            <input
              #guardados
              id="guardados"
              type="checkbox"
              (change)="confirmoGuardado.set(guardados.checked)"
            />
            <label for="guardados">Guardé mis códigos de recuperación en un lugar seguro.</label>
          </div>
          <button
            type="button"
            class="boton"
            [disabled]="!confirmoGuardado() || enviando()"
            (click)="continuar()"
          >
            Continuar
          </button>
        </div>
      } @else {
        <ol class="pasos">
          <li>Instalá una aplicación autenticadora en tu teléfono, si todavía no tenés una.</li>
          <li>Escaneá este código QR con la aplicación.</li>
        </ol>

        @if (qr(); as imagen) {
          <img
            class="qr"
            [src]="imagen"
            width="200"
            height="200"
            alt="Código QR para la aplicación autenticadora"
          />
        } @else if (!errorQr()) {
          <p role="status">Generando el código QR…</p>
        }
        @if (errorQr(); as mensaje) {
          <p class="error" role="alert">{{ mensaje }}</p>
          <button type="button" class="boton secundario" (click)="generarQr()">Reintentar</button>
        }

        @if (qr()) {
          <form class="formulario" novalidate (submit)="confirmar($event, codigo.value)">
            <div class="campo">
              <label for="codigo">Código de seis dígitos que muestra la aplicación</label>
              <input
                #codigo
                id="codigo"
                name="codigo"
                type="text"
                inputmode="numeric"
                autocomplete="one-time-code"
                spellcheck="false"
                [attr.aria-invalid]="errorCodigo() ? 'true' : null"
                [attr.aria-describedby]="errorCodigo() ? 'error-codigo' : null"
              />
              @if (errorCodigo(); as mensaje) {
                <p class="error" id="error-codigo">{{ mensaje }}</p>
              }
            </div>
            <button type="submit" class="boton" [disabled]="enviando()">
              {{ enviando() ? 'Confirmando…' : 'Confirmar y activar' }}
            </button>
          </form>
        }
      }
      @if (errorGeneral(); as mensaje) {
        <p class="error" id="error-formulario" role="alert" tabindex="-1">{{ mensaje }}</p>
      }
    </section>
  `,
})
export class ActivarSegundoFactor implements OnInit, OnDestroy {
  private readonly sesion = inject(Sesion);
  private readonly router = inject(Router);

  protected readonly qr = signal<string | null>(null);
  protected readonly errorQr = signal<string | null>(null);
  protected readonly codigos = signal<string[] | null>(null);
  protected readonly confirmoGuardado = signal(false);
  protected readonly enviando = signal(false);
  protected readonly errorCodigo = signal<string | null>(null);
  protected readonly errorGeneral = signal<string | null>(null);

  ngOnInit(): void {
    void this.generarQr();
  }

  ngOnDestroy(): void {
    this.codigos.set(null);
  }

  /** Mientras los códigos estén en pantalla y sin confirmar, avisa antes de cerrar o recargar la pestaña. */
  @HostListener('window:beforeunload', ['$event'])
  protected avisarAntesDeSalir(evento: BeforeUnloadEvent): void {
    if (this.codigos() && !this.confirmoGuardado()) evento.preventDefault();
  }

  protected async generarQr(): Promise<void> {
    this.errorQr.set(null);
    try {
      this.qr.set(await this.sesion.iniciarActivacion());
    } catch (error) {
      this.errorQr.set(mensajeDe(error));
    }
  }

  protected async confirmar(evento: Event, codigo: string): Promise<void> {
    evento.preventDefault();
    if (this.enviando()) return;
    this.errorCodigo.set(null);
    this.errorGeneral.set(null);

    if (codigo.trim() === '') {
      this.errorCodigo.set('Ingresá el código de seis dígitos.');
      enfocar('codigo');
      return;
    }

    this.enviando.set(true);
    try {
      this.codigos.set(await this.sesion.confirmarActivacion(codigo.trim()));
      this.qr.set(null);
    } catch (error) {
      if (error instanceof ErrorApi && error.codigo === 'codigo_invalido') {
        this.errorCodigo.set(
          'El código no es válido. Revisá que sea el que muestra la aplicación ahora.',
        );
        enfocar('codigo');
      } else {
        this.errorGeneral.set(mensajeDe(error));
        enfocar('error-formulario');
      }
    } finally {
      this.enviando.set(false);
    }
  }

  /** Descarga los códigos como texto plano, sin pasar por el servidor ni por el almacenamiento. */
  protected descargar(codigos: string[]): void {
    const texto = [
      'Códigos de recuperación de ScaleKine',
      '',
      ...codigos,
      '',
      'Cada código se puede usar una sola vez.',
      '',
    ].join('\n');
    const url = URL.createObjectURL(new Blob([texto], { type: 'text/plain;charset=utf-8' }));
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = 'scalekine-codigos-de-recuperacion.txt';
    document.body.append(enlace);
    enlace.click();
    enlace.remove();
    URL.revokeObjectURL(url);
  }

  protected imprimir(): void {
    window.print();
  }

  /** Solo después de confirmar que se guardaron: vuelve a pedir la sesión y sigue el paso que indique el backend. */
  protected async continuar(): Promise<void> {
    if (!this.confirmoGuardado() || this.enviando()) return;
    this.enviando.set(true);
    try {
      const estado = await this.sesion.recargar();
      this.codigos.set(null);
      await this.router.navigateByUrl(estado ? destinoDeSesion(estado) : '/ingresar');
    } finally {
      this.enviando.set(false);
    }
  }
}
