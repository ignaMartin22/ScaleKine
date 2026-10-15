import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, type Routes } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Component } from '@angular/core';
import { estadoDePrueba } from './estados-de-prueba';
import {
  guardaDeCambioDeContrasena,
  guardaDePaso,
  guardaDeRol,
  redirigirDesdeRaiz,
  redirigirSiHaySesion,
} from './guardas';
import type { PasoPendiente, Rol } from './modelo';
import { Sesion } from './sesion';

@Component({ template: '' })
class Vacia {}

const routes: Routes = [
  { path: '', pathMatch: 'full', canActivate: [redirigirDesdeRaiz], children: [] },
  { path: 'ingresar', canActivate: [redirigirSiHaySesion], component: Vacia },
  { path: 'cambiar-contrasena', canActivate: [guardaDeCambioDeContrasena], component: Vacia },
  {
    path: 'activar-segundo-factor',
    canActivate: [guardaDePaso('activar_segundo_factor')],
    component: Vacia,
  },
  {
    path: 'verificar-segundo-factor',
    canActivate: [guardaDePaso('verificar_segundo_factor')],
    component: Vacia,
  },
  { path: 'admin', canActivate: [guardaDeRol(['administrador'])], component: Vacia },
  {
    path: 'secretaria',
    canActivate: [guardaDeRol(['secretaria', 'administrador'])],
    children: [{ path: 'agenda', component: Vacia }],
  },
];

async function navegar(
  ruta: string,
  sesion: { rol: Rol; paso?: PasoPendiente | null } | null,
): Promise<string> {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [provideRouter(routes), provideHttpClient(), provideHttpClientTesting()],
  });
  const servicio = TestBed.inject(Sesion);
  if (sesion) servicio.establecer(estadoDePrueba(sesion.rol, sesion.paso ?? null));
  else servicio.limpiar();

  await (await RouterTestingHarness.create()).navigateByUrl(ruta);
  return TestBed.inject(Router).url;
}

describe('guardas según el paso pendiente (RF-06, RNF-04)', () => {
  it('sin sesión, todo lleva al ingreso', async () => {
    expect(await navegar('/admin', null)).toBe('/ingresar');
    expect(await navegar('/cambiar-contrasena', null)).toBe('/ingresar');
    expect(await navegar('/activar-segundo-factor', null)).toBe('/ingresar');
    expect(await navegar('/verificar-segundo-factor', null)).toBe('/ingresar');
  });

  it('con el cambio de contraseña pendiente, las pantallas de rol llevan a cambiarla', async () => {
    expect(await navegar('/secretaria', { rol: 'secretaria', paso: 'cambiar_contrasena' })).toBe(
      '/cambiar-contrasena',
    );
    expect(await navegar('/', { rol: 'secretaria', paso: 'cambiar_contrasena' })).toBe(
      '/cambiar-contrasena',
    );
    expect(await navegar('/ingresar', { rol: 'secretaria', paso: 'cambiar_contrasena' })).toBe(
      '/cambiar-contrasena',
    );
  });

  it('con la activación pendiente, lleva a activar el segundo factor', async () => {
    expect(await navegar('/admin', { rol: 'administrador', paso: 'activar_segundo_factor' })).toBe(
      '/activar-segundo-factor',
    );
    expect(
      await navegar('/cambiar-contrasena', {
        rol: 'administrador',
        paso: 'activar_segundo_factor',
      }),
    ).toBe('/activar-segundo-factor');
  });

  it('con la verificación pendiente, lleva a verificar el segundo factor', async () => {
    expect(
      await navegar('/admin', { rol: 'administrador', paso: 'verificar_segundo_factor' }),
    ).toBe('/verificar-segundo-factor');
    expect(await navegar('/', { rol: 'administrador', paso: 'verificar_segundo_factor' })).toBe(
      '/verificar-segundo-factor',
    );
  });

  it('las pantallas de paso solo admiten su propio paso', async () => {
    expect(
      await navegar('/activar-segundo-factor', {
        rol: 'administrador',
        paso: 'activar_segundo_factor',
      }),
    ).toBe('/activar-segundo-factor');
    expect(await navegar('/verificar-segundo-factor', { rol: 'administrador' })).toBe(
      '/secretaria/agenda',
    );
    expect(await navegar('/activar-segundo-factor', { rol: 'secretaria' })).toBe(
      '/secretaria/agenda',
    );
    expect(
      await navegar('/activar-segundo-factor', {
        rol: 'administrador',
        paso: 'verificar_segundo_factor',
      }),
    ).toBe('/verificar-segundo-factor');
  });

  it('sin paso pendiente, el cambio de contraseña es voluntario y abre (RF-07)', async () => {
    expect(await navegar('/cambiar-contrasena', { rol: 'kinesiologo' })).toBe(
      '/cambiar-contrasena',
    );
  });

  it('sin paso pendiente, cada rol va a su pantalla', async () => {
    expect(await navegar('/', { rol: 'administrador' })).toBe('/secretaria/agenda');
    expect(await navegar('/ingresar', { rol: 'secretaria' })).toBe('/secretaria/agenda');
  });
});
