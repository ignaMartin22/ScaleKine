import type { BaseDeDatos } from '../../comun/baseDeDatos.js';

/**
 * Límite de intentos fallidos (RNF-02), por cuenta y por dirección.
 *
 * Implementación propia y no `rate-limiter-flexible`: esa librería toma la hora con `Date.now()`
 * adentro, y el invariante del reloj inyectable (plan.md §3 M1) exige que toda lógica que depende de
 * la hora reciba el instante por parámetro. La tabla `limite_intentos` conserva el formato de esa
 * librería (`key`, `points`, `expire` en milisegundos desde la época).
 *
 * Toda sentencia es una sola: el incremento se resuelve dentro de PostgreSQL, que toma el lock de la
 * fila, así los intentos concurrentes no se pisan. El SQL crudo usa solo los tagged templates de
 * Prisma, que envían los valores como parámetros.
 */

/** Fallos seguidos de una cuenta que la bloquean (RNF-02). */
export const FALLOS_PARA_BLOQUEAR_CUENTA = 5;

/** Duración del primer bloqueo de una cuenta; cada bloqueo consecutivo la duplica (RNF-02). */
export const MINUTOS_BLOQUEO_CUENTA_BASE = 15;

/** Tope del exponente, solo para que la fecha de bloqueo nunca desborde; en la práctica no se alcanza. */
const TOPE_EXPONENTE_BLOQUEO = 20;

/** Fallos desde una misma dirección, dentro de la ventana, que la bloquean (RNF-02). */
export const FALLOS_PARA_BLOQUEAR_DIRECCION = 20;

/** Ventana fija de conteo por dirección: empieza con el primer fallo (RNF-02). */
export const MINUTOS_VENTANA_DIRECCION = 15;

/** Duración del bloqueo de una dirección, desde el fallo que alcanza el umbral (RNF-02). */
export const MINUTOS_BLOQUEO_DIRECCION = 15;

const MS_POR_MINUTO = 60 * 1000;

/** Campos del límite por cuenta sin fallos ni bloqueo (RNF-02). Los aplican un ingreso o un cambio de contraseña correctos, y el restablecimiento (RF-08, T-13 y `restablecer-admin` de T-10). */
export const SIN_BLOQUEO = { ingresosFallidos: 0, bloqueadoHasta: null, bloqueosConsecutivos: 0 } as const;

/** Una cuenta está bloqueada mientras `bloqueadoHasta` es posterior al instante actual (RNF-02). */
export function cuentaBloqueada(bloqueadoHasta: Date | null, ahora: Date): boolean {
  return bloqueadoHasta !== null && bloqueadoHasta.getTime() > ahora.getTime();
}

const claveDeDireccion = (ip: string) => `direccion:${ip}`;

export function crearLimiteIntentos({ db }: { db: BaseDeDatos }) {
  return {
    /** La dirección está bloqueada si llegó al umbral y la ventana todavía no venció (RNF-02). */
    async direccionBloqueada(ip: string, ahora: Date): Promise<boolean> {
      const ahoraMs = ahora.getTime();
      const filas = await db.$queryRaw<{ bloqueada: boolean }[]>`
        SELECT TRUE AS bloqueada FROM limite_intentos
        WHERE key = ${claveDeDireccion(ip)}
          AND points >= ${FALLOS_PARA_BLOQUEAR_DIRECCION}::int
          AND expire > ${ahoraMs}::bigint`;
      return filas.length > 0;
    },

    /**
     * Suma un fallo a la dirección en una ventana fija de 15 minutos que empieza con el primer fallo.
     * Al llegar al umbral dentro de la ventana, `expire` pasa a ser el fin del bloqueo; al vencer,
     * la dirección vuelve a empezar de cero. Antes se borran las filas vencidas, para no conservar
     * direcciones sin necesidad (minimización de datos).
     */
    async registrarFalloDireccion(ip: string, ahora: Date): Promise<void> {
      const ahoraMs = ahora.getTime();
      const finVentana = ahoraMs + MINUTOS_VENTANA_DIRECCION * MS_POR_MINUTO;
      const finBloqueo = ahoraMs + MINUTOS_BLOQUEO_DIRECCION * MS_POR_MINUTO;
      await db.$executeRaw`DELETE FROM limite_intentos WHERE expire <= ${ahoraMs}::bigint`;
      await db.$executeRaw`
        INSERT INTO limite_intentos (key, points, expire)
        VALUES (${claveDeDireccion(ip)}, 1, ${finVentana}::bigint)
        ON CONFLICT (key) DO UPDATE SET
          points = CASE
            WHEN limite_intentos.expire IS NULL OR limite_intentos.expire <= ${ahoraMs}::bigint THEN 1
            ELSE limite_intentos.points + 1
          END,
          expire = CASE
            WHEN limite_intentos.expire IS NULL OR limite_intentos.expire <= ${ahoraMs}::bigint
              THEN ${finVentana}::bigint
            WHEN limite_intentos.points + 1 = ${FALLOS_PARA_BLOQUEAR_DIRECCION}::int
              THEN ${finBloqueo}::bigint
            ELSE limite_intentos.expire
          END`;
    },

    /**
     * Suma un fallo a la cuenta, en una sola sentencia: PostgreSQL evalúa todo el `SET` con la fila
     * vieja y retiene su lock. Al quinto fallo seguido se bloquea por 15 min × 2^bloqueos previos y
     * el contador vuelve a 0. Una cuenta bloqueada no cuenta intentos: el `WHERE` la excluye, así un
     * intento concurrente que llega justo después del bloqueo no lo extiende.
     *
     * Con `null` (cuenta inexistente, o rechazo que no se le imputa a la cuenta) ejecuta la misma
     * sentencia con un `id` que no existe: todo rechazo hace los mismos viajes a la base y el tiempo
     * de respuesta no delata si la cuenta existe (RF-02).
     */
    async registrarFalloCuenta(usuarioId: number | null, ahora: Date): Promise<void> {
      await db.$executeRaw`
        UPDATE "Usuario" SET
          "ingresosFallidos" = CASE
            WHEN "ingresosFallidos" + 1 >= ${FALLOS_PARA_BLOQUEAR_CUENTA}::int THEN 0
            ELSE "ingresosFallidos" + 1
          END,
          "bloqueosConsecutivos" = CASE
            WHEN "ingresosFallidos" + 1 >= ${FALLOS_PARA_BLOQUEAR_CUENTA}::int THEN "bloqueosConsecutivos" + 1
            ELSE "bloqueosConsecutivos"
          END,
          "bloqueadoHasta" = CASE
            WHEN "ingresosFallidos" + 1 >= ${FALLOS_PARA_BLOQUEAR_CUENTA}::int
              THEN ${ahora}::timestamptz
                + make_interval(mins => ${MINUTOS_BLOQUEO_CUENTA_BASE}::int)
                  * power(2, LEAST("bloqueosConsecutivos", ${TOPE_EXPONENTE_BLOQUEO}::int))
            ELSE "bloqueadoHasta"
          END
        WHERE id = ${usuarioId ?? 0}::int
          AND ("bloqueadoHasta" IS NULL OR "bloqueadoHasta" <= ${ahora}::timestamptz)`;
    },
  };
}

export type LimiteIntentos = ReturnType<typeof crearLimiteIntentos>;
