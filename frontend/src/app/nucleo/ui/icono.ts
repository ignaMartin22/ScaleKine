/*
 * Los trazos de los íconos están copiados del set Lucide (https://lucide.dev), solo los necesarios.
 *
 * ISC License
 *
 * Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT).
 * All other copyright (c) for Lucide are held by Lucide Contributors 2022.
 *
 * Permission to use, copy, modify, and/or distribute this software for any purpose with or without
 * fee is hereby granted, provided that the above copyright notice and this permission notice appear
 * in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS
 * SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE
 * AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT,
 * NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE
 * OF THIS SOFTWARE.
 */
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Una forma del ícono, en la caja de 24 x 24: un trazo, un círculo o un rectángulo. */
type Forma =
  | { readonly d: string }
  | { readonly c: readonly [cx: number, cy: number, r: number] }
  | { readonly r: readonly [x: number, y: number, ancho: number, alto: number, radio: number] };

const t = (d: string): Forma => ({ d });
const c = (cx: number, cy: number, r: number): Forma => ({ c: [cx, cy, r] });
const r = (x: number, y: number, ancho: number, alto: number, radio: number): Forma => ({
  r: [x, y, ancho, alto, radio],
});

/** Nombres de DESIGN.md §5 con el ícono de Lucide que corresponde. */
export const ICONOS = {
  // calendar-days
  agenda: [
    t('M8 2v4'),
    t('M16 2v4'),
    r(3, 4, 18, 18, 2),
    t('M3 10h18'),
    t('M8 14h.01'),
    t('M12 14h.01'),
    t('M16 14h.01'),
    t('M8 18h.01'),
    t('M12 18h.01'),
  ],
  // calendar-plus
  asignar: [
    t('M8 2v4'),
    t('M16 2v4'),
    t('M21 13V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8'),
    t('M3 10h18'),
    t('M16 19h6'),
    t('M19 16v6'),
  ],
  // users
  pacientes: [
    t('M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'),
    c(9, 7, 4),
    t('M22 21v-2a4 4 0 0 0-3-3.87'),
    t('M16 3.13a4 4 0 0 1 0 7.75'),
  ],
  // building-2
  consultorio: [
    t('M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z'),
    t('M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2'),
    t('M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2'),
    t('M10 6h4'),
    t('M10 10h4'),
    t('M10 14h4'),
    t('M10 18h4'),
  ],
  // stethoscope
  kinesiologos: [
    t(
      'M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6 6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3',
    ),
    t('M8 15v1a6 6 0 0 0 6 6 6 6 0 0 0 6-6v-4'),
    c(20, 10, 2),
  ],
  // user-cog
  cuentas: [
    c(10, 8, 5),
    t('M2 21a8 8 0 0 1 10.4-7.6'),
    c(18, 18, 3),
    t('M18 13.5v1.5'),
    t('M18 21v1.5'),
    t('M22.5 18H21'),
    t('M15 18h-1.5'),
  ],
  // key-round
  contrasena: [
    t(
      'M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z',
    ),
    c(16.5, 7.5, 0.5),
  ],
  // log-out
  salir: [t('M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4'), t('m16 17 5-5-5-5'), t('M21 12H9')],
  // search
  buscar: [c(11, 11, 8), t('m21 21-4.3-4.3')],
  // refresh-cw
  actualizar: [
    t('M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8'),
    t('M21 3v5h-5'),
    t('M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16'),
    t('M8 16H3v5'),
  ],
  // log-in
  llego: [t('M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4'), t('m10 17 5-5-5-5'), t('M15 12H3')],
  // check
  check: [t('M20 6 9 17l-5-5')],
  // user-x
  'usuario-x': [
    t('M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'),
    c(9, 7, 4),
    t('m17 8 5 5'),
    t('m22 8-5 5'),
  ],
  // ban
  prohibido: [c(12, 12, 10), t('m4.9 4.9 14.2 14.2')],
  // pencil
  lapiz: [
    t(
      'M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z',
    ),
    t('m15 5 4 4'),
  ],
  // calendar-clock
  'calendario-reloj': [
    t('M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5'),
    t('M16 2v4'),
    t('M8 2v4'),
    t('M3 10h5'),
    c(17.5, 17.5, 4.5),
    t('M17.5 15.5v2l1.5 1'),
  ],
  // file-down
  ticket: [
    t('M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z'),
    t('M14 2v4a2 2 0 0 0 2 2h4'),
    t('M12 18v-6'),
    t('m9 15 3 3 3-3'),
  ],
  // wallet
  monedas: [
    t(
      'M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1',
    ),
    t('M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4'),
  ],
  // clock
  reloj: [c(12, 12, 10), t('M12 6v6l4 2')],
  // hourglass
  'reloj-arena': [
    t('M5 22h14'),
    t('M5 2h14'),
    t('M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22'),
    t('M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2'),
  ],
  // triangle-alert
  alerta: [
    t('m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3'),
    t('M12 9v4'),
    t('M12 17h.01'),
  ],
  // info
  info: [c(12, 12, 10), t('M12 16v-4'), t('M12 8h.01')],
  // wifi-off
  'sin-conexion': [
    t('M12 20h.01'),
    t('M8.5 16.429a5 5 0 0 1 7 0'),
    t('M5 12.859a10 10 0 0 1 5.17-2.69'),
    t('M19 12.859a10 10 0 0 0-2.007-1.523'),
    t('M2 8.82a15 15 0 0 1 4.177-2.643'),
    t('M22 8.82a15 15 0 0 0-11.288-3.764'),
    t('m2 2 20 20'),
  ],
  // x
  cerrar: [t('M18 6 6 18'), t('m6 6 12 12')],
  // menu
  menu: [t('M4 5h16'), t('M4 12h16'), t('M4 19h16')],
  // arrow-left
  volver: [t('m12 19-7-7 7-7'), t('M19 12H5')],
  // shield-check
  escudo: [
    t(
      'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z',
    ),
    t('m9 12 2 2 4-4'),
  ],
  // user-minus
  'usuario-baja': [t('M2 21a8 8 0 0 1 13.292-6'), c(10, 8, 5), t('M22 19h-6')],
} as const satisfies Record<string, readonly Forma[]>;

