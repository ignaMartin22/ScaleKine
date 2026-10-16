import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ICONOS, Icono, type NombreDeIcono } from './icono';

@Component({
  imports: [Icono],
  template: `<app-icono [nombre]="nombre" [tamano]="tamano" [etiqueta]="etiqueta" />`,
})
class Anfitrion {
  nombre: NombreDeIcono = 'agenda';
  tamano: 20 | 16 = 20;
  etiqueta: string | undefined = undefined;
}

function montar(cambios: Partial<Anfitrion> = {}): SVGSVGElement {
  const fixture = TestBed.createComponent(Anfitrion);
  Object.assign(fixture.componentInstance, cambios);
  fixture.detectChanges();
  return (fixture.nativeElement as HTMLElement).querySelector('svg') as SVGSVGElement;
}

describe('Icono (RNF-15, DESIGN.md §5)', () => {
  it('trae los 30 íconos de la tabla de DESIGN.md §5', () => {
    expect(Object.keys(ICONOS).sort()).toEqual(
      [
        'agenda',
        'asignar',
        'pacientes',
        'consultorio',
        'kinesiologos',
        'cuentas',
        'contrasena',
        'salir',
        'buscar',
        'actualizar',
        'llego',
        'check',
        'usuario-x',
        'prohibido',
        'lapiz',
        'calendario-reloj',
        'ticket',
        'monedas',
        'reloj',
        'reloj-arena',
        'alerta',
        'info',
        'sin-conexion',
        'cerrar',
        'menu',
        'volver',
        'escudo',
        'usuario-baja',
        'usuario',
        'siguiente',
      ].sort(),
    );
  });

  it('dibuja cada ícono con al menos una forma', () => {
    for (const nombre of Object.keys(ICONOS) as NombreDeIcono[]) {
      const svg = montar({ nombre });
      expect(svg.querySelectorAll('path, circle, rect, line').length, nombre).toBeGreaterThan(0);
      TestBed.resetTestingModule();
    }
  });

  it('es decorativo por defecto y toma el color del texto', () => {
    const svg = montar();
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('role')).toBeNull();
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(svg.getAttribute('stroke-width')).toBe('2');
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
  });

  it('mide 20 px, o 16 px en pastillas', () => {
    expect(montar().getAttribute('width')).toBe('20');
    TestBed.resetTestingModule();
    const chico = montar({ tamano: 16 });
    expect(chico.getAttribute('width')).toBe('16');
    expect(chico.getAttribute('height')).toBe('16');
  });

  it('con etiqueta se anuncia como imagen con nombre', () => {
    const svg = montar({ etiqueta: 'Sin conexión' });
    expect(svg.getAttribute('aria-hidden')).toBeNull();
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe('Sin conexión');
  });
});
