import { createHash, randomBytes } from 'node:crypto';
import type { BaseDeDatos } from '../../comun/baseDeDatos.js';
import { ErrorNegocio } from '../../comun/errores.js';
import type { Reloj } from '../../comun/reloj.js';
import type { Rol } from '../../generado/prisma/client.js';
import { hashearContrasena, validarPoliticaContrasena, verificarContrasena } from './contrasenas.js';
import { crearLimiteIntentos, cuentaBloqueada, SIN_BLOQUEO } from './limiteIntentos.js';

/** Duración fija de la sesión, sin renovación por actividad (RF-11, D-14). */
export const DURACION_SESION_MS = 12 * 60 * 60 * 1000;

export interface UsuarioSesion {
  id: number;
  nombreUsuario: string;
  rol: Rol;
  /** La cuenta debe elegir una contraseña propia antes de hacer cualquier otra cosa (RF-06). */
  debeCambiarContrasena: boolean;
}

export interface SesionActiva {
  id: number;
  usuario: UsuarioSesion;
}

/** En la base solo se guarda el hash del token: una filtración de la tabla no da sesiones (RNF-01). */
export function hashDeToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function errorCredenciales(): ErrorNegocio {
  return new ErrorNegocio('credenciales_invalidas', 'Las credenciales no son válidas.', 401);
}

function errorDemasiadosIntentos(): ErrorNegocio {
  return new ErrorNegocio(
    'demasiados_intentos',
    'Hubo demasiados intentos fallidos desde esta conexión. Esperá unos minutos y volvé a intentar.',
    429,
  );
}

