import type { BaseDeDatos } from '../../comun/baseDeDatos.js';
import { ErrorNegocio } from '../../comun/errores.js';
import type { Reloj } from '../../comun/reloj.js';
import { crearLimiteIntentos, cuentaBloqueada, SIN_BLOQUEO } from './limiteIntentos.js';
import { errorDemasiadosIntentos } from './servicio.js';
import {
  cifrarSecreto,
  descifrarSecreto,
  esCodigoTotp,
  exigirClaveCifrado,
  generarCodigosRecuperacion,
  generarQr,
  generarSecretoTotp,
  hashCodigoRecuperacion,
  uriOtpauth,
  verificarCodigoTotp,
} from './segundoFactor.js';

/** Mismo error para un código inválido, repetido o con la cuenta bloqueada: no revela cuál fue (RNF-02). */
function errorSegundoFactorInvalido(): ErrorNegocio {
  return new ErrorNegocio('segundo_factor_invalido', 'El código no es válido.', 403);
}

/** Sentinela para deshacer la transacción cuando la sesión se revocó mientras se verificaba. */
class SesionPerdida extends Error {}

const errorSesionInvalida = () =>
  new ErrorNegocio('sesion_invalida', 'Tu sesión venció o no es válida. Ingresá de nuevo.', 401);

export interface IdentidadSesion {
  usuarioId: number;
  sesionId: number;
}

type Aceptado = { tipo: 'totp'; paso: number } | { tipo: 'recuperacion'; hash: string };

/**
 * Segundo factor del administrador (RNF-04, plan.md §4.11): activación con TOTP y códigos de
 * recuperación, y verificación de la sesión. Nada de lo que maneja (secreto, códigos, hashes) se
 * registra en logs ni vuelve al cliente, salvo el QR y los códigos de recuperación al activar.
 */
