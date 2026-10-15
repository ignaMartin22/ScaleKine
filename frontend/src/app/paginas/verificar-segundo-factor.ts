import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ErrorApi } from '../nucleo/http/error-api';
import { destinoDeSesion } from '../nucleo/sesion/modelo';
import { Sesion } from '../nucleo/sesion/sesion';
import { enfocar, mensajeDe } from '../nucleo/ui/enfocar';
import { Icono } from '../nucleo/ui/icono';

/** Verificación del segundo factor con un código de la aplicación o uno de recuperación (RNF-04). */
@Component({
  imports: [Icono],
  selector: 'app-verificar-segundo-factor',
  template: `
    <section class="tarjeta">
      <h1>Verificar tu identidad</h1>
      <p id="ayuda-codigo">
        Ingresá el código de seis dígitos de tu aplicación autenticadora. Si no la tenés a mano,
        podés usar uno de tus códigos de recuperación (cada uno sirve una sola vez).
      </p>

      @if (errorGeneral(); as mensaje) {
        <p class="error" id="error-formulario" role="alert" tabindex="-1">
          <app-icono nombre="alerta" />{{ mensaje }}
        </p>
      }

      <form class="formulario" novalidate (submit)="enviar($event, codigo.value)">
        <div class="campo">
          <label for="codigo">Código</label>
          <input
            #codigo
            id="codigo"
            name="codigo"
            type="text"
            autocomplete="one-time-code"
            autocapitalize="off"
            spellcheck="false"
            [attr.aria-invalid]="errorCodigo() ? 'true' : null"
            [attr.aria-describedby]="errorCodigo() ? 'ayuda-codigo error-codigo' : 'ayuda-codigo'"
          />
          @if (errorCodigo(); as mensaje) {
            <p class="error" id="error-codigo"><app-icono nombre="alerta" />{{ mensaje }}</p>
          }
        </div>
        <button type="submit" class="boton" [disabled]="enviando()">
          {{ enviando() ? 'Verificando…' : 'Verificar' }}
        </button>
      </form>
    </section>
  `,
})
export class VerificarSegundoFactor {
  private readonly sesion = inject(Sesion);
  private readonly router = inject(Router);

  protected readonly enviando = signal(false);
  protected readonly errorCodigo = signal<string | null>(null);
  protected readonly errorGeneral = signal<string | null>(null);

  protected async enviar(evento: Event, codigo: string): Promise<void> {
    evento.preventDefault();
    if (this.enviando()) return;
    this.errorCodigo.set(null);
    this.errorGeneral.set(null);

    if (codigo.trim() === '') {
      this.errorCodigo.set('Ingresá un código.');
      enfocar('codigo');
      return;
    }

    this.enviando.set(true);
    try {
      const estado = await this.sesion.verificarSegundoFactor(codigo.trim());
      await this.router.navigateByUrl(estado ? destinoDeSesion(estado) : '/ingresar');
    } catch (error) {
      if (error instanceof ErrorApi && error.codigo === 'segundo_factor_invalido') {
        this.errorCodigo.set(error.message);
        enfocar('codigo');
      } else {
        this.errorGeneral.set(mensajeDe(error));
        enfocar('error-formulario');
      }
    } finally {
      this.enviando.set(false);
    }
  }
}
