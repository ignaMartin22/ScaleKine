/** Roles del sistema, con los mismos nombres que el backend (spec §2). */
export type Rol = 'administrador' | 'secretaria' | 'kinesiologo';

export interface UsuarioSesion {
  nombreUsuario: string;
  rol: Rol;
}

/** Pantalla de inicio de cada rol (RF-01). */
export const INICIO_POR_ROL: Record<Rol, string> = {
  administrador: '/admin',
  secretaria: '/secretaria',
  kinesiologo: '/kinesiologo',
};
