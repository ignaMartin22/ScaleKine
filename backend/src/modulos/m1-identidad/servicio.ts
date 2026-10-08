import { createHash, randomBytes } from 'node:crypto';
import type { BaseDeDatos } from '../../comun/baseDeDatos.js';
import { ErrorNegocio } from '../../comun/errores.js';
import type { Reloj } from '../../comun/reloj.js';
import type { Rol } from '../../generado/prisma/client.js';
import { hashearContrasena, validarPoliticaContrasena, verificarContrasena } from './contrasenas.js';

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

export async function crearServicioIdentidad({ db, reloj }: { db: BaseDeDatos; reloj: Reloj }) {
  // Hash de una contraseña al azar, calculado al crear el servicio: si argon2 falla se nota al
  // arrancar y no en el primer ingreso. Sirve para verificar contra algo cuando el usuario no
  // existe y que la respuesta tarde lo mismo (RF-02).
  const hashFicticio = await hashearContrasena(randomBytes(32).toString('base64url'));

  return {
    /**
     * Ingreso (RF-01, RF-02). Usuario inexistente, contraseña incorrecta y cuenta inactiva (RF-09)
     * dan exactamente el mismo error, y en los tres casos se verifica un hash.
     */
    async ingresar(
      nombreUsuario: string,
      contrasena: string,
    ): Promise<{ token: string; venceEn: Date; usuario: UsuarioSesion }> {
      const usuario = await db.usuario.findUnique({ where: { nombreUsuario } });
      if (!usuario) {
        await verificarContrasena(hashFicticio, contrasena);
        throw errorCredenciales();
      }
      const contrasenaCorrecta = await verificarContrasena(usuario.hashContrasena, contrasena);
      if (!contrasenaCorrecta || !usuario.activo) throw errorCredenciales();

      const token = randomBytes(32).toString('base64url');
      const creadaEn = reloj.ahora();
      const venceEn = new Date(creadaEn.getTime() + DURACION_SESION_MS);
      await db.sesion.create({
        data: {
          hashToken: hashDeToken(token),
          usuarioId: usuario.id,
          creadaEn,
          venceEn,
        },
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
     * En la misma transacción revoca las demás sesiones de la cuenta (RF-07): quien conocía la
     * contraseña anterior, p. ej. la temporal, no conserva una sesión abierta. La sesión desde la que
     * se cambia sigue vigente.
     */
    async cambiarContrasena(
      { usuarioId, sesionId }: { usuarioId: number; sesionId: number },
      contrasenaActual: string,
      contrasenaNueva: string,
    ): Promise<void> {
      const usuario = await db.usuario.findUnique({
        where: { id: usuarioId },
        select: { hashContrasena: true },
      });
      if (!usuario || !(await verificarContrasena(usuario.hashContrasena, contrasenaActual))) {
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
        // contraseña mientras tanto, no se lo pisa.
        const { count } = await tx.usuario.updateMany({
          where: { id: usuarioId, hashContrasena: usuario.hashContrasena },
          data: { hashContrasena: hashNuevo, debeCambiarContrasena: false },
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
          data: { revocadaEn: reloj.ahora() },
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
