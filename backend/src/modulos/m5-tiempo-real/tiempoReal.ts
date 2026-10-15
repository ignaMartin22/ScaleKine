import type { Server as ServidorHttp } from 'node:http';
import type { Logger } from 'pino';
import { Server, type Socket } from 'socket.io';
import type { Reloj } from '../../comun/reloj.js';
import { leerCookieSesion } from '../m1-identidad/cookie.js';
import { pasoPendiente } from '../m1-identidad/pasos.js';
import type { AvisoRevocaciones, CriterioRevocacion } from '../m1-identidad/revocaciones.js';
import { hashDeToken, type SesionActiva } from '../m1-identidad/servicio.js';
import type { CambioDeTurno, EmisorTurnos } from '../m3-turnos/eventos.js';

/**
 * M5 Tiempo real (RF-11, RF-43, RF-44; plan.md §3 M5 y §4.15). Difunde los cambios de turnos que M3
 * ya confirmó; no escribe nada en la base y no decide nada (M3 decide).
 *
 * Contrato del socket (Socket.io sobre el mismo servidor HTTP, ruta `/socket.io`):
 *
 * Handshake
 * - Se autentica con la cookie de sesión, la misma que usa la API: sesión vigente (no vencida ni
 *   revocada) de una cuenta activa y SIN paso pendiente (cambio de contraseña o segundo factor). Una
 *   sesión con un paso pendiente no se conecta.
 * - El encabezado `Origin` tiene que ser exactamente `FRONTEND_ORIGIN`; una conexión sin `Origin` o
 *   con otro se rechaza (plan.md §4.15).
 * - Todo rechazo es igual para el cliente: `connect_error` con el mensaje `no_autorizado`, sin
 *   detalle de la causa (sin cookie, cookie inválida, sesión vencida, paso pendiente). Un `Origin`
 *   ajeno se rechaza antes, en el protocolo de transporte, también sin detalle. El cliente no manda
 *   sala ni identificador alguno: la sala sale de la sesión.
 *
 * Salas (las asigna el servidor al conectar; el cliente no puede unirse ni salir)
 * - `kinesiologo:<id>`: el kinesiólogo de la sesión, solo la suya.
 * - `secretaria`: secretaría y administrador.
 *
 * Eventos del servidor al cliente (el cliente no envía ninguno; cualquiera se ignora)
 * - `turno:cambio` `{ turno }`: el turno se asignó, cambió de estado, se corrigió, cambió sus coseguros
 *   o se reprogramó; `turno` es el turno completo y actual, para reemplazarlo en la agenda por `id`
 *   (si no estaba, agregarlo; si ya no corresponde a la fecha o a los estados que muestra, quitarlo).
 *   Va a la sala del kinesiólogo del turno y a la de secretaría, con la proyección de M4 de cada agenda:
 *   - sala `secretaria`: la de `GET /api/agenda` (con `paciente.id`, `kinesiologo` y `acciones`);
 *   - sala del kinesiólogo: la de `GET /api/mi-agenda`, sin `acciones` (D-15) ni id de paciente.
 * - `turno:quitado` `{ turnoId }`: solo a la sala del kinesiólogo ANTERIOR cuando una reprogramación
 *   cambió de kinesiólogo: el turno ya no es suyo (D-16) y debe sacarlo de su agenda sin recibir sus datos.
 * - `sesion:cerrada` `{ motivo: 'vencida' | 'revocada' }`: justo antes de que el servidor cierre el
 *   socket porque la sesión venció (RF-11) o se revocó (cierre de sesión, cuenta desactivada,
 *   contraseña restablecida o cambiada, revocación desde la línea de comandos). El cliente debe volver
 *   al ingreso y no reintentar.
 *
 * Un evento perdido (conexión caída) no se reenvía: al reconectar el cliente vuelve a pedir la agenda
 * (RF-45).
 */

export const SALA_SECRETARIA = 'secretaria';
export const salaDeKinesiologo = (kinesiologoId: number) => `kinesiologo:${kinesiologoId}`;

export const EVENTO_CAMBIO = 'turno:cambio';
export const EVENTO_QUITADO = 'turno:quitado';
export const EVENTO_SESION_CERRADA = 'sesion:cerrada';

/** Rechazo único del handshake: no revela por qué. */
const MENSAJE_RECHAZO = 'no_autorizado';

/** Tope de `setTimeout` (2^31 - 1 ms); un vencimiento más lejano se reprograma al llegar. */
const MAXIMO_TIMEOUT_MS = 2_147_483_647;

/** Programa `accion` dentro de `ms` milisegundos y devuelve la función que la cancela. */
export type Programador = (ms: number, accion: () => void) => () => void;

const programadorDelSistema: Programador = (ms, accion) => {
  const temporizador = setTimeout(accion, ms);
  temporizador.unref();
  return () => clearTimeout(temporizador);
};

