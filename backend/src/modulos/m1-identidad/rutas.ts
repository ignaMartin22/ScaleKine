import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { Configuracion } from '../../comun/configuracion.js';
import { datosValidados, validar } from '../../comun/validacion.js';
import { borrarCookieSesion, escribirCookieSesion, leerCookieSesion } from './cookie.js';
import { sesionActual } from './middleware.js';
import type { ServicioIdentidad, UsuarioSesion } from './servicio.js';

/**
 * Rutas de sesión, montadas bajo `/api`:
 *
 * - `POST /api/sesion`: ingreso (RF-01, RF-02). Responde 200
 *   `{ usuario: { nombreUsuario, rol, debeCambiarContrasena } }` y escribe la cookie de sesión. Con
 *   la dirección bloqueada por demasiados fallos responde 429 `demasiados_intentos` (RNF-02); con la
 *   cuenta bloqueada, la misma respuesta que con credenciales inválidas, para no revelar que existe.
 * - `GET /api/sesion`: sesión actual. Mismo cuerpo; 401 si no hay una sesión válida.
 * - `PUT /api/sesion/contrasena`: cambio de la propia contraseña (RF-06, RF-07). Cuerpo
 *   `{ contrasenaActual, contrasenaNueva }`; 204 si se aplicó, 403 `contrasena_actual_incorrecta` si
 *   la actual no coincide (nunca 401: el frontend lo leería como sesión vencida), 400 si la nueva
 *   no cumple la política (RNF-03) o es igual a la actual, y 409 `contrasena_modificada` si otra
 *   escritura cambió la contraseña mientras tanto. Una actual incorrecta cuenta como intento fallido
 *   (RNF-02): con la cuenta bloqueada la respuesta es la misma 403 que con una actual incorrecta, y
 *   con la dirección bloqueada es 429 `demasiados_intentos`.
 * - `DELETE /api/sesion`: cierre (RF-10). Revoca la sesión si hay cookie, siempre borra la cookie y
 *   responde 204; sin sesión también es 204.
 *
 * Se usa `/api/sesion` como recurso porque el interceptor del frontend no redirige ante un 401 de
 * esa URL, así un ingreso fallido no dispara la vuelta al login. Las respuestas nunca incluyen el
 * `id` del usuario.
 */

// El máximo evita trabajo de hash con entradas enormes; la política de contraseñas es de T-11.
// PostgreSQL no admite el carácter NUL en columnas de texto: se rechaza acá con 400 (RNF-10) en
// lugar de dejar que termine en un 500.
const sinNul = (valor: string) => !valor.includes('\u0000');
const esquemaIngreso = {
  body: z.object({
    nombreUsuario: z.string().min(1).max(64).refine(sinNul),
    contrasena: z.string().min(1).max(1024).refine(sinNul),
  }),
};

const esquemaCambioContrasena = {
  body: z.object({
    contrasenaActual: z.string().min(1).max(1024).refine(sinNul),
    contrasenaNueva: z.string().min(1).max(1024).refine(sinNul),
  }),
};

/** Nunca incluye el `id` del usuario. */
function cuerpoUsuario(usuario: UsuarioSesion) {
  return {
    nombreUsuario: usuario.nombreUsuario,
    rol: usuario.rol,
    debeCambiarContrasena: usuario.debeCambiarContrasena,
  };
}

/**
 * `exigirSesion` bloquea a la cuenta marcada para cambio de contraseña (RF-06) y es el que deben
 * usar las rutas nuevas de este router. `exigirSesionAunqueDebaCambiarContrasena` la deja pasar y
 * solo corresponde a las rutas que son la salida de ese estado: consultar la sesión y cambiar la
 * contraseña.
 */
export function crearRutasIdentidad({
  servicio,
  // Aún sin uso: las rutas nuevas de este router (T-13) deben escribir `exigirSesion`, no la otra.
  exigirSesion: _exigirSesion,
  exigirSesionAunqueDebaCambiarContrasena,
  config,
}: {
  servicio: ServicioIdentidad;
  /** Para las rutas de negocio de este router (T-13); las actuales usan la variante permisiva. */
  exigirSesion: RequestHandler;
  exigirSesionAunqueDebaCambiarContrasena: RequestHandler;
  config: Pick<Configuracion, 'cookieSegura'>;
}): Router {
  const router = Router();

  router.post('/sesion', validar(esquemaIngreso), async (req, res, next) => {
    try {
      const { body } = datosValidados(res.locals, esquemaIngreso);
      const { token, venceEn, usuario } = await servicio.ingresar(
        body.nombreUsuario,
        body.contrasena,
        req.ip ?? 'desconocida',
      );
      escribirCookieSesion(res, config, token, venceEn);
      res.json({ usuario: cuerpoUsuario(usuario) });
    } catch (err) {
      next(err);
    }
  });

  router.get('/sesion', exigirSesionAunqueDebaCambiarContrasena, (_req, res) => {
    const { usuario } = sesionActual(res);
    res.json({ usuario: cuerpoUsuario(usuario) });
  });

  router.put(
    '/sesion/contrasena',
    exigirSesionAunqueDebaCambiarContrasena,
    validar(esquemaCambioContrasena),
    async (req, res, next) => {
      try {
        const { id, usuario } = sesionActual(res);
        const { body } = datosValidados(res.locals, esquemaCambioContrasena);
        await servicio.cambiarContrasena(
          { usuarioId: usuario.id, sesionId: id, ip: req.ip ?? 'desconocida' },
          body.contrasenaActual,
          body.contrasenaNueva,
        );
        res.status(204).end();
      } catch (err) {
        next(err);
      }
    },
  );

  router.delete('/sesion', async (req, res, next) => {
    try {
      const token = leerCookieSesion(req, config);
      if (token !== undefined) await servicio.cerrarSesion(token);
      borrarCookieSesion(res, config);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
