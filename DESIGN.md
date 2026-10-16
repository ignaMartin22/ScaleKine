# DESIGN.md

Sistema visual de ScaleKine: colores, tipografía, íconos, componentes y reglas de movimiento. Es la
referencia para toda pantalla del frontend. Cubre RNF-15 (`docs/spec.md`) y se implementa en la
tarea de diseño visual de `docs/tasks.md`.

**Idea:** celestes verdosos y negro, con la claridad de iOS/macOS y la economía de una interfaz
minimalista. Tiene que andar fluido en cualquier PC del consultorio: nada que descargar además de la
app, nada de animaciones pesadas, y acciones críticas que se distinguen de un vistazo.

---

## 1. Principios

1. **Liviano primero.** Sin fuentes descargadas, sin librerías de componentes, sin librerías de
   íconos, sin imágenes de decoración. Todo el estilo vive en `frontend/src/styles.css` (tokens y
   componentes) y en los CSS de cada componente. Objetivo: el CSS global por debajo de **25 KB** sin
   comprimir.
2. **Claro y oscuro.** El modo sigue al sistema operativo (`prefers-color-scheme`). No hay selector
   manual en el MVP.
3. **El color nunca va solo.** Todo estado o acción crítica lleva color **y** ícono **y** texto. Un
   daltónico o una pantalla vieja tienen que poder distinguir "Anular" de "Asignar".
4. **Contraste WCAG 2.1 AA.** Texto normal ≥ 4,5:1; texto grande, íconos y bordes de controles
   ≥ 3:1. Los valores de §2 ya están verificados.
5. **Quieto por defecto.** Solo transiciones de color cortas. Nada se mueve por su cuenta.
6. **Un solo idioma y nombres de la spec.** Etiquetas en castellano y nombres de estado de la spec
   (`reservado` se muestra "Reservado", etc.).

---

## 2. Color

Todos los colores se definen como variables CSS en `:root` y se redefinen para el modo oscuro. Los
componentes usan **solo los tokens semánticos** (nunca un hexadecimal suelto).

### 2.1 Paleta base

| Rol | Claro | Oscuro | Uso |
|---|---|---|---|
| `--fondo` | `#F5F8F9` | `#0B0F10` | Fondo de la página |
| `--superficie` | `#FFFFFF` | `#141A1C` | Tarjetas, tablas, diálogos |
| `--superficie-2` | `#EEF3F4` | `#1C2427` | Encabezados de tabla, filas alternas, campos deshabilitados |
| `--borde` | `#D5DFE1` | `#2A3438` | Divisores y bordes decorativos |
| `--borde-control` | `#7A8B8F` | `#5C6B70` | Borde de campos y botones secundarios (≥ 3:1) |
| `--texto` | `#0B0F10` | `#E8F0F2` | Texto principal |
| `--texto-2` | `#4A5A5E` | `#9FB0B5` | Texto secundario, ayudas, metadatos |
| `--lateral` | `#0B0F10` | `#0B0F10` | Barra lateral (negra en los dos modos) |
| `--lateral-texto` | `#E8F0F2` | `#E8F0F2` | Texto de la barra lateral |

### 2.2 Acento (verde agua / teal)

| Rol | Claro | Oscuro | Uso |
|---|---|---|---|
| `--primario` | `#0A7672` | `#2CC5BE` | Botón principal, enlaces, ítem activo |
| `--sobre-primario` | `#FFFFFF` | `#04201F` | Texto e ícono sobre `--primario` |
| `--primario-hover` | `#085F5C` | `#3DD3CC` | Hover del botón principal |
| `--acento` | `#0C928D` | `#2CC5BE` | Anillo de foco, detalles decorativos |
| `--acento-suave` | `#E3F6F5` | `#0F2A29` | Fondos de selección, fila seleccionada |
| `--celeste` | `#5BC0EB` | `#5BC0EB` | Color de apoyo, solo decorativo (nunca texto sobre blanco) |
| `--info` | `#1170A0` | `#8FD3F5` | Mensajes informativos |