export type NombreDeIcono = keyof typeof ICONOS;

/**
 * Ícono SVG en línea (DESIGN.md §5): trazo de 2 px en una caja de 24 x 24 que toma el color del
 * texto. Es decorativo (`aria-hidden`) salvo que se pase `etiqueta`, y entonces es una imagen con
 * nombre. Tamaño visual de 20 px en botones y menú, o 16 px en pastillas.
 */
@Component({
  selector: 'app-icono',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      focusable="false"
      [attr.width]="tamano()"
      [attr.height]="tamano()"
      [attr.aria-hidden]="etiqueta() ? null : 'true'"
      [attr.role]="etiqueta() ? 'img' : null"
      [attr.aria-label]="etiqueta() || null"
    >
      @for (forma of formas(); track $index) {
        @if ('d' in forma) {
          <path [attr.d]="forma.d" />
        } @else if ('c' in forma) {
          <circle [attr.cx]="forma.c[0]" [attr.cy]="forma.c[1]" [attr.r]="forma.c[2]" />
        } @else {
          <rect
            [attr.x]="forma.r[0]"
            [attr.y]="forma.r[1]"
            [attr.width]="forma.r[2]"
            [attr.height]="forma.r[3]"
            [attr.rx]="forma.r[4]"
          />
        }
      }
    </svg>
  `,
})
export class Icono {
  readonly nombre = input.required<NombreDeIcono>();
  readonly tamano = input<20 | 16>(20);
  /** Si se pasa, el ícono deja de ser decorativo y se anuncia con este nombre. */
  readonly etiqueta = input<string>();

  protected readonly formas = computed<readonly Forma[]>(() => ICONOS[this.nombre()]);
}
