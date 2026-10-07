import type { Routes } from '@angular/router';
import { Disposicion } from './disposicion/disposicion';
import { guardaDeRol, redirigirDesdeRaiz, redirigirSiHaySesion } from './nucleo/sesion/guardas';
import { Ingresar } from './paginas/ingresar';
import { InicioAdmin } from './paginas/inicio-admin';
import { InicioKinesiologo } from './paginas/inicio-kinesiologo';
import { InicioSecretaria } from './paginas/inicio-secretaria';
import { NoEncontrada } from './paginas/no-encontrada';

/**
 * Rutas por rol (RF-01). El administrador también entra a la pantalla de secretaría, porque puede
 * hacer todo lo que ella hace (spec §2, D-18).
 */
export const routes: Routes = [
  { path: '', pathMatch: 'full', canActivate: [redirigirDesdeRaiz], children: [] },
  { path: 'ingresar', title: 'Ingresar · ScaleKine', canActivate: [redirigirSiHaySesion], component: Ingresar },
  {
    path: 'admin',
    title: 'Administración · ScaleKine',
    canActivate: [guardaDeRol(['administrador'])],
    component: Disposicion,
    data: { seccion: 'Administración' },
    children: [{ path: '', component: InicioAdmin }],
  },
  {
    path: 'secretaria',
    title: 'Agenda · ScaleKine',
    canActivate: [guardaDeRol(['secretaria', 'administrador'])],
    component: Disposicion,
    data: { seccion: 'Agenda' },
    children: [{ path: '', component: InicioSecretaria }],
  },
  {
    path: 'kinesiologo',
    title: 'Mi agenda · ScaleKine',
    canActivate: [guardaDeRol(['kinesiologo'])],
    component: Disposicion,
    data: { seccion: 'Mi agenda' },
    children: [{ path: '', component: InicioKinesiologo }],
  },
  { path: '**', title: 'Página no encontrada · ScaleKine', component: NoEncontrada },
];
