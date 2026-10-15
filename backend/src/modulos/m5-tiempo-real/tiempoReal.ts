import type { IncomingMessage, Server as ServidorHttp } from 'node:http';
import type { Logger } from 'pino';
import { Server, type Socket } from 'socket.io';
import type { Reloj } from '../../comun/reloj.js';
import { leerCookieSesion } from '../m1-identidad/cookie.js';
import { pasoPendiente } from '../m1-identidad/pasos.js';
import type { AvisoRevocaciones, CriterioRevocacion } from '../m1-identidad/revocaciones.js';
import { hashDeToken, type SesionActiva } from '../m1-identidad/servicio.js';
import type { EmisorTurnos } from '../m3-turnos/eventos.js';

/**
 * M5 Tiempo real (RF-11, RF-43, RF-44; plan.md §3 M5 y §4.15). Difunde los cambios de turnos que M3
 * ya confirmó; no escribe nada en la base y no decide nada (M3 decide).
 *
 * Contrato del socket (Socket.io sobre el mismo servidor HTTP, ruta `/socket.io`):
 *
 * Handshake
 * - Solo se admite el transporte websocket (el polling se rechaza): el navegador siempre manda
 *   `Origin` en el upgrade a websocket, pero no en el GET de polling al mismo origen, y sin `Origin`
 *   no se puede verificar el origen. El cliente tiene que pedir `transports: ['websocket']`.
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
 *   El destino sale del kinesiólogo ACTUAL del turno, tal como se lo relee al difundir, no del que
 *   tenía al operar: si otra operación lo movió entre tanto, el anterior no recibe sus datos (D-16).
 * - `turno:quitado` `{ turnoId }`: a cada kinesiólogo que tuvo el turno según los avisos pendientes y
 *   ya no es el actual (reprogramación entre kinesiólogos): debe sacarlo de su agenda sin recibir sus
 *   datos. Los avisos pendientes del mismo turno se agrupan en una sola difusión.
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
  /**
   * Proyecciones de M4 del turno y el kinesiólogo ACTUAL del turno, tal como se lo releyó; `null` si
   * no existe. El destino del cambio sale de acá y no del aviso, que pudo quedar viejo (D-16).
   */
  turnoParaDifusion(
    turnoId: number,
  ): Promise<{ kinesiologoId: number; secretaria: object; kinesiologo: object } | null>;
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
  /** Tiempo máximo de una difusión (releer el turno y emitir). Por defecto 5 s. */
  tiempoLimiteDifusionMs?: number;
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
  const tiempoLimiteDifusionMs = opciones.tiempoLimiteDifusionMs ?? 5000;

  let dependencias: DependenciasDeDifusion | undefined;
  let io: Server | undefined;
  let revalidacion: NodeJS.Timeout | undefined;
  const vivos = new Set<SocketVivo>();
  // Avisos pendientes agrupados por turno: acotada a los turnos distintos. Por cada turno se guardan los
  // kinesiólogos que alguna vez lo tuvieron según los avisos, para quitárselo a los que ya no lo tienen.
  const pendientes = new Map<number, Set<number>>();
  let drenando: Promise<void> | null = null;
  let revalidando = false;

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
  async function revalidarUno(vivo: SocketVivo): Promise<void> {
    if (!dependencias) return;
    try {
      const sesion = await dependencias.sesionVigente(vivo.token);
      if (!vivos.has(vivo)) return;
      if (!sesion || pasoPendiente(sesion.usuario, sesion.segundoFactorVerificado) !== null) {
        cerrarVivo(vivo, 'revocada');
      }
    } catch (error) {
      // Ante un fallo de la base no se corta a nadie: se reintenta en la próxima vuelta.
      logger.error({ tipo: tipoDeError(error) }, 'no se pudo revalidar una sesión de socket');
    }
  }

  async function revalidar(): Promise<void> {
    // Sin superposición: con la base lenta no se acumulan vueltas.
    if (revalidando) return;
    revalidando = true;
    try {
      for (const vivo of [...vivos]) await revalidarUno(vivo);
    } finally {
      revalidando = false;
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

  /**
   * Relee el turno y lo manda. El cambio va solo a la sala del kinesiólogo ACTUAL del turno y a la de
   * secretaría; a cada otro kinesiólogo que el turno tuvo según los avisos (D-16) solo le llega
   * `turno:quitado`, sin datos del paciente.
   */
  async function difundir(turnoId: number, kinesiologos: Set<number>, cancelada: { valor: boolean }): Promise<void> {
    if (!io || !dependencias) return;
    const proyecciones = await dependencias.turnoParaDifusion(turnoId);
    // Vencido el tiempo límite, esta lectura quedó vieja: una difusión más nueva pudo haber salido ya.
    if (!proyecciones || cancelada.valor) return;
    io.to(SALA_SECRETARIA).emit(EVENTO_CAMBIO, { turno: proyecciones.secretaria });
    io.to(salaDeKinesiologo(proyecciones.kinesiologoId)).emit(EVENTO_CAMBIO, { turno: proyecciones.kinesiologo });
    for (const id of kinesiologos) {
      if (id !== proyecciones.kinesiologoId) io.to(salaDeKinesiologo(id)).emit(EVENTO_QUITADO, { turnoId });
    }
  }

  /** `difundir` con tiempo límite: una relectura colgada no frena los avisos siguientes. */
  async function difundirConLimite(turnoId: number, kinesiologos: Set<number>): Promise<void> {
    let temporizador: NodeJS.Timeout | undefined;
    const cancelada = { valor: false };
    const vencido = new Promise<never>((_, rechazar) => {
      temporizador = setTimeout(() => {
        cancelada.valor = true;
        rechazar(new Error('tiempo agotado'));
      }, tiempoLimiteDifusionMs);
      temporizador.unref();
    });
    try {
      await Promise.race([difundir(turnoId, kinesiologos, cancelada), vencido]);
    } catch (error) {
      logger.error({ tipo: tipoDeError(error) }, 'no se pudo difundir un cambio de turno');
    } finally {
      clearTimeout(temporizador);
    }
  }

  function drenar(): Promise<void> {
    drenando ??= (async () => {
      try {
        // Cede un turno del bucle de eventos: los avisos de la misma operación llegan juntos y se agrupan.
        await Promise.resolve();
        for (;;) {
          const siguiente = pendientes.entries().next();
          if (siguiente.done) return;
          const [turnoId, kinesiologos] = siguiente.value;
          pendientes.delete(turnoId);
          await difundirConLimite(turnoId, kinesiologos);
        }
      } finally {
        drenando = null;
      }
    })();
    return drenando;
  }

  const emisor: EmisorTurnos = {
    turnoCambiado(cambio) {
      const kinesiologos = pendientes.get(cambio.turnoId) ?? new Set<number>();
      kinesiologos.add(cambio.kinesiologoId);
      if (cambio.kinesiologoAnteriorId !== undefined) kinesiologos.add(cambio.kinesiologoAnteriorId);
      pendientes.set(cambio.turnoId, kinesiologos);
      void drenar();
    },
  };

  const revocaciones: AvisoRevocaciones = {
    sesionesRevocadas(criterio: CriterioRevocacion) {
      for (const vivo of [...vivos]) {
        const coincide =
          'hashToken' in criterio
            ? vivo.hashToken === criterio.hashToken
            : vivo.usuarioId === criterio.usuarioId && vivo.sesionId !== criterio.exceptoSesionId;
        if (!coincide) continue;
        // Un fallo con un socket no corta el cierre de los demás.
        try {
          cerrarVivo(vivo, 'revocada');
        } catch (error) {
          logger.error({ tipo: tipoDeError(error) }, 'no se pudo cerrar un socket revocado');
        }
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
        // Solo websocket: el navegador no manda `Origin` en un GET al mismo origen, que es como
        // arranca el polling; en el upgrade a websocket sí lo manda siempre, y es lo que se verifica.
        transports: ['websocket'],
        // Sin CORS: frontend y API comparten origen. Se exige `Origin` exacto en todo handshake.
        allowRequest: (req, devolver) => {
          devolver(null, req.headers.origin === origenPermitido);
        },
      });

      // También en las peticiones que ya traen `sid` y en el paso de polling a websocket, donde
      // `allowRequest` no se vuelve a evaluar.
      io.engine.use((req: IncomingMessage, _res: unknown, siguiente: (error?: Error) => void) => {
        siguiente(req.headers.origin === origenPermitido ? undefined : new Error('origen_no_permitido'));
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
        // La sesión pudo revocarse entre la autenticación y este punto: se revalida una vez ya registrado.
        void revalidarUno(vivo);
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
      while (drenando) await drenando;
    },

    async cerrar() {
      if (revalidacion) clearInterval(revalidacion);
      for (const vivo of vivos) vivo.cancelarVencimiento();
      vivos.clear();
      pendientes.clear();
      const servidor = io;
      io = undefined;
      if (servidor) await servidor.close();
    },
  };
}