`#0C928D` con texto blanco no llega a AA (3,81:1): por eso el botón usa `#0A7672` (5,46:1) y el teal
claro queda para el foco y los detalles. Como anillo de foco llega a 3:1 sobre `--fondo` (3,57),
`--superficie` (3,81), `--superficie-2` (3,40) y `--acento-suave` (3,40).

### 2.3 Colores de acción (cuatro niveles)

| Nivel | Fondo claro / texto | Fondo oscuro / texto | Ícono | Cuándo |
|---|---|---|---|---|
| **Principal** | `#0A7672` / blanco (5,5:1) | `#2CC5BE` / `#04201F` (8,0:1) | según la acción | Confirmar, guardar, asignar, buscar |
| **Secundario** | transparente, borde `--borde-control`, texto `--texto` | ídem | según la acción | Cancelar, actualizar, volver, descargar |
| **Advertencia** | `#B45309` / blanco (5,0:1) | `#F2A93B` / `#1F1300` (9,1:1) | `lapiz` / `calendario-reloj` | Corregir un estado, reprogramar |
| **Peligro** | `#C62828` / blanco (5,6:1) | `#FF6B6B` / `#1F0000` (7,2:1) | `prohibido` / `usuario-baja` | Anular un turno, desactivar una cuenta, restablecer |

Reglas:
- Hay **un solo botón principal** por pantalla o diálogo.
- Toda acción de advertencia o peligro pide **confirmación** en un `app-dialogo`, cuyo botón de
  confirmar repite el color y el ícono de la acción ("Anular turno" en rojo, no un "Aceptar" teal).
- En una fila de la agenda, las acciones del flujo normal (Llegó, Asistió) son principales o
  secundarias; "No asistió" y "Anular" son peligro; "Corregir" y "Reprogramar", advertencia.

### 2.4 Estados del turno

Cada estado se muestra como una **pastilla**: fondo suave, texto oscuro del mismo tono e ícono.

| Estado | Ícono | Claro (texto / fondo) | Oscuro (texto / fondo) |
|---|---|---|---|
| `reservado` · Reservado | `reloj` | `#0B5F86` / `#E3F3FB` (6,2:1) | `#8FD3F5` / `#0F2A38` (9,1:1) |
| `en_espera` · En espera | `reloj-arena` | `#8A4B00` / `#FFF1D6` (6,1:1) | `#F7C46C` / `#33240A` (9,4:1) |
| `asistio` · Asistió | `check` | `#13652F` / `#E2F5E8` (6,3:1) | `#7EDB9C` / `#0F2E1B` (8,8:1) |
| `no_asistio` · No asistió | `usuario-x` | `#A11F1F` / `#FDE6E6` (6,5:1) | `#FF9C9C` / `#3A1414` (8,1:1) |
| `anulado` · Anulado | `prohibido` | `#4A5A5E` / `#ECEFF0` (6,2:1), texto tachado | `#A9B6BA` / `#1F2629` (7,4:1), tachado |

"En espera" es el estado que el kinesiólogo mira: su pastilla es la más visible (ámbar), y en la
agenda del kinesiólogo la sección "En espera" va primero.

### 2.5 Mensajes

| Tipo | Ícono | Uso |
|---|---|---|
| Error | `alerta` | `role="alert"`, borde izquierdo y texto en peligro |
| Aviso | `alerta` | Pendientes de marcar, conexión caída: borde y texto ámbar |
| Información | `info` | Confirmaciones ("Se creó el paciente"): borde y texto `--info` |
| Éxito | `check` | `#15803D` (claro) / `#7EDB9C` (oscuro) |

---

## 3. Tipografía

**Fuente del sistema, sin descargas:**

```css
font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, Roboto, "Helvetica Neue",
  Arial, sans-serif;
```

