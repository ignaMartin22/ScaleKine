/** Roles del sistema, con los mismos nombres que el backend (spec §2). */
export type Rol = 'administrador' | 'secretaria' | 'kinesiologo';

/** Estado del segundo factor que informa `/api/sesion` (RNF-04). Solo el administrador lo tiene. */
export type EstadoSegundoFactor = 'no_requerido' | 'sin_activar' | 'sin_verificar' | 'verificado';

/**
 * Paso que la sesión tiene pendiente antes de usarse con normalidad (RF-06, RNF-04). Lo decide el
 * backend; el cliente solo lleva a la pantalla que corresponde.
 */
export type PasoPendiente =
  'verificar_segundo_factor' | 'cambiar_contrasena' | 'activar_segundo_factor';

export interface UsuarioSesion {
  nombreUsuario: string;
  rol: Rol;
  debeCambiarContrasena: boolean;
}

/** Cuerpo de `POST /api/sesion` y `GET /api/sesion`. */
export interface EstadoSesion {
  usuario: UsuarioSesion;
  segundoFactor: EstadoSegundoFactor;
  pasoPendiente: PasoPendiente | null;
}

/**
 * Pantalla de inicio de cada rol (RF-01): la agenda de turnos para el administrador y la secretaría,
 * y la propia para el kinesiólogo.
 */
export const INICIO_POR_ROL: Record<Rol, string> = {
  administrador: '/secretaria/agenda',
  secretaria: '/secretaria/agenda',
  kinesiologo: '/kinesiologo',
};

/** Pantalla de cada paso pendiente. */
export const RUTA_POR_PASO: Record<PasoPendiente, string> = {
  verificar_segundo_factor: '/verificar-segundo-factor',
  cambiar_contrasena: '/cambiar-contrasena',
  activar_segundo_factor: '/activar-segundo-factor',
};

/** Código con el que el backend rechaza una ruta de negocio según el paso pendiente. */
const PASO_POR_CODIGO_DE_ERROR: ReadonlyMap<string, PasoPendiente> = new Map([
  ['debe_verificar_segundo_factor', 'verificar_segundo_factor'],
  ['debe_cambiar_contrasena', 'cambiar_contrasena'],
  ['debe_activar_segundo_factor', 'activar_segundo_factor'],
]);

/** Paso pendiente que corresponde a un código de error, o `undefined` si el código no es de un paso. */
export function pasoDeCodigoDeError(codigo: string): PasoPendiente | undefined {
  return PASO_POR_CODIGO_DE_ERROR.get(codigo);
}

/** A dónde va una sesión: a su paso pendiente o, si no tiene, al inicio de su rol. */
export function destinoDeSesion(estado: Pick<EstadoSesion, 'usuario' | 'pasoPendiente'>): string {
  return estado.pasoPendiente
    ? RUTA_POR_PASO[estado.pasoPendiente]
    : INICIO_POR_ROL[estado.usuario.rol];
}
