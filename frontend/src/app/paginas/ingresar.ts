import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ErrorApi } from '../nucleo/http/error-api';
import { destinoDeSesion } from '../nucleo/sesion/modelo';
import { Sesion } from '../nucleo/sesion/sesion';
import { enfocar, mensajeDe } from '../nucleo/ui/enfocar';

/** Ingreso con usuario y contraseña (RF-01, RF-02). */
@Component({
  selector: 'app-ingresar',
  template: `
    <main class="tarjeta">
      <h1>Ingresar</h1>
      <p>Ingresá con tu usuario y contraseña.</p>

      @if (sesion.aviso(); as aviso) {
        <p class="aviso" role="status">{{ aviso }}</p>
      }
      @if (errorGeneral(); as mensaje) {
        <p class="error" id="error-formulario" role="alert" tabindex="-1">{{ mensaje }}</p>
      }

      <form
        class="formulario"
        novalidate
        (submit)="enviar($event, usuario.value, contrasena.value)"
      >
        <div class="campo">
          <label for="usuario">Usuario</label>
          <input
            #usuario
            id="usuario"
            name="usuario"
            type="text"
            autocomplete="username"
            autocapitalize="off"
            spellcheck="false"
            [attr.aria-invalid]="errorUsuario() ? 'true' : null"
            [attr.aria-describedby]="errorUsuario() ? 'error-usuario' : null"
          />
          @if (errorUsuario(); as mensaje) {
            <p class="error" id="error-usuario">{{ mensaje }}</p>
          }
        </div>
        <div class="campo">
          <label for="contrasena">Contraseña</label>
          <input
            #contrasena
            id="contrasena"
            name="contrasena"
            type="password"
            autocomplete="current-password"
            [attr.aria-invalid]="errorContrasena() ? 'true' : null"
            [attr.aria-describedby]="errorContrasena() ? 'error-contrasena' : null"
          />
          @if (errorContrasena(); as mensaje) {
            <p class="error" id="error-contrasena">{{ mensaje }}</p>
          }
        </div>
        <button type="submit" class="boton" [disabled]="enviando()">
          {{ enviando() ? 'Ingresando…' : 'Ingresar' }}
        </button>
      </form>
    </main>
  `,
})
export class Ingresar {
  protected readonly sesion = inject(Sesion);
  private readonly router = inject(Router);

  protected readonly enviando = signal(false);
  protected readonly errorUsuario = signal<string | null>(null);
  protected readonly errorContrasena = signal<string | null>(null);
  protected readonly errorGeneral = signal<string | null>(null);

  protected async enviar(evento: Event, nombreUsuario: string, contrasena: string): Promise<void> {
    evento.preventDefault();
    if (this.enviando()) return;
    this.errorUsuario.set(null);
    this.errorContrasena.set(null);
    this.errorGeneral.set(null);

    const usuarioVacio = nombreUsuario.trim() === '';
    const contrasenaVacia = contrasena === '';
    if (usuarioVacio) this.errorUsuario.set('Ingresá tu usuario.');
    if (contrasenaVacia) this.errorContrasena.set('Ingresá tu contraseña.');
    if (usuarioVacio || contrasenaVacia) {
      enfocar(usuarioVacio ? 'usuario' : 'contrasena');
      return;
    }

    this.enviando.set(true);
    try {
      const estado = await this.sesion.ingresar(nombreUsuario.trim(), contrasena);
      await this.router.navigateByUrl(destinoDeSesion(estado));
    } catch (error) {
      // Mensaje genérico ante credenciales inválidas: no revela si el usuario existe (RF-02).
      this.errorGeneral.set(
        error instanceof ErrorApi && error.codigo === 'credenciales_invalidas'
          ? 'Usuario o contraseña incorrectos.'
          : mensajeDe(error),
      );
      enfocar('error-formulario');
    } finally {
      this.enviando.set(false);
    }
  }
}
