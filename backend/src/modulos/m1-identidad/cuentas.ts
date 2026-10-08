import type { BaseDeDatos } from '../../comun/baseDeDatos.js';
import { ErrorNegocio } from '../../comun/errores.js';
import type { Reloj } from '../../comun/reloj.js';
import type { Rol } from '../../generado/prisma/client.js';
import { hashearContrasena, validarPoliticaContrasena } from './contrasenas.js';
import { SIN_BLOQUEO } from './limiteIntentos.js';

/** Cuenta tal como la ve el administrador: nunca incluye hashes, secretos ni datos de bloqueo. */
export interface CuentaListada {
  id: number;
  nombreUsuario: string;
  rol: Rol;
  activo: boolean;
  debeCambiarContrasena: boolean;
}

const SELECCION_CUENTA = {
  id: true,
  nombreUsuario: true,
  rol: true,
  activo: true,
  debeCambiarContrasena: true,
} as const;

const errorNoEncontrada = () => new ErrorNegocio('cuenta_no_encontrada', 'La cuenta no existe.', 404);
const errorAdministrador = () =>
  new ErrorNegocio(
    'cuenta_de_administrador',
    'La cuenta de administrador no se gestiona desde acá: se restablece desde la línea de comandos.',
    409,
  );
const errorInactiva = () =>
  new ErrorNegocio('cuenta_inactiva', 'La cuenta está desactivada y no se puede restablecer.', 409);

function esViolacionDeUnicidad(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002';
}

/**
 * Gestión de cuentas (RF-04, RF-08, RF-09). Quién puede llamarlo lo decide la ruta con
 * `autorizarEscritura('cuentas')`. En restablecer y desactivar, la fila de `Usuario` se escribe
 * ANTES que las sesiones: un ingreso concurrente que confirme en el medio queda serializado por la
 * fila y, o ve la cuenta ya cambiada y no crea sesión, o la crea antes y la revocación la alcanza.
 */
export function crearServicioCuentas({ db, reloj }: { db: BaseDeDatos; reloj: Reloj }) {
  async function cuentaGestionable(id: number) {
    const cuenta = await db.usuario.findUnique({
      where: { id },
      select: SELECCION_CUENTA,
    });
    if (!cuenta) throw errorNoEncontrada();
    if (cuenta.rol === 'administrador') throw errorAdministrador();
    return cuenta;
  }

  return {
    /** Todas las cuentas, activas e inactivas, ordenadas por nombre de usuario. */
    async listar(): Promise<CuentaListada[]> {
      return db.usuario.findMany({
        select: SELECCION_CUENTA,
        orderBy: { nombreUsuario: 'asc' },
      });
    },

    /**
     * Alta de una cuenta de secretaría (RF-04) con contraseña temporal elegida por el administrador:
     * queda activa y marcada para cambiarla (RF-06). La de kinesiólogo nace con su perfil (RF-14).
     */
    async crear(nombreUsuario: string, contrasenaTemporal: string): Promise<CuentaListada> {
      validarPoliticaContrasena(contrasenaTemporal);
      const hashContrasena = await hashearContrasena(contrasenaTemporal);
      try {
        return await db.usuario.create({
          data: {
            nombreUsuario,
            hashContrasena,
            rol: 'secretaria',
            activo: true,
            debeCambiarContrasena: true,
            creadoEn: reloj.ahora(),
          },
          select: SELECCION_CUENTA,
        });
      } catch (err) {
        if (esViolacionDeUnicidad(err)) {
          throw new ErrorNegocio(
            'nombre_usuario_en_uso',
            'Ya existe una cuenta con ese nombre de usuario.',
            409,
          );
        }
        throw err;
      }
    },

    /**
     * Restablecimiento (RF-08): contraseña temporal nueva, marca de cambio pendiente, bloqueo por
     * intentos levantado (RNF-02) y sesiones abiertas revocadas, en una transacción y en ese orden.
     */
    async restablecer(id: number, contrasenaTemporal: string): Promise<void> {
      validarPoliticaContrasena(contrasenaTemporal);
      const cuenta = await cuentaGestionable(id);
      if (!cuenta.activo) throw errorInactiva();
      const hashContrasena = await hashearContrasena(contrasenaTemporal);
      const ahora = reloj.ahora();
      await db.$transaction(async (tx) => {
        const { count } = await tx.usuario.updateMany({
          where: { id, activo: true, rol: { not: 'administrador' } },
          data: { hashContrasena, debeCambiarContrasena: true, ...SIN_BLOQUEO },
        });
        // La cuenta se desactivó entre la lectura y la escritura: no se revoca nada.
        if (count === 0) throw errorInactiva();
        await tx.sesion.updateMany({
          where: { usuarioId: id, revocadaEn: null },
          data: { revocadaEn: ahora },
        });
      });
    },

    /**
     * Desactivación (RF-09): la cuenta no puede ingresar y sus sesiones abiertas se revocan. La fila
     * se conserva porque los turnos y sus eventos la referencian. Es idempotente.
     */
    async desactivar(id: number): Promise<void> {
      await cuentaGestionable(id);
      const ahora = reloj.ahora();
      await db.$transaction(async (tx) => {
        // Sin `activo: true`: es idempotente, y revocar las sesiones de una cuenta ya inactiva no hace daño.
        await tx.usuario.updateMany({
          where: { id, rol: { not: 'administrador' } },
          data: { activo: false },
        });
        await tx.sesion.updateMany({
          where: { usuarioId: id, revocadaEn: null },
          data: { revocadaEn: ahora },
        });
      });
    },
  };
}

export type ServicioCuentas = ReturnType<typeof crearServicioCuentas>;