/** Lo que M5 necesita de los demás módulos; se enlaza al armar las rutas, que crean esos servicios. */
export interface DependenciasDeDifusion {
  sesionVigente(token: string): Promise<SesionActiva | null>;
  kinesiologoIdDeCuenta(usuarioId: number): Promise<number | null>;
  /** Proyecciones de M4 del turno, o `null` si no existe. */
  turnoParaDifusion(turnoId: number): Promise<{ secretaria: object; kinesiologo: object } | null>;
}

export interface OpcionesTiempoReal {
  logger: Logger;
  reloj: Reloj;
  /** `FRONTEND_ORIGIN`. */
  origenPermitido: string;
  cookieSegura: boolean;
  /** Para la desconexión al vencer; las pruebas inyectan uno propio. */
  programar?: Programador;
  /** Cada cuánto se revalida la sesión de los sockets abiertos; 0 lo desactiva. Por defecto 60 s. */
  intervaloRevalidacionMs?: number;
}

/** Lo que el resto del backend necesita de M5 para armarse (sin Socket.io). */
export interface PuntosDeEnganche {
  /** Se inyecta en `crearServicioTurnos`: M3 avisa tras cada commit. */
  readonly emisor: EmisorTurnos;
  /** Se inyecta en M1: avisa cuando se revocan sesiones, para cerrar los sockets de esas sesiones. */
  readonly revocaciones: AvisoRevocaciones;
  enlazar(dependencias: DependenciasDeDifusion): void;
}

export interface TiempoReal extends PuntosDeEnganche {
  /** Monta Socket.io sobre el servidor HTTP. */
  adjuntar(servidor: ServidorHttp): void;
  /** Resuelve cuando se terminó de difundir lo pendiente; para las pruebas y el apagado. */
  vaciar(): Promise<void>;
  /** Cierra los sockets y el servidor Socket.io (también cierra el servidor HTTP al que está adjunto). */
  cerrar(): Promise<void>;
}

interface SocketVivo {
  socket: Socket;
  token: string;
  hashToken: string;
  sesionId: number;
  usuarioId: number;
  cancelarVencimiento: () => void;
}

/** Puntos de enganche que no hacen nada: para las rutas cuando no hay servidor de sockets. */
export const TIEMPO_REAL_NULO: PuntosDeEnganche = {
  emisor: { turnoCambiado: () => undefined },
  revocaciones: { sesionesRevocadas: () => undefined },
  enlazar: () => undefined,
};