San Francisco en Mac e iOS, Segoe UI en Windows, Roboto en Android. Los números de horas y montos
usan `font-variant-numeric: tabular-nums` para que las columnas se alineen.

| Token | Tamaño / alto de línea | Peso | Uso |
|---|---|---|---|
| `--texto-titulo` | 1,5 rem / 1,25 | 600 | `h1` de cada pantalla |
| `--texto-subtitulo` | 1,125 rem / 1,35 | 600 | `h2` de sección |
| `--texto-base` | 1 rem (16 px) / 1,5 | 400 | Texto y formularios |
| `--texto-tabla` | 0,9375 rem (15 px) / 1,4 | 400 | Celdas de tablas |
| `--texto-chico` | 0,8125 rem (13 px) / 1,4 | 500 | Pastillas, ayudas, metadatos |

Nunca menos de 13 px. Mayúsculas solo al inicio de la oración.

---

## 4. Espaciado, forma y elevación

- **Escala de espaciado** (múltiplos de 4 px): `--e-1` 4, `--e-2` 8, `--e-3` 12, `--e-4` 16,
  `--e-5` 24, `--e-6` 32, `--e-7` 48.
- **Radios:** `--radio-chico` 6 px (pastillas, campos), `--radio` 10 px (botones, tarjetas),
  `--radio-grande` 14 px (diálogos).
- **Sombras**, solo dos, muy suaves:
  - `--sombra-1`: `0 1px 2px rgb(0 0 0 / 0.06), 0 1px 1px rgb(0 0 0 / 0.04)` (tarjetas).
  - `--sombra-2`: `0 8px 24px rgb(0 0 0 / 0.12)` (diálogos).
  - En el modo oscuro las tarjetas no llevan sombra: se separan por `--superficie` y `--borde`.
- **Sin** `backdrop-filter`, sin desenfoques, sin degradados ni imágenes de fondo.

**Densidad:**
- Formularios cómodos: campos y botones de **40 px** de alto, etiqueta arriba del campo, `--e-4`
  entre campos.
- Tablas de agenda compactas: filas de **44 px**, `--e-2` / `--e-3` de relleno, encabezado fijo
  (`position: sticky`) cuando la tabla desplaza.
- Áreas táctiles de al menos **40 × 40 px** (también los botones de solo ícono).

---

## 5. Íconos

- **SVG en línea**, trazo de 2 px, caja de 24 × 24 y `stroke="currentColor"` (toman el color del
  texto). Tamaño visual 20 px en botones y menú, 16 px en pastillas.
- Se copian del set **Lucide** (licencia ISC), solo los necesarios, en un único componente
  `app-icono` (`frontend/src/app/nucleo/ui/icono.ts`) con un mapa `nombre → path`. Sin dependencia
  npm, sin CDN, sin fuente de íconos. Se conserva el aviso de licencia en el archivo.
- Un ícono decorativo lleva `aria-hidden="true"`; un botón de solo ícono lleva `aria-label`.

| Nombre | Lucide | Dónde |
|---|---|---|
| `agenda` | `calendar-days` | Menú: agenda |
| `asignar` | `calendar-plus` | Menú y botón: asignar turno |
| `pacientes` | `users` | Menú: pacientes |
| `consultorio` | `building-2` | Menú: consultorio |
| `kinesiologos` | `stethoscope` | Menú: kinesiólogos |
| `cuentas` | `user-cog` | Menú: cuentas |
| `contrasena` | `key-round` | Menú: cambiar contraseña |
| `salir` | `log-out` | Cerrar sesión |
| `buscar` | `search` | Buscador de pacientes |
| `actualizar` | `refresh-cw` | Actualizar agenda |
| `llego` | `log-in` | Acción "Llegó" |
| `check` | `check` | Acción "Asistió", estado asistió, éxito |
| `usuario-x` | `user-x` | Acción y estado "No asistió" |
| `prohibido` | `ban` | Anular, estado anulado |
| `lapiz` | `pencil` | Corregir estado, editar |
| `calendario-reloj` | `calendar-clock` | Reprogramar |
| `ticket` | `file-down` | Descargar ticket |
| `monedas` | `wallet` | Coseguros |
| `reloj` | `clock` | Estado reservado |
| `reloj-arena` | `hourglass` | Estado en espera |
| `alerta` | `triangle-alert` | Errores y avisos |
| `info` | `info` | Información |
| `sin-conexion` | `wifi-off` | Conexión caída (T-32) |
| `cerrar` | `x` | Cerrar diálogo |
| `menu` | `menu` | Abrir el menú en pantallas chicas |
| `volver` | `arrow-left` | Volver al inicio |
| `escudo` | `shield-check` | Segundo factor |
| `usuario-baja` | `user-minus` | Desactivar cuenta |
| `usuario` | `user` | Tarjeta de paciente (§6.2) |
| `siguiente` | `chevron-right` | "Siguiente" del asistente y filas de resultados (§6.1, §6.2) |

