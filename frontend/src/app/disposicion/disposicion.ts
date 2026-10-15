import { Component, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { Consultorio } from '../nucleo/consultorio/consultorio';
import type { Rol } from '../nucleo/sesion/modelo';
import { Sesion } from '../nucleo/sesion/sesion';
import { Icono, type NombreDeIcono } from '../nucleo/ui/icono';

const NOMBRE_DEL_ROL = {
  administrador: 'Administración',
  secretaria: 'Secretaría',
  kinesiologo: 'Kinesiología',
} as const;

interface OpcionDeMenu {
  ruta: string;
  texto: string;
  icono: NombreDeIcono;
}

const MENU_DE_SECRETARIA: readonly OpcionDeMenu[] = [
  { ruta: '/secretaria/agenda', texto: 'Agenda', icono: 'agenda' },
  { ruta: '/secretaria/asignar', texto: 'Asignar turno', icono: 'asignar' },
  { ruta: '/secretaria/pacientes', texto: 'Pacientes', icono: 'pacientes' },
  { ruta: '/secretaria/consultorio', texto: 'Consultorio', icono: 'consultorio' },
];

/** Menú de cada rol (DESIGN.md §6). El administrador suma kinesiólogos y cuentas. */
const MENU_POR_ROL: Readonly<Record<Rol, readonly OpcionDeMenu[]>> = {
  secretaria: MENU_DE_SECRETARIA,
  administrador: [
    ...MENU_DE_SECRETARIA,
    { ruta: '/admin/kinesiologos', texto: 'Kinesiólogos', icono: 'kinesiologos' },
    { ruta: '/admin/cuentas', texto: 'Cuentas', icono: 'cuentas' },
  ],
  kinesiologo: [{ ruta: '/kinesiologo', texto: 'Mi agenda', icono: 'agenda' }],
};

const MARCA = 'ScaleKine';

/**
 * Estructura común de las pantallas con sesión: barra lateral con el nombre del consultorio, el
 * menú del rol y la cuenta, y el contenido de la ruta. Por debajo de 900 px la barra pasa a una
 * barra superior con un botón de menú.
 */
@Component({
  selector: 'app-disposicion',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icono],
  templateUrl: './disposicion.html',
  styleUrl: './disposicion.css',
  host: { '[class.solo-tarjeta]': 'soloTarjeta()' },
})
export class Disposicion {
  private readonly sesion = inject(Sesion);
  private readonly router = inject(Router);
  private readonly consultorio = inject(Consultorio);

  /** Título de la sección, definido en los datos de la ruta. */
  readonly seccion = input<string>('');

  protected readonly usuario = this.sesion.usuario;
  protected readonly cerrando = signal(false);
  protected readonly menuAbierto = signal(false);
  protected readonly nombreDelRol = computed(() => {
    const rol = this.sesion.rol();
    return rol ? NOMBRE_DEL_ROL[rol] : '';
  });

  /** Con un paso pendiente, el menú no ofrece nada más que cerrar sesión: el backend lo bloquearía igual. */
  protected readonly puedeCambiarContrasena = computed(() => this.sesion.pasoPendiente() === null);

  /**
   * Con un paso pendiente (cambio obligatorio de contraseña, segundo factor) la pantalla es una
   * tarjeta centrada, sin barra lateral (DESIGN.md §6): no hay nada más que hacer que el paso.
   */
  protected readonly soloTarjeta = computed(() => this.sesion.pasoPendiente() !== null);

  protected readonly menu = computed<readonly OpcionDeMenu[]>(() => {
    const rol = this.sesion.rol();
    return rol && this.sesion.pasoPendiente() === null ? MENU_POR_ROL[rol] : [];
  });

  /**
   * Nombre del consultorio (RF-13). El kinesiólogo no puede leerlo (D-16: la API le responde 403),
   * así que ve solo la marca; tampoco se pide mientras hay un paso pendiente.
   */
  protected readonly nombreDelConsultorio = computed(() =>
    this.leeElConsultorio() ? (this.consultorio.nombre() ?? MARCA) : MARCA,
  );

  constructor() {
    if (this.leeElConsultorio() && this.consultorio.nombre() === null) {
      void this.consultorio.obtener().catch(() => undefined);
    }
    this.router.events
      .pipe(
        filter((e) => e instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.menuAbierto.set(false));
  }

  private leeElConsultorio(): boolean {
    const rol = this.sesion.rol();
    return rol !== null && rol !== 'kinesiologo' && this.sesion.pasoPendiente() === null;
  }

  protected alternarMenu(): void {
    this.menuAbierto.update((abierto) => !abierto);
  }

  /** Cierra la sesión en el servidor y vuelve al ingreso (RF-10). */
  protected async cerrarSesion(): Promise<void> {
    this.cerrando.set(true);
    try {
      await this.sesion.cerrar();
    } catch {
      // El cliente ya olvidó la sesión; si la revocación falló, la cookie vence sola (RF-11).
    } finally {
      this.cerrando.set(false);
    }
    await this.router.navigateByUrl('/ingresar');
  }
}
