import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { crearBaseDeDatos } from '../../src/comun/baseDeDatos.js';
import { urlsDePrueba } from './entorno.js';

const urls = urlsDePrueba();
const OTRA_ZONA = 'America/Argentina/Buenos_Aires';

/**
 * La conexión de la aplicación fija timezone=UTC por sí misma (RF-12): no depende de la
 * configuración del servidor ni de DATABASE_URL. Para que la prueba sirva, se fuerza otra zona como
 * valor por defecto de la sesión mediante PGOPTIONS, que node-postgres usa cuando la configuración
 * explícita no define `options`. Si el cliente no fijara la zona, heredaría OTRA_ZONA.
 */
describe('zona horaria de la conexión (RF-12)', () => {
  let opcionesOriginales: string | undefined;

  beforeEach(() => {
    opcionesOriginales = process.env.PGOPTIONS;
    process.env.PGOPTIONS = `-c timezone=${OTRA_ZONA}`;
  });

  afterEach(() => {
    if (opcionesOriginales === undefined) delete process.env.PGOPTIONS;
    else process.env.PGOPTIONS = opcionesOriginales;
  });

  it('una conexión común hereda la zona forzada (la prueba es válida)', async () => {
    const sql = new pg.Client({ connectionString: urls.app });
    await sql.connect();
    try {
      const { rows } = await sql.query<{ TimeZone: string }>('SHOW timezone');
      expect(rows[0]?.TimeZone).toBe(OTRA_ZONA);
    } finally {
      await sql.end();
    }
  });

  it('el cliente de crearBaseDeDatos trabaja en UTC aunque la sesión use otra zona', async () => {
    const db = crearBaseDeDatos(urls.app);
    try {
      const filas = await db.$queryRaw<{ TimeZone: string }[]>`SHOW timezone`;
      expect(filas[0]?.TimeZone).toBe('UTC');
    } finally {
      await db.$disconnect();
    }
  });
});
