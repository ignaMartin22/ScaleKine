import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { INICIO_POR_ROL, type Rol } from './modelo';
import { Sesion } from './sesion';

/**
 * Deja pasar solo a los roles indicados. Sin sesión, lleva al ingreso; con otro rol, a la pantalla
 * de inicio de ese rol. Es una comodidad de navegación: la autorización real está en el backend.
 */
export function guardaDeRol(rolesPermitidos: readonly Rol[]): CanActivateFn {
  return async () => {
    const router = inject(Router);
    const usuario = await inject(Sesion).asegurarCargada();

    if (!usuario) return router.parseUrl('/ingresar');
    if (rolesPermitidos.includes(usuario.rol)) return true;
    return router.parseUrl(INICIO_POR_ROL[usuario.rol]);
  };
}

/** Para la raíz y el ingreso: quien ya tiene sesión va directo a la pantalla de su rol (RF-01). */
export const redirigirSiHaySesion: CanActivateFn = async () => {
  const router = inject(Router);
  const usuario = await inject(Sesion).asegurarCargada();
  return usuario ? router.parseUrl(INICIO_POR_ROL[usuario.rol]) : true;
};

/** La raíz no tiene pantalla propia: lleva al inicio del rol o al ingreso. */
export const redirigirDesdeRaiz: CanActivateFn = async () => {
  const router = inject(Router);
  const usuario = await inject(Sesion).asegurarCargada();
  return router.parseUrl(usuario ? INICIO_POR_ROL[usuario.rol] : '/ingresar');
};
