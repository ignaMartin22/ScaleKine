import { describe, expect, it } from 'vitest';
import { db, sqlApp } from './base.js';
import { AHORA, crearTurno, crearUsuario } from './fabricas.js';

/** Código de PostgreSQL para "permiso denegado" (también "debe ser dueño de la tabla"). */
const PERMISO_DENEGADO = { code: '42501' };

describe('permisos de scalekine_app (despliegue.md §7, RNF-09)', () => {
  describe('no se borra nada de lo que hay que conservar (RF-39, RF-09)', () => {
    it.each(['Turno', 'TurnoEvento', 'Usuario', 'Paciente', 'Kinesiologo', 'Consultorio'])(
      'no puede ejecutar DELETE sobre %s',
      async (tabla) => {
        await expect(sqlApp.query(`DELETE FROM "${tabla}"`)).rejects.toMatchObject(PERMISO_DENEGADO);
      },
    );

    it('no puede ejecutar TRUNCATE sobre Turno', async () => {
      await expect(sqlApp.query('TRUNCATE "Turno"')).rejects.toMatchObject(PERMISO_DENEGADO);
    });

    it('el turno sigue existiendo después del intento de borrado', async () => {
      const turno = await crearTurno();
      await sqlApp.query('DELETE FROM "Turno"').catch(() => undefined);

      await expect(db.turno.findUnique({ where: { id: turno.id } })).resolves.not.toBeNull();
    });
  });

  describe('no altera el esquema', () => {
    it.each([
      ['ALTER TABLE', 'ALTER TABLE "Turno" ADD COLUMN intrusa integer'],
      ['DROP TABLE', 'DROP TABLE "Turno"'],
      ['CREATE TABLE', 'CREATE TABLE intrusa (id integer)'],
      ['DROP INDEX', 'DROP INDEX "Turno_kinesiologo_franja_activa_key"'],
    ])('rechaza %s', async (_nombre, sentencia) => {
      await expect(sqlApp.query(sentencia)).rejects.toMatchObject(PERMISO_DENEGADO);
    });

    it('no puede leer ni escribir el historial de migraciones', async () => {
      await expect(sqlApp.query('SELECT * FROM _prisma_migrations')).rejects.toMatchObject(PERMISO_DENEGADO);
    });
  });

  describe('lo que sí necesita', () => {
    it('lee, inserta y actualiza turnos', async () => {
      const turno = await crearTurno();
      const actualizado = await db.turno.update({ where: { id: turno.id }, data: { estado: 'en_espera', llegadaEn: AHORA } });

      expect(actualizado.estado).toBe('en_espera');
    });

    it('borra sesiones, que son datos efímeros', async () => {
      const usuario = await crearUsuario();
      await db.sesion.create({
        data: { hashToken: 'hash-ficticio', usuarioId: usuario.id, creadaEn: AHORA, venceEn: AHORA },
      });

      await expect(db.sesion.deleteMany({ where: { usuarioId: usuario.id } })).resolves.toEqual({ count: 1 });
    });

    it('borra entradas vencidas del límite de intentos', async () => {
      await sqlApp.query(`INSERT INTO limite_intentos (key, points, expire) VALUES ('ip-ficticia', 1, 0)`);

      const { rowCount } = await sqlApp.query('DELETE FROM limite_intentos WHERE expire < 1');
      expect(rowCount).toBe(1);
    });
  });
});
