import type { Rol } from '../../generado/prisma/client.js';

/**
 * Pasos que una sesión puede tener pendientes antes de usarse con normalidad (RF-06, RNF-04).
 * Una sesión tiene a lo sumo uno, el primero que corresponda en este orden: verificar el segundo
 * factor, cambiar la contraseña, activar el segundo factor. Sin ninguno, la sesión queda "libre".
 */
export type PasoPendiente = 'verificar_segundo_factor' | 'cambiar_contrasena' | 'activar_segundo_factor';

/** Lo que una variante del middleware admite: un paso pendiente o `ninguno`. */
export type PasoAdmitido = PasoPendiente | 'ninguno';

/** Estado del segundo factor que informa `/api/sesion`. */
export type EstadoSegundoFactor = 'no_requerido' | 'sin_activar' | 'sin_verificar' | 'verificado';

interface DatosDePaso {
  rol: Rol;
  debeCambiarContrasena: boolean;
  totpActivo: boolean;
}

/** Solo el administrador tiene segundo factor (RNF-04): secretaría y kinesiólogo nunca lo tienen. */
export function estadoSegundoFactor(usuario: DatosDePaso, segundoFactorVerificado: boolean): EstadoSegundoFactor {
  if (usuario.rol !== 'administrador') return 'no_requerido';
  if (!usuario.totpActivo) return 'sin_activar';
  return segundoFactorVerificado ? 'verificado' : 'sin_verificar';
}

/** El paso pendiente de la sesión, o `null` si no tiene ninguno. Es el único lugar donde se decide. */
export function pasoPendiente(usuario: DatosDePaso, segundoFactorVerificado: boolean): PasoPendiente | null {
  if (estadoSegundoFactor(usuario, segundoFactorVerificado) === 'sin_verificar') return 'verificar_segundo_factor';
  if (usuario.debeCambiarContrasena) return 'cambiar_contrasena';
  if (estadoSegundoFactor(usuario, segundoFactorVerificado) === 'sin_activar') return 'activar_segundo_factor';
  return null;
}