export async function crearServicioIdentidad({ db, reloj }: { db: BaseDeDatos; reloj: Reloj }) {
  // Hash de una contraseña al azar, calculado al crear el servicio: si argon2 falla se nota al
  // arrancar y no en el primer ingreso. Sirve para verificar contra algo cuando el usuario no
  // existe y que la respuesta tarde lo mismo (RF-02).
  const hashFicticio = await hashearContrasena(randomBytes(32).toString('base64url'));
  const limite = crearLimiteIntentos({ db });

  return {
    /**
     * Ingreso (RF-01, RF-02, RNF-02). Usuario inexistente, contraseña incorrecta, cuenta inactiva
     * (RF-09) y cuenta bloqueada dan exactamente el mismo error, y en todos los casos se verifica un
     * hash. Cada rechazo suma un fallo a la dirección y, si corresponde, a la cuenta. Con la
     * dirección bloqueada se responde 429 sin verificar nada: no revela nada sobre ninguna cuenta, y
     * ese 429 no cuenta como un fallo nuevo.
     */
    async ingresar(
      nombreUsuario: string,
      contrasena: string,
      ip: string,
    ): Promise<{ token: string; venceEn: Date; usuario: UsuarioSesion }> {
      const ahora = reloj.ahora();
      if (await limite.direccionBloqueada(ip, ahora)) throw errorDemasiadosIntentos();

      const usuario = await db.usuario.findUnique({ where: { nombreUsuario } });
      // Argon2 corre siempre, también con la cuenta inexistente o bloqueada (RF-02).
      const correcta = await verificarContrasena(usuario?.hashContrasena ?? hashFicticio, contrasena);
      const bloqueada = usuario !== null && cuentaBloqueada(usuario.bloqueadoHasta, ahora);
      if (!usuario || !correcta || !usuario.activo || bloqueada) {
        await limite.registrarFalloDireccion(ip, ahora);
        // Solo una contraseña incorrecta cuenta contra la cuenta; el resto ejecuta la misma
        // sentencia sin efecto, para que el tiempo de respuesta sea el mismo.
        await limite.registrarFalloCuenta(usuario && !correcta ? usuario.id : null, ahora);
        throw errorCredenciales();
      }

      const token = randomBytes(32).toString('base64url');
      const creadaEn = ahora;
      const venceEn = new Date(creadaEn.getTime() + DURACION_SESION_MS);
      await db.$transaction(async (tx) => {
        // La sesión se crea solo si el hash y la cuenta siguen como se verificaron. Tomar la fila
        // serializa este ingreso con un cambio o restablecimiento de contraseña (RF-07, RF-08): si
        // el ingreso la toma primero, la revocación de ese cambio ve la sesión nueva; si el cambio
        // va primero, el WHERE ya no coincide y no se crea una sesión con la contraseña vieja.
        // Tampoco coincide si un bloqueo concurrente (RNF-02) ya se aplicó. Un ingreso correcto
        // reinicia el límite por cuenta (RNF-02).
        const { count } = await tx.usuario.updateMany({
          where: {
            id: usuario.id,
            hashContrasena: usuario.hashContrasena,
            activo: true,
            OR: [{ bloqueadoHasta: null }, { bloqueadoHasta: { lte: ahora } }],
          },
          data: SIN_BLOQUEO,
        });
        if (count === 0) throw errorCredenciales();
        await tx.sesion.create({
          data: {
            hashToken: hashDeToken(token),
            usuarioId: usuario.id,
            creadaEn,
            venceEn,
          },
        });
      });
      return {
        token,
        venceEn,
        usuario: {
          id: usuario.id,
          nombreUsuario: usuario.nombreUsuario,
          rol: usuario.rol,
          debeCambiarContrasena: usuario.debeCambiarContrasena,
        },
      };
    },

    /** La sesión del token, o null si no existe, se cerró, venció o la cuenta ya no está activa. */
    async sesionVigente(token: string): Promise<SesionActiva | null> {
      // Select explícito: no se carga el hash de la contraseña ni el secreto TOTP del usuario.
      const sesion = await db.sesion.findUnique({
        where: { hashToken: hashDeToken(token) },
        select: {
          id: true,
          venceEn: true,
          revocadaEn: true,
          usuario: {
            select: {
              id: true,
              nombreUsuario: true,
              rol: true,
              activo: true,
              debeCambiarContrasena: true,
            },
          },
        },
      });
      if (!sesion || sesion.revocadaEn !== null) return null;
      // Al cumplirse las 12 horas exactas la sesión ya está vencida (RF-11).
      if (sesion.venceEn.getTime() <= reloj.ahora().getTime()) return null;
      if (!sesion.usuario.activo) return null;
      const { id, nombreUsuario, rol, debeCambiarContrasena } = sesion.usuario;
      return {
        id: sesion.id,
        usuario: { id, nombreUsuario, rol, debeCambiarContrasena },
      };
    },

    /**
     * Cambio de la propia contraseña (RF-06, RF-07). Exige la actual (en el primer ingreso, la
     * temporal) y aplica la política de RNF-03. Apaga la marca de cambio pendiente. Una contraseña
     * actual incorrecta es 403 y no 401: el frontend trata todo 401 como sesión vencida.
     *
     * Una actual incorrecta cuenta como intento fallido (RNF-02), igual que un ingreso rechazado:
     * suma al mismo contador de la cuenta y de la dirección, así la sesión abierta no sirve para
     * adivinar la contraseña sin límite. Con la cuenta bloqueada la respuesta es la misma que con una
     * actual incorrecta, y con la dirección bloqueada es 429.
     *
     * En la misma transacción revoca las demás sesiones de la cuenta (RF-07): quien conocía la
     * contraseña anterior, p. ej. la temporal, no conserva una sesión abierta. La sesión desde la que
     * se cambia sigue vigente.
     */
    async cambiarContrasena(
      { usuarioId, sesionId, ip }: { usuarioId: number; sesionId: number; ip: string },
      contrasenaActual: string,
      contrasenaNueva: string,
    ): Promise<void> {
      const ahora = reloj.ahora();
      if (await limite.direccionBloqueada(ip, ahora)) throw errorDemasiadosIntentos();

      const usuario = await db.usuario.findUnique({
        where: { id: usuarioId },
        select: { hashContrasena: true, bloqueadoHasta: true },
      });
      const correcta = await verificarContrasena(usuario?.hashContrasena ?? hashFicticio, contrasenaActual);
      const bloqueada = usuario !== null && cuentaBloqueada(usuario.bloqueadoHasta, ahora);
      if (!usuario || !correcta || bloqueada) {
        await limite.registrarFalloDireccion(ip, ahora);
        await limite.registrarFalloCuenta(usuario && !correcta ? usuarioId : null, ahora);
        throw new ErrorNegocio('contrasena_actual_incorrecta', 'La contraseña actual no es correcta.', 403);
      }
      validarPoliticaContrasena(contrasenaNueva);
      // Elegir la misma que la temporal dejaría en uso la que conoce el administrador (RF-06).
      if (contrasenaNueva === contrasenaActual) {
        throw new ErrorNegocio(
          'contrasena_igual_a_la_actual',
          'La contraseña nueva tiene que ser distinta de la actual.',
          400,
        );
      }
      const hashNuevo = await hashearContrasena(contrasenaNueva);
      await db.$transaction(async (tx) => {
        // Escritura condicionada al hash que se verificó: si un restablecimiento (RF-08) cambió la
        // contraseña mientras tanto, no se lo pisa; tampoco si un bloqueo concurrente (RNF-02) ya se
        // aplicó. Un cambio correcto reinicia el límite por cuenta (RNF-02).
        const { count } = await tx.usuario.updateMany({
          where: {
            id: usuarioId,
            hashContrasena: usuario.hashContrasena,
            activo: true,
            OR: [{ bloqueadoHasta: null }, { bloqueadoHasta: { lte: ahora } }],
          },
          data: { hashContrasena: hashNuevo, debeCambiarContrasena: false, ...SIN_BLOQUEO },
        });
        if (count === 0) {
          throw new ErrorNegocio(
            'contrasena_modificada',
            'Tu contraseña cambió mientras la modificabas. Ingresá de nuevo.',
            409,
          );
        }
        await tx.sesion.updateMany({
          where: { usuarioId, id: { not: sesionId }, revocadaEn: null },
          data: { revocadaEn: ahora },
        });
      });
    },

    /** Cierre (RF-10): se marca la revocación; la fila se conserva. Es idempotente. */
    async cerrarSesion(token: string): Promise<void> {
      await db.sesion.updateMany({
        where: { hashToken: hashDeToken(token), revocadaEn: null },
        data: { revocadaEn: reloj.ahora() },
      });
    },
  };
}

export type ServicioIdentidad = Awaited<ReturnType<typeof crearServicioIdentidad>>;
