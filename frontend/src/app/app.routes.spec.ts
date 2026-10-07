import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from './app.routes';
import type { Rol } from './nucleo/sesion/modelo';
import { Sesion } from './nucleo/sesion/sesion';

async function navegar(ruta: string, rol: Rol | null): Promise<{ url: string; texto: string }> {
  TestBed.configureTestingModule({
    providers: [provideRouter(routes, withComponentInputBinding()), provideHttpClient(), provideHttpClientTesting()],
  });
  // La consulta al backend se prueba en sesion.spec.ts; acá se fija el resultado.
  const sesion = TestBed.inject(Sesion);
  if (rol) sesion.establecer({ nombreUsuario: 'usuario.ficticio', rol });
  else sesion.limpiar();

  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(ruta);
  harness.detectChanges();

  return { url: TestBed.inject(Router).url, texto: harness.routeNativeElement?.textContent ?? '' };
}

describe('rutas por rol (RF-01)', () => {
  it('sin sesión, cualquier pantalla con sesión lleva al ingreso', async () => {
    expect((await navegar('/secretaria', null)).url).toBe('/ingresar');
  });

  it('la raíz lleva al inicio del rol', async () => {
    expect((await navegar('/', 'kinesiologo')).url).toBe('/kinesiologo');
  });

  it('cada rol entra a su pantalla', async () => {
    const { url, texto } = await navegar('/kinesiologo', 'kinesiologo');

    expect(url).toBe('/kinesiologo');
    expect(texto).toContain('Mi agenda');
  });

  it('un rol que pide otra pantalla vuelve a la suya', async () => {
    expect((await navegar('/admin', 'secretaria')).url).toBe('/secretaria');
  });

  it('el administrador también entra a la pantalla de secretaría (D-18)', async () => {
    expect((await navegar('/secretaria', 'administrador')).url).toBe('/secretaria');
  });

  it('el kinesiólogo no entra a la agenda de secretaría', async () => {
    expect((await navegar('/secretaria', 'kinesiologo')).url).toBe('/kinesiologo');
  });

  it('con sesión, el ingreso lleva directo a la pantalla del rol', async () => {
    expect((await navegar('/ingresar', 'administrador')).url).toBe('/admin');
  });

  it('el encabezado muestra la sección y el usuario', async () => {
    const { texto } = await navegar('/admin', 'administrador');

    expect(texto).toContain('usuario.ficticio · Administración');
  });
});
