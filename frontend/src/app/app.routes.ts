import type { Routes } from '@angular/router';
import { Disposicion } from './disposicion/disposicion';
import {
  guardaDeCambioDeContrasena,
  guardaDePaso,
  guardaDeRol,
  redirigirDesdeRaiz,
  redirigirSiHaySesion,
} from './nucleo/sesion/guardas';
import { ActivarSegundoFactor } from './paginas/activar-segundo-factor';
import { CambiarContrasena } from './paginas/cambiar-contrasena';
import { ConsultorioPagina } from './paginas/consultorio';
import { AgendaSecretaria } from './paginas/agenda-secretaria';
import { AsignarTurno } from './paginas/asignar-turno';
import { CuentasAdmin } from './paginas/cuentas-admin';
import { Ingresar } from './paginas/ingresar';
import { InicioAdmin } from './paginas/inicio-admin';
import { InicioKinesiologo } from './paginas/inicio-kinesiologo';
import { InicioSecretaria } from './paginas/inicio-secretaria';
import { KinesiologosAdmin } from './paginas/kinesiologos-admin';
import { NoEncontrada } from './paginas/no-encontrada';
import { PacienteFicha } from './paginas/paciente-ficha';
import { PacientesPagina } from './paginas/pacientes';
import { VerificarSegundoFactor } from './paginas/verificar-segundo-factor';

/**
 * Rutas por rol (RF-01). El administrador también entra a la pantalla de secretaría, porque puede
 * hacer todo lo que ella hace (spec §2, D-18). Las pantallas de los pasos pendientes (cambio
 * obligatorio de contraseña, activación y verificación del segundo factor) siguen lo que informa
 * el backend.
 */
export const routes: Routes = [
  { path: '', pathMatch: 'full', canActivate: [redirigirDesdeRaiz], children: [] },
  {
    path: 'ingresar',
    title: 'Ingresar · ScaleKine',
    canActivate: [redirigirSiHaySesion],
    component: Ingresar,
  },
  {
    path: 'cambiar-contrasena',
    title: 'Cambiar contraseña · ScaleKine',
    canActivate: [guardaDeCambioDeContrasena],
    component: Disposicion,
    data: { seccion: 'Cambiar contraseña' },
    children: [{ path: '', component: CambiarContrasena }],
  },
  {
    path: 'activar-segundo-factor',
    title: 'Activar el segundo factor · ScaleKine',
    canActivate: [guardaDePaso('activar_segundo_factor')],
    component: Disposicion,
    data: { seccion: 'Segundo factor' },
    children: [{ path: '', component: ActivarSegundoFactor }],
  },
  {
    path: 'verificar-segundo-factor',
    title: 'Verificar tu identidad · ScaleKine',
    canActivate: [guardaDePaso('verificar_segundo_factor')],
    component: Disposicion,
    data: { seccion: 'Segundo factor' },
    children: [{ path: '', component: VerificarSegundoFactor }],
  },
  {
    path: 'admin',
    title: 'Administración · ScaleKine',
    canActivate: [guardaDeRol(['administrador'])],
    component: Disposicion,
    data: { seccion: 'Administración' },
    children: [
      { path: '', component: InicioAdmin },
      { path: 'cuentas', title: 'Cuentas · ScaleKine', component: CuentasAdmin },
      { path: 'kinesiologos', title: 'Kinesiólogos · ScaleKine', component: KinesiologosAdmin },
    ],
  },
  {
    path: 'secretaria',
    title: 'Agenda · ScaleKine',
    canActivate: [guardaDeRol(['secretaria', 'administrador'])],
    component: Disposicion,
    data: { seccion: 'Agenda' },
    children: [
      { path: '', component: InicioSecretaria },
      { path: 'agenda', title: 'Agenda de turnos · ScaleKine', component: AgendaSecretaria },
      { path: 'asignar', title: 'Asignar turno · ScaleKine', component: AsignarTurno },
      { path: 'consultorio', title: 'Consultorio · ScaleKine', component: ConsultorioPagina },
      { path: 'pacientes', title: 'Pacientes · ScaleKine', component: PacientesPagina },
      { path: 'pacientes/:id', title: 'Ficha del paciente · ScaleKine', component: PacienteFicha },
    ],
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