---

## 6. Estructura de pantalla

```
┌──────────────┬───────────────────────────────────────────┐
│ Consultorio  │  Agenda · lunes 19/10/2026      [↻] [＋]  │
│ de Prueba    │  ┌─────────────────────────────────────┐  │
│              │  │ tabla de turnos                     │  │
│ ▣ Agenda     │  │                                     │  │
│ ＋ Asignar   │  └─────────────────────────────────────┘  │
│ ☺ Pacientes  │                                           │
│ ⌂ Consultorio│                                           │
│ ⚙ Cuentas    │                                           │
│              │                                           │
│ secretaria   │                                           │
│ ⎋ Salir      │                                           │
│ ScaleKine    │                                           │
└──────────────┴───────────────────────────────────────────┘
```

- **Barra lateral** negra (`--lateral`) de **240 px**: arriba el nombre del consultorio (RF-13), en
  `--texto-subtitulo`; después el menú del rol (ícono + texto); al pie el usuario y su rol, "Cambiar
  contraseña", "Cerrar sesión" y la marca "ScaleKine" en `--texto-chico` y `--texto-2`.
- **Ítem activo:** fondo `--primario` del modo oscuro (`#2CC5BE`) con texto `#04201F` (8,0:1), en los
  dos modos, porque la barra siempre es negra. Hover: fondo `rgb(255 255 255 / 0.08)`.
- **Contenido:** máximo 1200 px de ancho, `--e-6` de margen. Encabezado de la pantalla con `h1` a la
  izquierda y las acciones a la derecha.
- **Menú por rol:**
  - Secretaría: Agenda, Asignar turno, Pacientes, Consultorio.
  - Administrador: lo mismo, más Kinesiólogos y Cuentas.
  - Kinesiólogo: solo Mi agenda.
- **Pantallas chicas:**
  - Por debajo de **900 px**, la barra lateral se oculta y aparece una barra superior negra con el
    nombre del consultorio y un botón `menu` que abre la barra lateral sobre el contenido (sin
    animación de deslizamiento: aparece y desaparece).
  - Por debajo de **600 px**, las tablas de la agenda pasan a tarjetas apiladas (una por turno).
- **Pantallas sin sesión** (ingreso, segundo factor, cambio obligatorio de contraseña): sin barra
  lateral, una tarjeta centrada de 400 px sobre `--fondo`, con la marca arriba.
- **Impresión:** `@media print` oculta la barra y los botones; se imprime en blanco y negro.

### 6.1 Asistente por pasos (asignar turno)

Asignar un turno es una secuencia de pantallas, no un formulario largo: **se ve un solo paso por
vez y no hace falta desplazarse** en una pantalla de 1280 × 720. Lo ya elegido queda a la vista en
un resumen (decisión del usuario, 2026-10-15).

