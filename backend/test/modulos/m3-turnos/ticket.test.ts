import { describe, expect, it } from 'vitest';
import { formatearFechaHora, textoDelQr } from '../../../src/modulos/m3-turnos/ticket.js';

describe('formato del ticket (RF-28)', () => {
  it('formatea fecha y hora en castellano, con el día de la semana', () => {
    expect(formatearFechaHora('2026-10-19', '08:00')).toBe('lunes 19/10/2026, 08:00');
    expect(formatearFechaHora('2026-10-21', '13:30')).toBe('miércoles 21/10/2026, 13:30');
    expect(formatearFechaHora('2026-10-24', '09:15')).toBe('sábado 24/10/2026, 09:15');
    expect(formatearFechaHora('2026-10-25', '09:15')).toBe('domingo 25/10/2026, 09:15');
  });

  it('el texto del QR lleva número de turno, paciente, kinesiólogo, fecha y hora', () => {
    const texto = textoDelQr({
      numeroTurno: 123,
      paciente: 'Ñandú Pérez',
      kinesiologo: 'Zoé Gómez',
      fecha: '2026-10-19',
      horaInicio: '08:00',
    });
    expect(texto).toBe(
      [
        'Turno N° 123',
        'Paciente: Ñandú Pérez',
        'Kinesiólogo: Zoé Gómez',
        'Fecha y hora: lunes 19/10/2026, 08:00',
      ].join('\n'),
    );
  });
});
