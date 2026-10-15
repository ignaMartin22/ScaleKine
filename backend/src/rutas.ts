import type { Router } from 'express';
import type { BaseDeDatos } from './comun/baseDeDatos.js';
import type { Configuracion } from './comun/configuracion.js';
import type { Reloj } from './comun/reloj.js';
import { crearServicioCuentas } from './modulos/m1-identidad/cuentas.js';
import { crearModuloIdentidad } from './modulos/m1-identidad/index.js';
import { crearRutasCuentas } from './modulos/m1-identidad/rutasCuentas.js';
import { crearServicioConsultorio } from './modulos/m2-maestros/consultorio.js';
import { crearServicioKinesiologos } from './modulos/m2-maestros/kinesiologos.js';
import { crearServicioPacientes } from './modulos/m2-maestros/pacientes.js';
import { crearRutasConsultorio } from './modulos/m2-maestros/rutasConsultorio.js';
import { crearRutasKinesiologos } from './modulos/m2-maestros/rutasKinesiologos.js';
import { crearRutasPacientes } from './modulos/m2-maestros/rutasPacientes.js';
import { crearRutasTicket } from './modulos/m3-turnos/rutasTicket.js';
import { crearRutasTurnos } from './modulos/m3-turnos/rutasTurnos.js';
import { crearServicioTicket } from './modulos/m3-turnos/ticket.js';
import { crearServicioTurnos } from './modulos/m3-turnos/turnos.js';
import { crearRutasDisponibilidad } from './modulos/m4-agenda/rutasDisponibilidad.js';
import { crearRutasPendientes } from './modulos/m4-agenda/rutasPendientes.js';
import { crearServicioDisponibilidad } from './modulos/m4-agenda/servicioDisponibilidad.js';
import { crearServicioPendientes } from './modulos/m4-agenda/servicioPendientes.js';

/**
 * Lista única de los routers de la API: la usan el servidor y la prueba que exige autorización en
 * toda ruta de escritura (plan.md §4.8). Cada módulo nuevo se agrega acá, y así queda cubierto
 * automáticamente por esa prueba.
 */
export async function crearRutas({
  db,
  reloj,
  config,
}: {
  db: BaseDeDatos;
  reloj: Reloj;
  config: Configuracion;
}): Promise<Router[]> {
  // La fábrica de identidad es asíncrona: si argon2 no funciona, falla acá y no en el primer ingreso.
  const identidad = await crearModuloIdentidad({ db, reloj, config });
  const cuentas = crearRutasCuentas({
    servicio: crearServicioCuentas({ db, reloj }),
    exigirSesion: identidad.exigirSesion,
  });
  const consultorio = crearRutasConsultorio({
    servicio: crearServicioConsultorio({ db }),
    exigirSesion: identidad.exigirSesion,
  });
  const kinesiologos = crearRutasKinesiologos({
    servicio: crearServicioKinesiologos({ db, reloj }),
    exigirSesion: identidad.exigirSesion,
  });
  const pacientes = crearRutasPacientes({
    servicio: crearServicioPacientes({ db }),
    exigirSesion: identidad.exigirSesion,
  });
  const disponibilidad = crearRutasDisponibilidad({
    servicio: crearServicioDisponibilidad({ db }),
    exigirSesion: identidad.exigirSesion,
  });
  const pendientes = crearRutasPendientes({
    servicio: crearServicioPendientes({ db, reloj }),
    exigirSesion: identidad.exigirSesion,
  });
  const turnos = crearRutasTurnos({
    servicio: crearServicioTurnos({ db, reloj }),
    exigirSesion: identidad.exigirSesion,
  });
  const ticket = crearRutasTicket({
    servicio: crearServicioTicket({ db, consultorio: crearServicioConsultorio({ db }) }),
    exigirSesion: identidad.exigirSesion,
  });
  return [identidad.rutas, cuentas, consultorio, kinesiologos, pacientes, disponibilidad, pendientes, turnos, ticket];
}
