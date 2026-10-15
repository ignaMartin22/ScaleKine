import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../app.routes';
import type { PasoPendiente, Rol } from '../nucleo/sesion/modelo';
import { estadoDePrueba } from '../nucleo/sesion/estados-de-prueba';
import { Sesion } from '../nucleo/sesion/sesion';

async function abrir(ruta: string, rol: Rol, paso: PasoPendiente | null = null) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter(routes, withComponentInputBinding()),
      provideHttpClient(),
      provideHttpClientTesting(),
    ],
  });
  TestBed.inject(Sesion).establecer(estadoDePrueba(rol, paso));
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(ruta);
  harness.detectChanges();
  const servidor = TestBed.inject(HttpTestingController);
  return { raiz: harness.fixture.nativeElement as HTMLElement, servidor, harness };
}

const menu = (raiz: HTMLElement) =>
  Array.from(raiz.querySelectorAll('nav[aria-label="Menú principal"] a')).map((a) =>
    a.textContent?.trim(),
  );

const nombreEnLaBarra = (raiz: HTMLElement) =>
  raiz.querySelector('aside > .consultorio')?.textContent?.trim();

describe('barra lateral (RNF-15, DESIGN.md §6, RF-13)', () => {
  it('secretaría: Agenda, Asignar turno, Pacientes y Consultorio, con un ícono cada uno', async () => {
    const { raiz } = await abrir('/secretaria', 'secretaria');
    expect(menu(raiz)).toEqual(['Agenda', 'Asignar turno', 'Pacientes', 'Consultorio']);
    expect(raiz.querySelectorAll('nav[aria-label="Menú principal"] a svg').length).toBe(4);
  });

  it('administrador: suma Kinesiólogos y Cuentas', async () => {
    const { raiz } = await abrir('/admin', 'administrador');
    expect(menu(raiz)).toEqual([
      'Agenda',
      'Asignar turno',
      'Pacientes',
      'Consultorio',
      'Kinesiólogos',
      'Cuentas',
    ]);
  });

  it('kinesiólogo: solo Mi agenda, y no consulta el consultorio (D-16)', async () => {
    const { raiz, servidor } = await abrir('/kinesiologo', 'kinesiologo');
    expect(menu(raiz)).toEqual(['Mi agenda']);
    servidor.expectNone('/api/consultorio');
    expect(nombreEnLaBarra(raiz)).toBe('ScaleKine');
  });

  it('muestra el nombre del consultorio que informa la API', async () => {
    const { raiz, servidor, harness } = await abrir('/secretaria', 'secretaria');
    servidor.expectOne('/api/consultorio').flush({
      consultorio: {
        nombre: 'Consultorio de Prueba',
        direccion: 'Calle 1',
        telefono: '1100000000',
      },
    });
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(nombreEnLaBarra(raiz)).toBe('Consultorio de Prueba');
  });

  it('si el consultorio no se puede leer, muestra la marca', async () => {
    const { raiz, servidor, harness } = await abrir('/secretaria', 'secretaria');
    servidor
      .expectOne('/api/consultorio')
      .flush({ error: { codigo: 'x', mensaje: 'x' } }, { status: 500, statusText: 'Error' });
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(nombreEnLaBarra(raiz)).toBe('ScaleKine');
  });

  it('marca el ítem de la pantalla actual', async () => {
    const { raiz } = await abrir('/secretaria/pacientes', 'secretaria');
    const activo = raiz.querySelector('nav[aria-label="Menú principal"] a[aria-current="page"]');
    expect(activo?.textContent?.trim()).toBe('Pacientes');
  });

  it('el pie lleva usuario y rol, cambiar contraseña, cerrar sesión y la marca', async () => {
    const { raiz } = await abrir('/secretaria', 'secretaria');
    const pie = raiz.querySelector('.pie') as HTMLElement;
    expect(pie.textContent).toContain('usuario.ficticio · Secretaría');
    expect(pie.textContent).toContain('Cambiar contraseña');
    expect(pie.textContent).toContain('Cerrar sesión');
    expect(pie.querySelector('.marca')?.textContent).toBe('ScaleKine');
  });

  it('el botón de menú de la vista angosta abre y cierra la barra', async () => {
    const { raiz, harness } = await abrir('/secretaria', 'secretaria');
    const boton = raiz.querySelector('.barra-superior button') as HTMLButtonElement;
    const barra = raiz.querySelector('aside') as HTMLElement;
    expect(boton.getAttribute('aria-expanded')).toBe('false');
    boton.click();
    harness.detectChanges();
    expect(boton.getAttribute('aria-expanded')).toBe('true');
    expect(barra.classList.contains('abierta')).toBe(true);
    boton.click();
    harness.detectChanges();
    expect(barra.classList.contains('abierta')).toBe(false);
  });

  it('con un paso pendiente es una tarjeta centrada, sin barra lateral ni consulta al consultorio', async () => {
    const { raiz, servidor } = await abrir(
      '/cambiar-contrasena',
      'secretaria',
      'cambiar_contrasena',
    );
    expect(raiz.querySelector('aside')).toBeNull();
    expect(raiz.querySelector('.marca-tarjeta')?.textContent).toBe('ScaleKine');
    expect(raiz.querySelector('.pie-tarjeta')?.textContent).toContain('Cerrar sesión');
    servidor.expectNone('/api/consultorio');
  });
});
