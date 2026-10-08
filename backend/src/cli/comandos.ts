import type { BaseDeDatos } from '../comun/baseDeDatos.js';
import { ErrorNegocio } from '../comun/errores.js';
import type { Reloj } from '../comun/reloj.js';
import { hashearContrasena } from '../modulos/m1-identidad/contrasenas.js';
import { generarContrasenaTemporal } from './contrasenaTemporal.js';

/**
 * Subcomandos de instalación y operación (T-10, plan.md §5.1). Cada uno es una función que recibe
 * sus dependencias, para probarla sin lanzar procesos; el punto de entrada (`index.ts`) solo lee
 * los argumentos y la configuración. Ninguna imprime: devuelven lo que el punto de entrada muestra.
 */

export interface DependenciasCli {
  db: BaseDeDatos;
  reloj: Reloj;
  /** Por defecto, `generarContrasenaTemporal`. Las pruebas pueden fijarla. */
  generarContrasena?: () => string;
}

export interface DatosInstalacion {
  usuario: string;
  nombre: string;
  direccion: string;
  telefono: string;
}

export interface SeleccionAdministrador {
  /** Obligatorio solo si, contra lo previsto, hay más de un administrador. */
  usuario?: string | undefined;
}

export interface ResultadoContrasenaTemporal {
  /** Se muestra una sola vez y no se guarda en ningún lado (RF-05). */
  contrasenaTemporal: string;
}

function yaInstalado(): ErrorNegocio {
  return new ErrorNegocio(
    'ya_instalado',
    'El sistema ya está instalado (hay un administrador o un consultorio). No se modificó nada.',
    409,
  );
}

function esViolacionDeUnicidad(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'P2002';
}

/**
 * Instalación (RF-05, RF-13): crea el administrador activo y marcado para cambio de contraseña, y
 * la fila única de `Consultorio`. Todo o nada; si ya hay un administrador o un consultorio, se niega
 * sin modificar nada.
 */
export async function instalar(
  { db, reloj, generarContrasena = generarContrasenaTemporal }: DependenciasCli,
  datos: DatosInstalacion,
): Promise<ResultadoContrasenaTemporal> {
  const contrasenaTemporal = generarContrasena();
  const hashContrasena = await hashearContrasena(contrasenaTemporal);
  try {
    await db.$transaction(async (tx) => {
      const [administradores, consultorios] = await Promise.all([
        tx.usuario.count({ where: { rol: 'administrador' } }),
        tx.consultorio.count(),
      ]);
      if (administradores > 0 || consultorios > 0) throw yaInstalado();
      await tx.usuario.create({
        data: {
          nombreUsuario: datos.usuario,
          hashContrasena,
          rol: 'administrador',
          activo: true,
          debeCambiarContrasena: true,
          creadoEn: reloj.ahora(),
        },
      });
      await tx.consultorio.create({
        data: { id: 1, nombre: datos.nombre, direccion: datos.direccion, telefono: datos.telefono },
      });
    });
  } catch (error) {
    // Dos instalaciones simultáneas chocan en la fila única o en el nombre de usuario.
    if (esViolacionDeUnicidad(error)) throw yaInstalado();
    throw error;
  }
  return { contrasenaTemporal };
}

async function buscarAdministrador(db: BaseDeDatos, { usuario }: SeleccionAdministrador) {
  const administradores = await db.usuario.findMany({
    where: { rol: 'administrador', ...(usuario === undefined ? {} : { nombreUsuario: usuario }) },
    select: { id: true },
  });
  if (administradores.length === 0) {
    throw new ErrorNegocio(
      'administrador_inexistente',
      'No hay un administrador con esos datos. Si el sistema no está instalado, usá `instalar`.',
      404,
    );
  }
  if (administradores.length > 1) {
    throw new ErrorNegocio(
      'administrador_ambiguo',
      'Hay más de un administrador: indicá cuál con --usuario.',
      409,
    );
  }
  return administradores[0]!;
}

/**
 * Restablece la contraseña del administrador (plan.md §9): genera una temporal, marca la cuenta para
 * cambio (RF-06), levanta el bloqueo por intentos (RNF-02) y cierra todas sus sesiones.
 */
export async function restablecerAdmin(
  { db, reloj, generarContrasena = generarContrasenaTemporal }: DependenciasCli,
  seleccion: SeleccionAdministrador,
): Promise<ResultadoContrasenaTemporal> {
  const { id } = await buscarAdministrador(db, seleccion);
  const contrasenaTemporal = generarContrasena();
  const hashContrasena = await hashearContrasena(contrasenaTemporal);
  await db.$transaction(async (tx) => {
    // Primero la fila de la cuenta y después las sesiones. Un ingreso concurrente con la contraseña
    // vieja reconfirma el hash al crear su sesión (servicio de identidad): si confirmó antes que
    // esta escritura, su sesión ya existe cuando se revocan; si confirma después, no se crea. Al
    // revés (revocar primero) podría quedar una sesión viva.
    await tx.usuario.update({
      where: { id },
      data: {
        hashContrasena,
        debeCambiarContrasena: true,
        // Un restablecimiento levanta el bloqueo de la cuenta (RNF-02). T-09 va a ofrecer una
        // operación para esto en el módulo de identidad: cuando exista, usarla acá.
        ingresosFallidos: 0,
        bloqueadoHasta: null,
        bloqueosConsecutivos: 0,
      },
    });
    await tx.sesion.updateMany({
      where: { usuarioId: id, revocadaEn: null },
      data: { revocadaEn: reloj.ahora() },
    });
  });
  return { contrasenaTemporal };
}

/**
 * Desactiva el segundo factor del administrador (RNF-04): lo deja sin activar, sin secreto y sin
 * códigos de recuperación, para que lo vuelva a activar en su próximo ingreso. También cierra sus
 * sesiones abiertas: una que ya verificó el segundo factor no debe sobrevivir a la pérdida de la
 * aplicación autenticadora.
 */
export async function restablecer2faAdmin(
  { db, reloj }: DependenciasCli,
  seleccion: SeleccionAdministrador,
): Promise<void> {
  const { id } = await buscarAdministrador(db, seleccion);
  await db.$transaction(async (tx) => {
    // Mismo orden que `restablecerAdmin`: primero la fila de la cuenta y después las sesiones.
    await tx.usuario.update({
      where: { id },
      data: { totpActivo: false, secretoTotpCifrado: null, codigosRecuperacion: [] },
    });
    await tx.sesion.updateMany({
      where: { usuarioId: id, revocadaEn: null },
      data: { revocadaEn: reloj.ahora() },
    });
  });
}

/**
 * Revoca todas las sesiones vigentes de todas las cuentas, para contener un incidente
 * (despliegue.md §12). Devuelve cuántas revocó; las ya revocadas conservan su fecha.
 */
export async function revocarSesiones({ db, reloj }: DependenciasCli): Promise<{ revocadas: number }> {
  const { count } = await db.sesion.updateMany({
    where: { revocadaEn: null },
    data: { revocadaEn: reloj.ahora() },
  });
  return { revocadas: count };
}
