import type { BaseDeDatos } from '../../comun/baseDeDatos.js';
import { ErrorNegocio } from '../../comun/errores.js';
import type { Reloj } from '../../comun/reloj.js';
import type { Bloque } from '../../generado/prisma/client.js';
import { hashearContrasena, validarPoliticaContrasena } from '../m1-identidad/contrasenas.js';

/** Kinesiólogo tal como lo ve la secretaría: nada de la cuenta salvo si está activa. */
export interface KinesiologoListado {
  id: number;
  nombre: string;
  bloque: Bloque;
  activo: boolean;
}

const SELECCION = {
  id: true,
  nombre: true,
  bloque: true,
  usuario: { select: { activo: true } },
} as const;

function aListado(fila: {
  id: number;
  nombre: string;
  bloque: Bloque;
  usuario: { activo: boolean };
}): KinesiologoListado {
  return { id: fila.id, nombre: fila.nombre, bloque: fila.bloque, activo: fila.usuario.activo };
}

function esViolacionDeUnicidad(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002';
}

const errorNoEncontrado = () => new ErrorNegocio('kinesiologo_no_encontrado', 'El kinesiólogo no existe.', 404);

/**
 * Kinesiólogos (RF-14, RF-16). Quién puede leer y escribir lo decide la ruta. El alta crea la
 * cuenta y el perfil en una sola transacción; la política de contraseñas y el hash son los de M1.
 */
export function crearServicioKinesiologos({ db, reloj }: { db: BaseDeDatos; reloj: Reloj }) {
  return {
    /** Kinesiólogos ordenados por nombre; con `bloque`, solo los de ese bloque. */
    async listar(bloque?: Bloque): Promise<KinesiologoListado[]> {
      const filas = await db.kinesiologo.findMany({
        where: bloque ? { bloque } : {},
        select: SELECCION,
        orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
      });
      return filas.map(aListado);
    },

    /**
     * Alta (RF-14): `Usuario` con rol `kinesiologo` marcado para cambiar la contraseña (RF-06) y su
     * `Kinesiologo`, ambos o ninguno. El hash (lento) se calcula antes de abrir la transacción.
     */
    async crear(datos: {
      nombre: string;
      bloque: Bloque;
      nombreUsuario: string;
      contrasenaTemporal: string;
    }): Promise<KinesiologoListado> {
      validarPoliticaContrasena(datos.contrasenaTemporal);
      const hashContrasena = await hashearContrasena(datos.contrasenaTemporal);
      try {
        return await db.$transaction(async (tx) => {
          const usuario = await tx.usuario.create({
            data: {
              nombreUsuario: datos.nombreUsuario,
              hashContrasena,
              rol: 'kinesiologo',
              activo: true,
              debeCambiarContrasena: true,
              creadoEn: reloj.ahora(),
            },
            select: { id: true },
          });
          const fila = await tx.kinesiologo.create({
            data: { usuarioId: usuario.id, nombre: datos.nombre, bloque: datos.bloque },
            select: SELECCION,
          });
          return aListado(fila);
        });
      } catch (err) {
        if (esViolacionDeUnicidad(err)) {
          throw new ErrorNegocio('nombre_usuario_en_uso', 'Ya existe una cuenta con ese nombre de usuario.', 409);
        }
        throw err;
      }
    },

    /** Cambio de bloque (RF-16): solo actualiza al kinesiólogo; los turnos existentes no se tocan. */
    async cambiarBloque(id: number, bloque: Bloque): Promise<KinesiologoListado> {
      const { count } = await db.kinesiologo.updateMany({ where: { id }, data: { bloque } });
      if (count === 0) throw errorNoEncontrado();
      const fila = await db.kinesiologo.findUnique({ where: { id }, select: SELECCION });
      if (!fila) throw errorNoEncontrado();
      return aListado(fila);
    },
  };
}

export type ServicioKinesiologos = ReturnType<typeof crearServicioKinesiologos>;
