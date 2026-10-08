import { createHash, randomBytes } from 'node:crypto';
import type { BaseDeDatos } from '../../comun/baseDeDatos.js';
import { ErrorNegocio } from '../../comun/errores.js';
import type { Reloj } from '../../comun/reloj.js';
import type { Rol } from '../../generado/prisma/client.js';
import { hashearContrasena, verificarContrasena } from './contrasenas.js';

/** Duración fija de la sesión, sin renovación por actividad (RF-11, D-14). */
export const DURACION_SESION_MS = 12 * 60 * 60 * 1000;

export interface UsuarioSesion {
  id: number;
  nombreUsuario: string;
  rol: Rol;
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
        data: { hashToken: hashDeToken(token), usuarioId: usuario.id, creadaEn, venceEn },
      });
      return {
        token,
        venceEn,
        usuario: { id: usuario.id, nombreUsuario: usuario.nombreUsuario, rol: usuario.rol },
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
          usuario: { select: { id: true, nombreUsuario: true, rol: true, activo: true } },
        },
      });
      if (!sesion || sesion.revocadaEn !== null) return null;
      // Al cumplirse las 12 horas exactas la sesión ya está vencida (RF-11).
      if (sesion.venceEn.getTime() <= reloj.ahora().getTime()) return null;
      if (!sesion.usuario.activo) return null;
      const { id, nombreUsuario, rol } = sesion.usuario;
      return { id: sesion.id, usuario: { id, nombreUsuario, rol } };
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