```
┌──────────────┬──────────────────────────────────────────────────────────┐
│              │  Asignar turno                                           │
│  (barra      │  ① Paciente ─ ② Fecha y bloque ─ ❸ Kinesiólogo ─ ④ Abono  │
│   lateral)   │  ┌───────────────────────────────┐  ┌─────────────────┐  │
│              │  │ Kinesiólogo y franja          │  │ Tu turno        │  │
│              │  │                               │  │ ☺ Ana Pérez     │  │
│              │  │ ( ) Lic. Gómez  08:00 08:45 … │  │   DNI 30.123.456│  │
│              │  │ ( ) Lic. Ruiz   09:30 10:15 … │  │   Cambiar       │  │
│              │  │                               │  │ ▣ lun 19/10     │  │
│              │  │                               │  │   Mañana        │  │
│              │  │ [← Atrás]       [Siguiente →] │  │   Cambiar       │  │
│              │  └───────────────────────────────┘  └─────────────────┘  │
└──────────────┴──────────────────────────────────────────────────────────┘
```

- **Pasos, en este orden:** 1. Paciente (DNI; si no existe, el alta en el mismo paso) → 2. Fecha y
  bloque → 3. Kinesiólogo y franja → 4. Coseguro abonado y confirmación → pantalla "Turno asignado"
  con la descarga del ticket y "Asignar otro turno".
- **Indicador de pasos** (`pasos`), arriba: lista numerada en una línea. El paso actual va en
  `--primario` con `aria-current="step"`; los completos llevan el ícono `check` y se pueden
  tocar para volver; los siguientes van en `--texto-2` y no se pueden tocar. Por debajo de 600 px
  se reduce a "Paso 3 de 4 · Kinesiólogo y franja".
- **Resumen** (`resumen`, título "Tu turno"): columna derecha de 280 px con lo elegido en los pasos
  anteriores (paciente con DNI y obra social, fecha y bloque, kinesiólogo y franja), cada dato con
  su ícono y un enlace "Cambiar" que vuelve a ese paso. Por debajo de 900 px pasa arriba del paso,
  como una franja compacta de una o dos líneas.
- **Botones:** "Siguiente" (`boton`, ícono `siguiente` a la derecha) abajo a la derecha, habilitado
  solo con el paso completo; "Atrás" (`boton secundario`, ícono `volver`) abajo a la izquierda. El
  último paso dice "Confirmar turno". Enter envía el paso.
- **Volver atrás no pierde lo elegido**, salvo lo que deja de valer: si cambia el paciente, la
  fecha o el bloque, la franja elegida se descarta y se avisa con un `aviso` en el paso 3.
- **Foco:** al cambiar de paso, el foco va al título del paso nuevo (`h2` con `tabindex="-1"`).
- Sin animación entre pasos (§8): el paso nuevo reemplaza al anterior.

### 6.2 Paciente encontrado y resultados de búsqueda

Un paciente nunca se muestra como texto suelto ni como lista sin estilo.

- **Tarjeta de paciente** (`paciente-tarjeta`): ícono `usuario` en un círculo de 40 px en
  `--acento-suave`; nombre y apellido en `--texto-subtitulo` y peso 600; debajo, en `--texto-2`,
  "DNI 30.123.456 · OSDE · 11 5555-0000" (DNI con puntos solo al mostrarlo). Las acciones van a la
  derecha (en el asistente: "Cambiar paciente", `boton secundario`). Se usa en el paso 1 del
  asistente cuando el DNI existe, y en el resumen en versión compacta.
- **Lista de resultados** (`lista-pacientes`, en Pacientes): cada resultado es una fila con el
  mismo contenido de la tarjeta, separada por un borde `--borde`, con hover en `--acento-suave` y el
  ícono `siguiente` a la derecha. Toda la fila es el enlace a la ficha (RF-21). Arriba, la
  cantidad: "3 pacientes". Sin resultados, un `info` con la acción de alta.

---

## 7. Componentes

