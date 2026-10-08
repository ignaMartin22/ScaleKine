import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { Configuracion } from '../../comun/configuracion.js';
import { datosValidados, validar } from '../../comun/validacion.js';
import { borrarCookieSesion, escribirCookieSesion, leerCookieSesion } from './cookie.js';
import { sesionActual } from './middleware.js';
import { estadoSegundoFactor, pasoPendiente } from './pasos.js';
import type { ServicioIdentidad, UsuarioSesion } from './servicio.js';
import type { ServicioSegundoFactor } from './servicioSegundoFactor.js';

/**
 * Rutas de sesión, montadas bajo `/api`:
 *
 * - `POST /api/sesion`: ingreso (RF-01, RF-02). Responde 200
 *   `{ usuario: { nombreUsuario, rol, debeCambiarContrasena }, segundoFactor, pasoPendiente }` y
 *   escribe la cookie de sesión. `segundoFactor` es `no_requerido` | `sin_activar` | `sin_verificar`
 *   | `verificado` (solo el administrador tiene segundo factor, RNF-04) y `pasoPendiente` es
 *   `verificar_segundo_factor` | `cambiar_contrasena` | `activar_segundo_factor` | `null`. Con un paso
 *   pendiente, toda ruta de negocio responde 403 `debe_verificar_segundo_factor`,
 *   `debe_cambiar_contrasena` o `debe_activar_segundo_factor`; las rutas de abajo admiten solo los
 *   pasos que se indican. Con la dirección bloqueada por demasiados fallos responde 429
 *   `demasiados_intentos` (RNF-02); con la cuenta bloqueada, la misma respuesta que con credenciales
 *   inválidas, para no revelar que existe.
 * - `GET /api/sesion`: sesión actual. Mismo cuerpo; 401 si no hay una sesión válida. Admite cualquier
 *   paso pendiente.
 * - `PUT /api/sesion/contrasena`: cambio de la propia contraseña (RF-06, RF-07). Admite una sesión sin
 *   paso pendiente o con `cambiar_contrasena`. Cuerpo `{ contrasenaActual, contrasenaNueva }`; 204 si
 *   se aplicó, 403 `contrasena_actual_incorrecta` si la actual no coincide (nunca 401: el frontend lo
 *   leería como sesión vencida), 400 si la nueva no cumple la política (RNF-03) o es igual a la
 *   actual, y 409 `contrasena_modificada` si otra escritura cambió la contraseña mientras tanto. Una
 *   actual incorrecta cuenta como intento fallido (RNF-02): con la cuenta bloqueada la respuesta es la
 *   misma 403 que con una actual incorrecta, y con la dirección bloqueada es 429
 *   `demasiados_intentos`.
 * - `POST /api/sesion/segundo-factor/activacion`: solo con el paso `activar_segundo_factor` (RNF-04).
 *   Genera un secreto, lo guarda cifrado sin activarlo y responde `{ qr }` (una URL `data:`).
 *   Repetirlo reemplaza el secreto pendiente. 503 `segundo_factor_sin_configurar` sin clave de cifrado.
 * - `POST /api/sesion/segundo-factor/activacion/confirmar`: mismo paso. Cuerpo `{ codigo }` (TOTP del
 *   secreto pendiente). Activa el segundo factor, deja la sesión verificada y responde
 *   `{ codigosRecuperacion }` (10 códigos, que no se vuelven a mostrar). 400 `codigo_invalido` si el
 *   código no es válido; no cuenta para el límite de intentos.
 * - `POST /api/sesion/segundo-factor/verificar`: solo con el paso `verificar_segundo_factor`. Cuerpo
 *   `{ codigo }`: seis dígitos son un TOTP, cualquier otra cosa un código de recuperación. 204 si la
 *   sesión quedó verificada; 403 `segundo_factor_invalido` si el código no sirve, ya se usó o la
 *   cuenta está bloqueada (nunca 401); 429 `demasiados_intentos` con la dirección bloqueada. Cada
 *   rechazo cuenta como un fallo (RNF-02).
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

const esquemaCodigo = {
  body: z.object({ codigo: z.string().min(1).max(64).refine(sinNul) }),
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

/** Cuerpo de `/api/sesion`: el usuario, el estado del segundo factor y el paso pendiente (RNF-04). */
function cuerpoSesion(usuario: UsuarioSesion, segundoFactorVerificado: boolean) {
  return {
    usuario: cuerpoUsuario(usuario),
    segundoFactor: estadoSegundoFactor(usuario, segundoFactorVerificado),
    pasoPendiente: pasoPendiente(usuario, segundoFactorVerificado),
  };
}

/**
 * Variantes de `exigirSesion` con los pasos pendientes que admite cada una (ver `middleware.ts`).
 * Las rutas nuevas de este router (T-13) deben usar `sesion`; las demás solo corresponden a las
 * rutas que son la salida de un paso, y una prueba guardiana fija en cuáles aparecen.
 */
export interface VariantesExigirSesion {
  /** Solo admite una sesión sin pasos pendientes. Aún sin uso: es para las rutas de negocio (T-13). */
  sesion: RequestHandler;
  /** Admite cualquier paso: consultar la sesión. */
  cualquierPaso: RequestHandler;
  /** Admite sin paso o `cambiar_contrasena`: cambiar la contraseña. */
  cambioContrasena: RequestHandler;
  /** Solo `activar_segundo_factor`. */
  activacion: RequestHandler;
  /** Solo `verificar_segundo_factor`. */
  verificacion: RequestHandler;
}

export function crearRutasIdentidad({
  servicio,
  servicioSegundoFactor,
  exigir,
  config,
}: {
  servicio: ServicioIdentidad;
  servicioSegundoFactor: ServicioSegundoFactor;
  exigir: VariantesExigirSesion;
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
      // Una sesión recién creada nunca tiene el segundo factor verificado (RNF-04).
      res.json(cuerpoSesion(usuario, false));
    } catch (err) {
      next(err);
    }
  });

  router.get('/sesion', exigir.cualquierPaso, (_req, res) => {
    const { usuario, segundoFactorVerificado } = sesionActual(res);
    res.json(cuerpoSesion(usuario, segundoFactorVerificado));
  });

  router.put(
    '/sesion/contrasena',
    exigir.cambioContrasena,
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

  router.post('/sesion/segundo-factor/activacion', exigir.activacion, async (_req, res, next) => {
    try {
      const { id, usuario } = sesionActual(res);
      res.json(
        await servicioSegundoFactor.iniciarActivacion({ usuarioId: usuario.id, sesionId: id }, usuario.nombreUsuario),
      );
    } catch (err) {
      next(err);
    }
  });

  router.post(
    '/sesion/segundo-factor/activacion/confirmar',
    exigir.activacion,
    validar(esquemaCodigo),
    async (_req, res, next) => {
      try {
        const { id, usuario } = sesionActual(res);
        const { body } = datosValidados(res.locals, esquemaCodigo);
        res.json(await servicioSegundoFactor.confirmarActivacion({ usuarioId: usuario.id, sesionId: id }, body.codigo));
      } catch (err) {
        next(err);
      }
    },
  );

  router.post('/sesion/segundo-factor/verificar', exigir.verificacion, validar(esquemaCodigo), async (req, res, next) => {
    try {
      const { id, usuario } = sesionActual(res);
      const { body } = datosValidados(res.locals, esquemaCodigo);
      await servicioSegundoFactor.verificar(
        { usuarioId: usuario.id, sesionId: id, ip: req.ip ?? 'desconocida' },
        body.codigo,
      );
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

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
