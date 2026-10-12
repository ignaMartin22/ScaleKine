import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ErrorApi } from '../nucleo/http/error-api';
import { destinoDeSesion } from '../nucleo/sesion/modelo';
import { Sesion } from '../nucleo/sesion/sesion';
import { enfocar, mensajeDe } from '../nucleo/ui/enfocar';

/** Mismo mínimo que la política del backend (RNF-03). */
const LARGO_MINIMO = 12;

const CODIGOS_DE_CONTRASENA_NUEVA = [
  'contrasena_en_blanco',
  'contrasena_corta',
  'contrasena_comun',
  'contrasena_igual_a_la_actual',
];

type Campo = 'actual' | 'nueva' | 'repetida';
type Errores = Partial<Record<Campo, string>>;

/**
 * Cambio de contraseña: obligatorio en el primer ingreso o tras un restablecimiento (RF-06), o
 * voluntario desde el menú (RF-07).
 */
@Component({
  selector: 'app-cambiar-contrasena',
  template: `
    <section class="tarjeta">
      <h1>Cambiar contraseña</h1>
      @if (obligatorio()) {
        <p>Tenés que elegir una contraseña nueva antes de seguir usando el sistema.</p>
      } @else {
        <p>Al cambiarla se cierran tus sesiones abiertas en otros dispositivos.</p>
      }
      <p id="ayuda-nueva">
        La contraseña nueva debe tener al menos {{ largoMinimo }} caracteres y no puede ser una
        contraseña muy común.
      </p>

      @if (listo()) {
        <p class="aviso" role="status">Tu contraseña se cambió. Las demás sesiones se cerraron.</p>
      }
      @if (errorGeneral(); as mensaje) {
        <p class="error" id="error-formulario" role="alert" tabindex="-1">{{ mensaje }}</p>
      }

      <form
        class="formulario"
        novalidate
        (submit)="enviar($event, actual.value, nueva.value, repetida.value)"
      >
        <div class="campo">
          <label for="actual">Contraseña actual</label>
          <input
            #actual
            id="actual"
            name="actual"
            type="password"
            autocomplete="current-password"
            [attr.aria-invalid]="errores().actual ? 'true' : null"
            [attr.aria-describedby]="errores().actual ? 'error-actual' : null"
          />
          @if (errores().actual; as mensaje) {
            <p class="error" id="error-actual">{{ mensaje }}</p>
          }
        </div>
        <div class="campo">
          <label for="nueva">Contraseña nueva</label>
          <input
            #nueva
            id="nueva"
            name="nueva"
            type="password"
            autocomplete="new-password"
            [attr.aria-invalid]="errores().nueva ? 'true' : null"
            [attr.aria-describedby]="errores().nueva ? 'ayuda-nueva error-nueva' : 'ayuda-nueva'"
          />
          @if (errores().nueva; as mensaje) {
            <p class="error" id="error-nueva">{{ mensaje }}</p>
          }
        </div>
        <div class="campo">
          <label for="repetida">Repetir la contraseña nueva</label>
          <input
            #repetida
            id="repetida"
            name="repetida"
            type="password"
            autocomplete="new-password"
            [attr.aria-invalid]="errores().repetida ? 'true' : null"
            [attr.aria-describedby]="errores().repetida ? 'error-repetida' : null"
          />
          @if (errores().repetida; as mensaje) {
            <p class="error" id="error-repetida">{{ mensaje }}</p>
          }
        </div>
        <button type="submit" class="boton" [disabled]="enviando()">
          {{ enviando() ? 'Guardando…' : 'Cambiar contraseña' }}
        </button>
      </form>
    </section>
  `,
})
export class CambiarContrasena {
  private readonly sesion = inject(Sesion);
  private readonly router = inject(Router);

  protected readonly largoMinimo = LARGO_MINIMO;
  protected readonly obligatorio = computed(
    () => this.sesion.pasoPendiente() === 'cambiar_contrasena',
  );
  protected readonly enviando = signal(false);
  protected readonly listo = signal(false);
  protected readonly errores = signal<Errores>({});
  protected readonly errorGeneral = signal<string | null>(null);

  protected async enviar(
    evento: Event,
    actual: string,
    nueva: string,
    repetida: string,
  ): Promise<void> {
    evento.preventDefault();
    if (this.enviando()) return;
    this.errorGeneral.set(null);
    this.listo.set(false);

    const errores: Errores = {};
    if (actual === '') errores.actual = 'Ingresá tu contraseña actual.';
    if ([...nueva.trim()].length < LARGO_MINIMO) {
      errores.nueva = `La contraseña nueva debe tener al menos ${LARGO_MINIMO} caracteres.`;
    }
    if (nueva !== repetida) errores.repetida = 'Las dos contraseñas nuevas no coinciden.';
    if (this.mostrarErrores(errores)) return;

    this.enviando.set(true);
    try {
      const eraObligatorio = this.obligatorio();
      const estado = await this.sesion.cambiarContrasena(actual, nueva);
      if (eraObligatorio) {
        // El paso se resolvió: sigue lo que el backend indique (por ejemplo, activar el segundo factor).
        await this.router.navigateByUrl(estado ? destinoDeSesion(estado) : '/ingresar');
      } else {
        this.errores.set({});
        this.listo.set(true);
      }
    } catch (error) {
      this.mostrarErrorDelBackend(error);
    } finally {
      this.enviando.set(false);
    }
  }

  /** Muestra los errores de campo y lleva el foco al primero. Devuelve si había alguno. */
  private mostrarErrores(errores: Errores): boolean {
    this.errores.set(errores);
    const primero = (['actual', 'nueva', 'repetida'] as const).find((campo) => errores[campo]);
    if (primero) enfocar(primero);
    return primero !== undefined;
  }

  private mostrarErrorDelBackend(error: unknown): void {
    const mensaje = mensajeDe(error);
    const codigo = error instanceof ErrorApi ? error.codigo : '';
    if (codigo === 'contrasena_actual_incorrecta') {
      this.mostrarErrores({ actual: mensaje });
    } else if (CODIGOS_DE_CONTRASENA_NUEVA.includes(codigo)) {
      this.mostrarErrores({ nueva: mensaje });
    } else {
      this.errores.set({});
      this.errorGeneral.set(mensaje);
      enfocar('error-formulario');
    }
  }
}
