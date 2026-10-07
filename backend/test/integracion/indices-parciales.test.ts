import { describe, expect, it } from 'vitest';
import { sqlApp } from './base.js';
import { crearKinesiologo, crearPaciente, crearTurno } from './fabricas.js';

/** Prisma traduce la violación de un índice único al código P2002. */
const VIOLACION_DE_UNICIDAD = { code: 'P2002' };

describe('índices únicos parciales de Turno (plan.md §2.3)', () => {
  it('existen en la base', async () => {
    const { rows } = await sqlApp.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'Turno' AND indexname LIKE '%franja_activa%'`,
    );

    expect(rows.map((r) => r.indexname).sort()).toEqual([
      'Turno_kinesiologo_franja_activa_key',
      'Turno_paciente_franja_activa_key',
    ]);
    for (const { indexdef } of rows) {
      expect(indexdef).toContain('UNIQUE');
      expect(indexdef).toMatch(/WHERE .*reservado.*en_espera/);
    }
  });

  describe('mismo kinesiólogo (RF-24)', () => {
    it('rechaza un segundo turno activo en la misma franja', async () => {
      const kinesiologo = await crearKinesiologo();
      await crearTurno({ kinesiologoId: kinesiologo.id });

      await expect(crearTurno({ kinesiologoId: kinesiologo.id })).rejects.toMatchObject(VIOLACION_DE_UNICIDAD);
    });

    it('rechaza un turno reservado sobre otro en espera en la misma franja', async () => {
      const kinesiologo = await crearKinesiologo();
      await crearTurno({ kinesiologoId: kinesiologo.id, estado: 'en_espera' });

      await expect(crearTurno({ kinesiologoId: kinesiologo.id })).rejects.toMatchObject(VIOLACION_DE_UNICIDAD);
    });

    it('acepta otro turno del mismo kinesiólogo en otra franja o en otra fecha', async () => {
      const kinesiologo = await crearKinesiologo();
      await crearTurno({ kinesiologoId: kinesiologo.id });

      await expect(crearTurno({ kinesiologoId: kinesiologo.id, horaInicio: '08:45' })).resolves.toBeDefined();
      await expect(crearTurno({ kinesiologoId: kinesiologo.id, fecha: '2026-10-13' })).resolves.toBeDefined();
    });
  });

  describe('mismo paciente (RF-25)', () => {
    it('rechaza un segundo turno activo en la misma franja, aunque sea con otro kinesiólogo', async () => {
      const paciente = await crearPaciente();
      await crearTurno({ pacienteId: paciente.id });

      await expect(crearTurno({ pacienteId: paciente.id })).rejects.toMatchObject(VIOLACION_DE_UNICIDAD);
    });
  });

  it('acepta dos kinesiólogos distintos en la misma franja con pacientes distintos', async () => {
    const primero = await crearTurno();
    const segundo = await crearTurno();

    expect(primero.kinesiologoId).not.toBe(segundo.kinesiologoId);
    expect(primero.horaInicio).toBe(segundo.horaInicio);
    expect(primero.fecha).toEqual(segundo.fecha);
  });

  it.each(['asistio', 'no_asistio', 'anulado'] as const)(
    'un turno %s no ocupa la franja (RF-38)',
    async (estadoCerrado) => {
      const kinesiologo = await crearKinesiologo();
      const paciente = await crearPaciente();
      await crearTurno({ kinesiologoId: kinesiologo.id, pacienteId: paciente.id, estado: estadoCerrado });

      await expect(crearTurno({ kinesiologoId: kinesiologo.id, pacienteId: paciente.id })).resolves.toBeDefined();
    },
  );
});