export function crearServicioSegundoFactor({
  db,
  reloj,
  claveCifrado,
}: {
  db: BaseDeDatos;
  reloj: Reloj;
  claveCifrado: Buffer | undefined;
}) {
  const limite = crearLimiteIntentos({ db });

  return {
    /**
     * Genera un secreto nuevo, lo guarda cifrado con `totpActivo` en false y devuelve el QR. Repetirlo
     * reemplaza el secreto pendiente. No se puede si el segundo factor ya está activo.
     */
    async iniciarActivacion({ usuarioId }: IdentidadSesion, nombreUsuario: string): Promise<{ qr: string }> {
      const clave = exigirClaveCifrado(claveCifrado);
      const secreto = generarSecretoTotp();
      const { count } = await db.usuario.updateMany({
        where: { id: usuarioId, activo: true, totpActivo: false },
        data: { secretoTotpCifrado: cifrarSecreto(secreto, clave, usuarioId) },
      });
      if (count === 0) {
        throw new ErrorNegocio('segundo_factor_ya_activo', 'El segundo factor ya está activo.', 409);
      }
      return { qr: await generarQr(uriOtpauth(secreto, nombreUsuario)) };
    },

    /**
     * Confirma la activación con un código del secreto pendiente. Un código inválido es 400 y no
     * cuenta para el límite: quien activa ya tiene sesión y acaba de ver el secreto. En una sola
     * transacción activa el TOTP, guarda el paso usado y los hashes de los códigos de recuperación, y
     * deja verificada la sesión actual. Los códigos en claro se devuelven una sola vez.
     */
    async confirmarActivacion(
      { usuarioId, sesionId }: IdentidadSesion,
      codigo: string,
    ): Promise<{ codigosRecuperacion: string[] }> {
      const clave = exigirClaveCifrado(claveCifrado);
      const usuario = await db.usuario.findUnique({
        where: { id: usuarioId },
        select: { secretoTotpCifrado: true, totpActivo: true },
      });
      if (!usuario || usuario.totpActivo) {
        throw new ErrorNegocio('segundo_factor_ya_activo', 'El segundo factor ya está activo.', 409);
      }
      if (!usuario.secretoTotpCifrado) {
        throw new ErrorNegocio(
          'activacion_no_iniciada',
          'Primero tenés que generar el código QR de activación.',
          400,
        );
      }
      const secretoCifrado = usuario.secretoTotpCifrado;
      const secreto = descifrarSecreto(secretoCifrado, clave, usuarioId);
      const paso = verificarCodigoTotp(secreto, codigo, reloj.ahora());
      if (paso === null) {
        throw new ErrorNegocio('codigo_invalido', 'El código no es válido.', 400);
      }
      const { codigos, hashes } = generarCodigosRecuperacion();
      try {
        await db.$transaction(async (tx) => {
          // Condicionada al secreto que se verificó: si otra activación lo reemplazó o ya activó el
          // segundo factor mientras tanto, no se pisa nada.
          const { count } = await tx.usuario.updateMany({
            where: { id: usuarioId, activo: true, totpActivo: false, secretoTotpCifrado: secretoCifrado },
            data: { totpActivo: true, ultimoPasoTotp: paso, codigosRecuperacion: hashes },
          });
          if (count === 0) {
            throw new ErrorNegocio(
              'activacion_modificada',
              'La activación cambió mientras la confirmabas. Empezá de nuevo.',
              409,
            );
          }
          const sesion = await tx.sesion.updateMany({
            where: { id: sesionId, usuarioId, revocadaEn: null },
            data: { segundoFactorVerificado: true },
          });
          if (sesion.count === 0) throw new SesionPerdida();
        });
      } catch (error) {
        if (error instanceof SesionPerdida) throw errorSesionInvalida();
        throw error;
      }
      return { codigosRecuperacion: codigos };
    },

    /**
     * Verifica el segundo factor de la sesión (RNF-04). Seis dígitos se toman como TOTP; cualquier
     * otra entrada, como código de recuperación. Cuenta contra el límite de intentos (RNF-02) igual
     * que una contraseña incorrecta: reserva el intento de la dirección antes de verificar, suma un
     * fallo a la dirección y a la cuenta en cada rechazo y devuelve el punto de la dirección solo
     * cuando la escritura ya se confirmó. Todo rechazo es 403 `segundo_factor_invalido` (nunca 401:
     * el frontend lo leería como sesión vencida), también con la cuenta bloqueada.
     *
     * Un TOTP no se reutiliza dentro de su ventana y un código de recuperación se gasta una sola
     * vez, aun en paralelo: ambos se consumen con una escritura condicionada al estado leído.
     */
    async verificar({ usuarioId, sesionId, ip }: IdentidadSesion & { ip: string }, codigo: string): Promise<void> {
      const clave = exigirClaveCifrado(claveCifrado);
      const ahora = reloj.ahora();
      if (!(await limite.reservarIntentoDireccion(ip, ahora))) throw errorDemasiadosIntentos();

      const usuario = await db.usuario.findUnique({
        where: { id: usuarioId },
        select: { totpActivo: true, secretoTotpCifrado: true, codigosRecuperacion: true },
      });
      const leidos = usuario?.codigosRecuperacion ?? [];
      let aceptado: Aceptado | null = null;
      if (usuario?.totpActivo && usuario.secretoTotpCifrado) {
        if (esCodigoTotp(codigo)) {
          const secreto = descifrarSecreto(usuario.secretoTotpCifrado, clave, usuarioId);
          const paso = verificarCodigoTotp(secreto, codigo, ahora);
          if (paso !== null) aceptado = { tipo: 'totp', paso };
        } else {
          const hash = hashCodigoRecuperacion(codigo);
          if (leidos.includes(hash)) aceptado = { tipo: 'recuperacion', hash };
        }
      }
      // El bloqueo se lee DESPUÉS de verificar, igual que en el cambio de contraseña: un bloqueo
      // que cae mientras se verifica tiene que dar el mismo rechazo que un código inválido (RNF-02).
      const estado = await db.usuario.findUnique({ where: { id: usuarioId }, select: { bloqueadoHasta: true } });
      const bloqueada = estado !== null && cuentaBloqueada(estado.bloqueadoHasta, ahora);
      if (!aceptado || bloqueada) {
        await limite.confirmarFalloDireccion(ip, ahora);
        await limite.registrarFalloCuenta(usuario && !bloqueada ? usuarioId : null, ahora);
        throw errorSegundoFactorInvalido();
      }

      const consumido: Aceptado = aceptado;
      const sinBloqueo = [{ bloqueadoHasta: null }, { bloqueadoHasta: { lte: ahora } }];
      let resultado: 'verificado' | 'rechazado';
      try {
        resultado = await db.$transaction(async (tx) => {
          const base = { id: usuarioId, activo: true, totpActivo: true };
          const { count } =
            consumido.tipo === 'totp'
              ? await tx.usuario.updateMany({
                  where: {
                    ...base,
                    AND: [
                      { OR: [{ ultimoPasoTotp: null }, { ultimoPasoTotp: { lt: consumido.paso } }] },
                      { OR: sinBloqueo },
                    ],
                  },
                  data: { ultimoPasoTotp: consumido.paso, ...SIN_BLOQUEO },
                })
              : await tx.usuario.updateMany({
                  where: { ...base, codigosRecuperacion: { equals: leidos }, OR: sinBloqueo },
                  data: { codigosRecuperacion: leidos.filter((h) => h !== consumido.hash), ...SIN_BLOQUEO },
                });
          if (count === 0) return 'rechazado';
          const sesion = await tx.sesion.updateMany({
            where: { id: sesionId, usuarioId, revocadaEn: null },
            data: { segundoFactorVerificado: true },
          });
          if (sesion.count === 0) throw new SesionPerdida();
          return 'verificado';
        });
      } catch (error) {
        if (error instanceof SesionPerdida) throw errorSesionInvalida();
        throw error;
      }
      if (resultado === 'rechazado') {
        // Código ya usado (en serie o en paralelo), lista modificada o bloqueo en la carrera: el
        // punto reservado de la dirección cuenta y la respuesta es la de un código inválido.
        const actual = await db.usuario.findUnique({ where: { id: usuarioId }, select: { bloqueadoHasta: true } });
        const ahoraBloqueada = actual !== null && cuentaBloqueada(actual.bloqueadoHasta, ahora);
        await limite.confirmarFalloDireccion(ip, ahora);
        await limite.registrarFalloCuenta(ahoraBloqueada ? null : usuarioId, ahora);
        throw errorSegundoFactorInvalido();
      }
      // Solo con la escritura confirmada se devuelve el punto: solo los fallos cuentan (RNF-02).
      await limite.liberarIntentoDireccion(ip, ahora);
    },
  };
}

export type ServicioSegundoFactor = ReturnType<typeof crearServicioSegundoFactor>;