Clases globales en `styles.css`. Se mantienen los nombres que ya usa el código (`boton`,
`secundario`, `peligro`, `tarjeta`, `campo`, `tabla`, `error`, `aviso`, `dialogo`) y se agregan los
que faltan.

| Componente | Clases | Notas |
|---|---|---|
| Botón | `boton`, `boton secundario`, `boton advertencia`, `boton peligro`, `boton solo-icono` | Ícono a la izquierda del texto, `--e-2` entre ambos. Deshabilitado: opacidad 0,5 y `cursor: not-allowed`. |
| Campo | `campo` | Etiqueta arriba; ayuda y error debajo, asociados con `aria-describedby`. Error: borde y texto en peligro, con ícono `alerta`. |
| Tarjeta | `tarjeta`, `tarjeta ancha` | `--superficie`, `--radio`, `--sombra-1` (solo modo claro), `--e-5` de relleno. |
| Tabla | `tabla`, `tabla-contenedor` | Encabezado en `--superficie-2`, fila hover en `--acento-suave`, fila pendiente de marcar con borde izquierdo ámbar. |
| Pastilla de estado | `estado estado-<nombre>` | §2.4. |
| Mensaje | `error`, `aviso`, `info`, `exito` | §2.5. Borde izquierdo de 4 px. |
| Diálogo | `dialogo-fondo`, `dialogo` | Fondo `rgb(0 0 0 / 0.45)` sin desenfoque; diálogo con `--radio-grande` y `--sombra-2`. Foco atrapado; Esc cierra. |
| Asistente por pasos | `pasos`, `resumen` | §6.1. |
| Tarjeta de paciente | `paciente-tarjeta`, `lista-pacientes` | §6.2. |
| Indicador de conexión | `conexion` | Barra ámbar fija arriba del contenido con `sin-conexion` y "Sin conexión: la agenda puede estar desactualizada" (RF-45, T-32). |

---

## 8. Movimiento y rendimiento

- Única transición permitida: `transition: background-color 150ms ease, border-color 150ms ease,
  color 150ms ease;` en hover y foco.
- Prohibido: animaciones de entrada o salida, `transform` animados, esqueletos animados,
  desplazamiento suave forzado, `backdrop-filter`, `filter: blur`, sombras grandes, parallax.
- Con `prefers-reduced-motion: reduce` no hay ninguna transición.
- La carga se indica con texto ("Actualizando…") y `aria-busy`, no con un spinner animado.

---

## 9. Accesibilidad

- **Foco visible siempre:** `outline: 2px solid var(--acento); outline-offset: 2px` en
  `:focus-visible`. Nunca `outline: none` sin un reemplazo.
- Navegación completa con teclado; el orden de tabulación sigue al visual.
- Etiquetas `label` en todos los campos y `caption` o `aria-label` en las tablas.
- Tamaño de texto escalable: todo en `rem`, y la interfaz se mantiene usable al 200 % de zoom.
- Los estados y acciones combinan color, ícono y texto (§1.3).

---

## 10. Criterio de "hecho" de la implementación

1. Todos los colores, tamaños, radios, sombras y espacios salen de los tokens de este documento; un
   `git grep` de hexadecimales en los CSS de componentes no encuentra ninguno fuera de `styles.css`.
2. Modo claro y oscuro completos, siguiendo al sistema operativo.
3. Las combinaciones de texto y fondo cumplen §2 (WCAG AA), verificadas con una prueba automática de
   contraste sobre los tokens.
4. Barra lateral por rol, y vista de pantallas chicas a 900 px y 600 px.
5. Íconos de §5 en el menú, las acciones de la agenda y las pastillas de estado.
6. Ninguna descarga nueva: sin fuentes, sin librerías de íconos ni de componentes, sin imágenes; el
   CSS global por debajo de 25 KB.
7. Sin animaciones fuera de §8.
8. Recorrido manual del usuario en los dos modos y en una pantalla chica.
9. Asignar un turno no requiere desplazarse en 1280 × 720, y el resumen muestra lo elegido (§6.1).
