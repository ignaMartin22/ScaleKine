import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { EstadoSesion, PasoPendiente, UsuarioSesion } from './modelo';

/**
 * Estado de la sesión en el cliente. Solo sirve para decidir qué pantalla mostrar: el backend es el
 * que autoriza cada petición con el rol y el paso pendiente de la sesión, nunca con lo que diga el
 * cliente. Nada de esto se guarda en el almacenamiento del navegador: la sesión viaja en una cookie
 * `HttpOnly` y las credenciales no se conservan.
 */
@Injectable({ providedIn: 'root' })
export class Sesion {
  private readonly http = inject(HttpClient);

  private readonly estadoActual = signal<EstadoSesion | null>(null);
  private readonly avisoActual = signal<string | null>(null);
  private consultada = false;

  readonly estado = this.estadoActual.asReadonly();
  readonly usuario = computed<UsuarioSesion | null>(() => this.estadoActual()?.usuario ?? null);
  readonly rol = computed(() => this.estadoActual()?.usuario.rol ?? null);
  readonly pasoPendiente = computed<PasoPendiente | null>(
    () => this.estadoActual()?.pasoPendiente ?? null,
  );
  /** Aviso para la pantalla de ingreso (por ejemplo, sesión vencida, RF-11). */
  readonly aviso = this.avisoActual.asReadonly();

  /**
   * Pregunta al backend por la sesión de la cookie, una sola vez por carga de la aplicación. Si no
   * hay sesión válida, el estado queda en null.
   */
  async asegurarCargada(): Promise<EstadoSesion | null> {
    if (!this.consultada) {
      this.consultada = true;
      try {
        this.estadoActual.set(await firstValueFrom(this.http.get<EstadoSesion>('/api/sesion')));
      } catch {
        this.estadoActual.set(null);
      }
    }
    return this.estadoActual();
  }

  /** Vuelve a pedir la sesión al backend, por ejemplo después de resolver un paso pendiente. */
  async recargar(): Promise<EstadoSesion | null> {
    this.consultada = false;
    return this.asegurarCargada();
  }

  /** Ingreso (RF-01, RF-02). Los errores llegan como `ErrorApi`. */
  async ingresar(nombreUsuario: string, contrasena: string): Promise<EstadoSesion> {
    const estado = await firstValueFrom(
      this.http.post<EstadoSesion>('/api/sesion', { nombreUsuario, contrasena }),
    );
    this.establecer(estado);
    return estado;
  }

  /** Cambio de la propia contraseña (RF-06, RF-07). El backend cierra las demás sesiones de la cuenta. */
  async cambiarContrasena(
    contrasenaActual: string,
    contrasenaNueva: string,
  ): Promise<EstadoSesion | null> {
    await firstValueFrom(
      this.http.put<void>('/api/sesion/contrasena', { contrasenaActual, contrasenaNueva }),
    );
    return this.recargar();
  }

  /** Genera un secreto pendiente y devuelve el QR (`data:`) para la aplicación autenticadora. */
  async iniciarActivacion(): Promise<string> {
    const { qr } = await firstValueFrom(
      this.http.post<{ qr: string }>('/api/sesion/segundo-factor/activacion', {}),
    );
    return qr;
  }

  /**
   * Confirma el secreto con un código. Devuelve los códigos de recuperación, que no se vuelven a
   * mostrar. No recarga la sesión: la pantalla lo hace cuando la persona confirma que los guardó.
   */
  async confirmarActivacion(codigo: string): Promise<string[]> {
    const { codigosRecuperacion } = await firstValueFrom(
      this.http.post<{ codigosRecuperacion: string[] }>(
        '/api/sesion/segundo-factor/activacion/confirmar',
        {
          codigo,
        },
      ),
    );
    return codigosRecuperacion;
  }

  /** Verifica el segundo factor con un TOTP o un código de recuperación. */
  async verificarSegundoFactor(codigo: string): Promise<EstadoSesion | null> {
    await firstValueFrom(this.http.post<void>('/api/sesion/segundo-factor/verificar', { codigo }));
    return this.recargar();
  }

  /** Cierre de sesión (RF-10): el cliente la olvida aunque la petición falle. */
  async cerrar(): Promise<void> {
    try {
      await firstValueFrom(this.http.delete<void>('/api/sesion'));
    } finally {
      this.limpiar();
    }
  }

  establecer(estado: EstadoSesion): void {
    this.consultada = true;
    this.avisoActual.set(null);
    this.estadoActual.set(estado);
  }

  /** Olvida la sesión del cliente: la pantalla deja de mostrar datos (RF-10). */
  limpiar(): void {
    this.consultada = true;
    this.estadoActual.set(null);
  }

  /** Olvida la sesión porque venció o fue revocada y deja un aviso para el ingreso (RF-11). */
  vencer(): void {
    const habiaSesion = this.estadoActual() !== null;
    this.limpiar();
    if (habiaSesion) this.avisoActual.set('Tu sesión venció o fue cerrada. Ingresá de nuevo.');
  }
}
