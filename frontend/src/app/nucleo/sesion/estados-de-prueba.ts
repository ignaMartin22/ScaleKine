import type { EstadoSesion, PasoPendiente, Rol } from './modelo';

/** Estado de sesión ficticio para las pruebas, coherente con lo que arma el backend (`pasos.ts`). */
export function estadoDePrueba(rol: Rol, pasoPendiente: PasoPendiente | null = null): EstadoSesion {
  return {
    usuario: {
      nombreUsuario: 'usuario.ficticio',
      rol,
      debeCambiarContrasena: pasoPendiente === 'cambiar_contrasena',
    },
    segundoFactor:
      rol !== 'administrador'
        ? 'no_requerido'
        : pasoPendiente === 'verificar_segundo_factor'
          ? 'sin_verificar'
          : pasoPendiente === 'activar_segundo_factor'
            ? 'sin_activar'
            : 'verificado',
    pasoPendiente,
  };
}
