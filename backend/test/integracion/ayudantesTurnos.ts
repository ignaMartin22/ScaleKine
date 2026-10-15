import { db } from './base.js';

/** Dobles de la base para probar atomicidad y carreras del servicio de turnos (compartidos entre archivos). */

/** Envuelve cada transacción de `db` con `envolver(tx)`, para interceptar las operaciones del servicio. */
const baseConTransaccionEnvuelta = (envolver: (tx: object) => object): typeof db =>
  new Proxy(db, {
    get(destino, propiedad, receptor) {
      if (propiedad === '$transaction') {
        return (fn: (tx: unknown) => Promise<unknown>) => db.$transaction((tx) => fn(envolver(tx)));
      }
      return Reflect.get(destino, propiedad, receptor);
    },
  });

/** Base cuyo `TurnoEvento.create` falla: sirve para probar que turno y evento son una sola transacción. */
export const baseConEventoRoto = (): typeof db =>
  baseConTransaccionEnvuelta(
    (tx) =>
      new Proxy(tx, {
        get: (t, p, r) =>
          p === 'turnoEvento'
            ? { ...Reflect.get(t, p, r), create: () => Promise.reject(new Error('fallo simulado del evento')) }
            : Reflect.get(t, p, r),
      }),
  );

/**
 * Base con una barrera: dos transacciones leen el turno (`findUnique`) y ninguna sigue hasta que las
 * dos leyeron, de modo que la carrera es determinista y no depende de la suerte del planificador.
 */
export function baseConLecturaSincronizada(): typeof db {
  let leyeron = 0;
  let soltar!: () => void;
  const ambosLeyeron = new Promise<void>((r) => (soltar = r));
  return baseConTransaccionEnvuelta(
    (tx) =>
      new Proxy(tx, {
        get(destino, propiedad, receptor) {
          if (propiedad !== 'turno') return Reflect.get(destino, propiedad, receptor);
          const turno = Reflect.get(destino, propiedad, receptor) as { findUnique: (a: unknown) => Promise<unknown> };
          return new Proxy(turno, {
            get(t, p, r) {
              if (p !== 'findUnique') return Reflect.get(t, p, r);
              return async (args: unknown) => {
                const fila = await t.findUnique(args);
                if (++leyeron === 2) soltar();
                await ambosLeyeron;
                return fila;
              };
            },
          });
        },
      }),
  );
}
