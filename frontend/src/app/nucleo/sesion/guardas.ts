import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import {
  destinoDeSesion,
  INICIO_POR_ROL,
  RUTA_POR_PASO,
  type PasoPendiente,
  type Rol,
} from './modelo';
import { Sesion } from './sesion';

/**
 * Las guardas son comodidad de navegación: llevan a la pantalla correcta según lo que informa el
 * backend. El bloqueo real vive en el servidor, que rechaza las rutas de negocio con un paso pendiente.
 */

/**
 * Deja pasar solo a los roles indicados. Sin sesión, lleva al ingreso; con un paso pendiente, a la
 * pantalla de ese paso; con otro rol, a la pantalla de inicio de ese rol.
 */
export function guardaDeRol(rolesPermitidos: readonly Rol[]): CanActivateFn {
  return async () => {
    const router = inject(Router);
    const estado = await inject(Sesion).asegurarCargada();

    if (!estado) return router.parseUrl('/ingresar');
    if (estado.pasoPendiente) return router.parseUrl(RUTA_POR_PASO[estado.pasoPendiente]);
    if (rolesPermitidos.includes(estado.usuario.rol)) return true;
    return router.parseUrl(INICIO_POR_ROL[estado.usuario.rol]);
  };
}

/**
 * Pantalla de un paso pendiente (activación o verificación del segundo factor). Sin sesión lleva al
 * ingreso; si el paso pendiente es otro, o ya no hay, a donde corresponda.
 */
export function guardaDePaso(paso: PasoPendiente): CanActivateFn {
  return async () => {
    const router = inject(Router);
    const estado = await inject(Sesion).asegurarCargada();

    if (!estado) return router.parseUrl('/ingresar');
    return estado.pasoPendiente === paso ? true : router.parseUrl(destinoDeSesion(estado));
  };
}

/**
 * Cambio de contraseña (RF-06, RF-07): lo pide el paso pendiente o lo hace la persona desde el menú
 * sin ningún paso pendiente. Con otro paso pendiente, va primero a ese.
 */
export const guardaDeCambioDeContrasena: CanActivateFn = async () => {
  const router = inject(Router);
  const estado = await inject(Sesion).asegurarCargada();

  if (!estado) return router.parseUrl('/ingresar');
  if (estado.pasoPendiente === null || estado.pasoPendiente === 'cambiar_contrasena') return true;
  return router.parseUrl(RUTA_POR_PASO[estado.pasoPendiente]);
};

/** Para el ingreso: quien ya tiene sesión va a su paso pendiente o a la pantalla de su rol (RF-01). */
export const redirigirSiHaySesion: CanActivateFn = async () => {
  const router = inject(Router);
  const estado = await inject(Sesion).asegurarCargada();
  return estado ? router.parseUrl(destinoDeSesion(estado)) : true;
};

/** La raíz no tiene pantalla propia: lleva al paso pendiente, al inicio del rol o al ingreso. */
export const redirigirDesdeRaiz: CanActivateFn = async () => {
  const router = inject(Router);
  const estado = await inject(Sesion).asegurarCargada();
  return router.parseUrl(estado ? destinoDeSesion(estado) : '/ingresar');
};
