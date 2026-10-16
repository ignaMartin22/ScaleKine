import {
  aCentavos,
  deCentavos,
  formatearPesos,
  montoAbonado,
  recaudadoDe,
  sumarMontos,
} from './montos';

describe('Montos de coseguro (RF-27, RF-48)', () => {
  it('pasa a centavos enteros y vuelve, con uno, dos o ningún decimal', () => {
    expect(aCentavos('1500.50')).toBe(150050);
    expect(aCentavos('1500.5')).toBe(150050);
    expect(aCentavos('1500')).toBe(150000);
    expect(aCentavos('0.07')).toBe(7);
    expect(deCentavos(150050)).toBe('1500.50');
    expect(deCentavos(7)).toBe('0.07');
    expect(deCentavos(0)).toBe('0.00');
  });

  it('suma en centavos: 0.10 + 0.20 es exactamente 0.30', () => {
    expect(sumarMontos(['0.10', '0.20'])).toBe('0.30');
    // Con coma flotante 0.1 + 0.2 da 0.30000000000000004.
    expect(sumarMontos(['0.10', '0.20', '0.30', '0.40'])).toBe('1.00');
    expect(sumarMontos(['1234567.89', '0.11'])).toBe('1234568.00');
  });

  it('los turnos sin abonar no suman, y sin nada el total es cero', () => {
    expect(sumarMontos([null, '10.00', null])).toBe('10.00');
    expect(sumarMontos([])).toBe('0.00');
  });

  it('el recaudado no cuenta los turnos anulados', () => {
    expect(
      recaudadoDe([
        { estado: 'asistio', coseguroAbonado: '1500.50' },
        { estado: 'anulado', coseguroAbonado: '999.00' },
        { estado: 'reservado', coseguroAbonado: null },
        { estado: 'en_espera', coseguroAbonado: '0.10' },
      ]),
    ).toBe('1500.60');
  });

  it('formatea en pesos con puntos de miles y coma decimal', () => {
    expect(formatearPesos('0.30')).toBe('$ 0,30');
    expect(formatearPesos('1500.50')).toBe('$ 1.500,50');
    expect(formatearPesos('1234567.00')).toBe('$ 1.234.567,00');
    expect(montoAbonado(null)).toBe('Sin abonar');
    expect(montoAbonado('300.50')).toBe('$ 300,50');
  });
});