export function crearTiempoReal(opciones: OpcionesTiempoReal): TiempoReal {
  const { logger, reloj, origenPermitido, cookieSegura } = opciones;
  const programar = opciones.programar ?? programadorDelSistema;
  const intervaloRevalidacionMs = opciones.intervaloRevalidacionMs ?? 60_000;

  let dependencias: DependenciasDeDifusion | undefined;
  let io: Server | undefined;
  let revalidacion: NodeJS.Timeout | undefined;
  const vivos = new Set<SocketVivo>();
  // Las difusiones se encadenan: cada una relee el turno, y en orden la última siempre deja el estado actual.
  let cola: Promise<void> = Promise.resolve();

  /** Solo el tipo del error: el mensaje de un error de base podría incluir datos de la consulta. */
  const tipoDeError = (error: unknown) => (error instanceof Error ? error.name : typeof error);

  function cerrarVivo(vivo: SocketVivo, motivo: 'vencida' | 'revocada'): void {
    vivos.delete(vivo);
    vivo.cancelarVencimiento();
    vivo.socket.emit(EVENTO_SESION_CERRADA, { motivo });
    vivo.socket.disconnect(true);
    logger.info({ motivo }, 'socket cerrado por la sesión');
  }

  /** Desconexión al vencer la sesión (RF-11), con el reloj inyectable. */
  function programarVencimiento(vivo: SocketVivo, venceEn: Date): void {
    const restante = venceEn.getTime() - reloj.ahora().getTime();
    vivo.cancelarVencimiento = programar(Math.min(Math.max(restante, 0), MAXIMO_TIMEOUT_MS), () => {
      if (reloj.ahora().getTime() < venceEn.getTime()) {
        // El temporizador saltó antes de tiempo o el vencimiento es más lejano que el tope: se reprograma.
        programarVencimiento(vivo, venceEn);
        return;
      }
      cerrarVivo(vivo, 'vencida');
    });
  }

  /** Cubre lo que M1 no puede avisar desde este proceso (p. ej. `revocarSesiones` de la línea de comandos). */
  async function revalidar(): Promise<void> {
    if (!dependencias) return;
    for (const vivo of [...vivos]) {
      try {
        const sesion = await dependencias.sesionVigente(vivo.token);
        if (!vivos.has(vivo)) continue;
        if (!sesion || pasoPendiente(sesion.usuario, sesion.segundoFactorVerificado) !== null) {
          cerrarVivo(vivo, 'revocada');
        }
      } catch (error) {
        // Ante un fallo de la base no se corta a nadie: se reintenta en la próxima vuelta.
        logger.error({ tipo: tipoDeError(error) }, 'no se pudo revalidar una sesión de socket');
      }
    }
  }

  async function autenticar(socket: Socket): Promise<{ sesion: SesionActiva; token: string; sala: string } | null> {
    if (!dependencias) return null;
    const token = leerCookieSesion(socket.request, { cookieSegura });
    if (token === undefined) return null;
    const sesion = await dependencias.sesionVigente(token);
    // Una sesión con paso pendiente no se conecta, igual que `exigirSesion` la rechaza en la API.
    if (!sesion || pasoPendiente(sesion.usuario, sesion.segundoFactorVerificado) !== null) return null;
    // La sala sale de la sesión, nunca de lo que mande el cliente.
    if (sesion.usuario.rol === 'kinesiologo') {
      const kinesiologoId = await dependencias.kinesiologoIdDeCuenta(sesion.usuario.id);
      return kinesiologoId === null ? null : { sesion, token, sala: salaDeKinesiologo(kinesiologoId) };
    }
    return { sesion, token, sala: SALA_SECRETARIA };
  }

  async function difundir(cambio: CambioDeTurno): Promise<void> {
    if (!io || !dependencias) return;
    const proyecciones = await dependencias.turnoParaDifusion(cambio.turnoId);
    if (!proyecciones) return;
    io.to(SALA_SECRETARIA).emit(EVENTO_CAMBIO, { turno: proyecciones.secretaria });
    io.to(salaDeKinesiologo(cambio.kinesiologoId)).emit(EVENTO_CAMBIO, { turno: proyecciones.kinesiologo });
    if (cambio.kinesiologoAnteriorId !== undefined) {
      io.to(salaDeKinesiologo(cambio.kinesiologoAnteriorId)).emit(EVENTO_QUITADO, { turnoId: cambio.turnoId });
    }
  }

  const emisor: EmisorTurnos = {
    turnoCambiado(cambio) {
      cola = cola
        .then(() => difundir(cambio))
        .catch((error: unknown) => {
          logger.error({ tipo: tipoDeError(error) }, 'no se pudo difundir un cambio de turno');
        });
    },
  };

  const revocaciones: AvisoRevocaciones = {
    sesionesRevocadas(criterio: CriterioRevocacion) {
      for (const vivo of [...vivos]) {
        const coincide =
          'hashToken' in criterio
            ? vivo.hashToken === criterio.hashToken
            : vivo.usuarioId === criterio.usuarioId && vivo.sesionId !== criterio.exceptoSesionId;
        if (coincide) cerrarVivo(vivo, 'revocada');
      }
    },
  };

  return {
    emisor,
    revocaciones,
    enlazar(deps) {
      dependencias = deps;
    },

    adjuntar(servidor) {
      io = new Server(servidor, {
        serveClient: false,
        // El cliente no envía datos útiles: un tope bajo corta cualquier carga abusiva.
        maxHttpBufferSize: 1024,
        // Sin CORS: frontend y API comparten origen. Se exige `Origin` exacto en todo handshake.
        allowRequest: (req, devolver) => {
          devolver(null, req.headers.origin === origenPermitido);
        },
      });

      io.use((socket, siguiente) => {
        autenticar(socket)
          .then((autenticado) => {
            if (!autenticado) {
              logger.warn('conexión de socket rechazada');
              siguiente(new Error(MENSAJE_RECHAZO));
              return;
            }
            socket.data = autenticado;
            siguiente();
          })
          .catch((error: unknown) => {
            logger.error({ tipo: tipoDeError(error) }, 'falló la autenticación de un socket');
            siguiente(new Error(MENSAJE_RECHAZO));
          });
      });

      io.on('connection', (socket) => {
        const { sesion, token, sala } = socket.data as { sesion: SesionActiva; token: string; sala: string };
        const vivo: SocketVivo = {
          socket,
          token,
          hashToken: hashDeToken(token),
          sesionId: sesion.id,
          usuarioId: sesion.usuario.id,
          cancelarVencimiento: () => undefined,
        };
        vivos.add(vivo);
        void socket.join(sala);
        programarVencimiento(vivo, sesion.venceEn);
        socket.on('disconnect', () => {
          vivos.delete(vivo);
          vivo.cancelarVencimiento();
        });
        logger.info({ rol: sesion.usuario.rol }, 'socket conectado');
      });

      if (intervaloRevalidacionMs > 0) {
        revalidacion = setInterval(() => void revalidar(), intervaloRevalidacionMs);
        revalidacion.unref();
      }
    },

    async vaciar() {
      await cola;
    },

    async cerrar() {
      if (revalidacion) clearInterval(revalidacion);
      for (const vivo of vivos) vivo.cancelarVencimiento();
      vivos.clear();
      const servidor = io;
      io = undefined;
      if (servidor) await servidor.close();
    },
  };
}
