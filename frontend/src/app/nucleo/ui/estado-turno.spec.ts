import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ESTADOS, NOMBRE_DEL_ESTADO, type EstadoTurno } from '../agenda/agenda';
import { EstadoDelTurno, ICONO_DEL_ESTADO } from './estado-turno';

@Component({
  imports: [EstadoDelTurno],
  template: `<app-estado-turno [estado]="estado" />`,
})
class Anfitrion {
  estado: EstadoTurno = 'reservado';
}

function pastilla(estado: EstadoTurno): HTMLElement {
  const fixture = TestBed.createComponent(Anfitrion);
  fixture.componentInstance.estado = estado;
  fixture.detectChanges();
  return (fixture.nativeElement as HTMLElement).querySelector('.estado') as HTMLElement;
}

describe('pastilla de estado del turno (RNF-15, DESIGN.md §2.4)', () => {
  it('usa los íconos de la spec visual', () => {
    expect(ICONO_DEL_ESTADO).toEqual({
      reservado: 'reloj',
      en_espera: 'reloj-arena',
      asistio: 'check',
      no_asistio: 'usuario-x',
      anulado: 'prohibido',
    });
  });

  for (const estado of ESTADOS) {
    it(`${estado}: color, ícono y texto`, () => {
      const el = pastilla(estado);
      expect(el.classList.contains(`estado-${estado}`)).toBe(true);
      expect(el.querySelector('svg')).not.toBeNull();
      expect(el.textContent?.trim()).toBe(NOMBRE_DEL_ESTADO[estado]);
    });
  }

  it('el ícono es decorativo: el texto ya dice el estado', () => {
    expect(pastilla('anulado').querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });
});
