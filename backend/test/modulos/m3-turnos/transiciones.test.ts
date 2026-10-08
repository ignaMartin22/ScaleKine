import { describe, expect, it } from 'vitest';
import { ErrorNegocio } from '../../../src/comun/errores.js';
import {
  ESTADOS,
  TRANSICIONES,
  accionesDisponibles,
  motivoDeRechazo,
  validarTransicion,
  type EstadoTurno,
  type Rol,
} from '../../../src/modulos/m3-turnos/transiciones.js';

const FILAS = [
  'reservado>en_espera',
  'en_espera>asistio',
  'reservado>no_asistio',
  'reservado>anulado',
].sort();

function capturar(accion: () => unknown): ErrorNegocio {
  try {
    accion();
  } catch (error) {
    expect(error).toBeInstanceOf(ErrorNegocio);
    return error as ErrorNegocio;
  }
  throw new Error('Se esperaba un ErrorNegocio');
}

describe('tabla del flujo normal (RF-29)', () => {
  it('reconoce exactamente cinco estados y cuatro filas', () => {
    expect(ESTADOS).toHaveLength(5);
    expect(TRANSICIONES.map((t) => `${t.desde}>${t.hacia}`).sort()).toEqual(FILAS);
  });

  it.each<Rol>(['administrador', 'secretaria'])(
    '%s: de 5 × 5 combinaciones se aceptan exactamente las cuatro filas',
    (rol) => {
      const aceptadas = ESTADOS.flatMap((desde) =>
        ESTADOS.filter((hacia) => motivoDeRechazo(rol, desde, hacia) === null).map(
          (hacia) => `${desde}>${hacia}`,
        ),
      );
      expect(aceptadas.sort()).toEqual(FILAS);
    },
  );

  it('kinesiólogo: no se acepta ninguna de las 25 combinaciones', () => {
    for (const desde of ESTADOS) {
      for (const hacia of ESTADOS) {
        expect(motivoDeRechazo('kinesiologo', desde, hacia)).not.toBeNull();
      }
    }
  });
});

describe('acciones disponibles (RF-34)', () => {
  it.each<Rol>(['administrador', 'secretaria'])(
    '%s ve las acciones del estado más la corrección',
    (rol) => {
      const rotulos = (estado: EstadoTurno) =>
        accionesDisponibles(estado, rol).transiciones.map((t) => t.accion);

      expect(rotulos('reservado')).toEqual(['Llegó', 'No asistió', 'Anular']);
      expect(rotulos('en_espera')).toEqual(['Asistió']);
      for (const cerrado of ['asistio', 'no_asistio', 'anulado'] as const) {
        expect(rotulos(cerrado)).toEqual([]);
      }
      for (const estado of ESTADOS) {
        expect(accionesDisponibles(estado, rol).puedeCorregir).toBe(true);
      }
    },
  );

  it('el kinesiólogo no tiene ninguna acción en ningún estado', () => {
    for (const estado of ESTADOS) {
      expect(accionesDisponibles(estado, 'kinesiologo')).toEqual({
        transiciones: [],
        puedeCorregir: false,
      });
    }
  });
});

describe('rechazos', () => {
  it('devuelve la fila cuando el cambio está permitido', () => {
    expect(validarTransicion('secretaria', 'reservado', 'en_espera').accion).toBe('Llegó');
  });

  it('rechaza un cambio fuera de la tabla con 409 y remite a la corrección', () => {
    const error = capturar(() => validarTransicion('secretaria', 'asistio', 'reservado'));
    expect(error.codigo).toBe('transicion_no_permitida');
    expect(error.estadoHttp).toBe(409);
    expect(error.message).toContain('corrección');
  });

  it('rechaza quedarse en el mismo estado', () => {
    expect(motivoDeRechazo('administrador', 'reservado', 'reservado')).toBe(
      'El turno ya está en ese estado.',
    );
  });

  it('rechaza al kinesiólogo con 403 aunque el cambio esté en la tabla', () => {
    const error = capturar(() => validarTransicion('kinesiologo', 'reservado', 'en_espera'));
    expect(error.codigo).toBe('rol_sin_permiso');
    expect(error.estadoHttp).toBe(403);
  });
});
