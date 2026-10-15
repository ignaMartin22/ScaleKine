# Avance de la implementación

Estado al 2026-10-15, con la ola 5 casi cerrada: falta la parte 3 de T-30. Este documento registra qué está hecho, qué quedó a
medio camino y cómo retomarlo. No reemplaza a las fuentes de verdad: los requisitos están en
[`spec.md`](./spec.md), las decisiones de diseño en [`plan.md`](./plan.md) y el orden y los
criterios de "hecho" en [`tasks.md`](./tasks.md). Se actualiza cada vez que se fusiona un PR.

---

## 1. Estado por tarea

| Tarea | Estado | PR o rama | Notas |
|---|---|---|---|
| T-01 · Monorepo y PostgreSQL | Hecha | commit `e0714bd` | |
| T-02 · Esqueleto del backend | Hecha | commit `452e387` | |
| T-03 · Esquema y permisos | Hecha | commit `3719a14` | Se verificó que Prisma no intenta borrar los índices parciales escritos a mano. |
| T-04 · Arnés de integración | Hecha | commit `cda752e` | |
| T-05 · Esqueleto del frontend | Hecha | commit `ce1555f` | |
| T-06 · Integración continua | Hecha | #1 | Verificada con el #2: una dependencia vulnerable a propósito dejó el pipeline en rojo (cerrado sin fusionar). |
| T-07 · Sesiones | Hecha | #8 y #9 | El #9 aplica las observaciones de la revisión de seguridad. |
| T-08 · Autorización por rol | Hecha | #12 | Incluye la prueba guardiana de rutas (ver §3). |
| T-09 · Límite de intentos | Hecha | #15 | Tres rondas de revisión de seguridad; ver §2. |
| T-10 · CLI de instalación | Hecha | #14 | |
| T-11 · Contraseñas | Hecha | #11 y #13 | El #13 aplica dos rondas de revisión de seguridad. |
| T-12 · Segundo factor | Hecha | #17 | Tres rondas de revisión de seguridad; ver §2. |
| T-13 · Gestión de cuentas | Hecha | #18 | Revisada por el orquestador (no es crítica en `tasks.md`). |
| T-15 · Grilla | Hecha | #6 | Adelantada a la ola 1, porque es un módulo puro. |
| T-20 · Tabla de transiciones | Hecha | #7 | Adelantada a la ola 1, porque es un módulo puro. |
| T-14 · Acceso y cuentas (frontend) | Hecha | #22 y #25 | #22: ingreso, cambio de contraseña, segundo factor, cierre y vencimiento. #25: administración de cuentas. Las dos partes pasaron el recorrido manual del usuario. |
| T-16 · Consultorio | Hecha | #23 | Incluye la regla de lectura de M2 (`autorizarLectura`) y la guardiana de lecturas. |
| T-17 · Kinesiólogos | Hecha | #26 | Alta de cuenta y perfil en una transacción, cambio de bloque y listado con filtro. Las cuentas de kinesiólogo se gestionan desde `/api/cuentas`. |
| T-18 · Pacientes | Hecha | #28 | Búsqueda por query con DNI o nombre; ver §2b. |
| T-19 · Pantallas de M2 (frontend) | Hecha | #27 y #31 | #27: consultorio y kinesiólogos. #31: sección Pacientes con buscador, alta y ficha editable. Las dos partes pasaron el recorrido manual del usuario. |
| Ajustes previos a la ola 4 | Hecha | #30 | `TurnoEvento` solo con `SELECT` e `INSERT`, y conexión en UTC; ver §2b. |
| T-21 · Disponibilidad | Hecha | #33 y #36 | #36: sin kinesiólogos con la cuenta desactivada. Ver §2c. |
| T-22 · Asignar | Hecha | #34 | Crítica: pasó `revisor-seguridad` y una ronda de correcciones. |
| T-23 · Transiciones, corrección y coseguros | Hecha | #39 | Crítica: pasó `revisor-seguridad` y una ronda de correcciones. Migración `agregar_evento_modificacion_coseguros`. |
| T-24 · Reprogramar | Hecha | #45 | Crítica: pasó `revisor-seguridad` y una ronda de correcciones (una carrera no determinista reemplazada por una intercalación forzada). |
| T-25 · Ticket | Hecha | #38 | PDF con `pdfkit`; la prueba decodifica el QR con `jsqr`. |
| T-26 · Sin borrado | Hecha | #40 | |
| T-27 · Agendas | Hecha | #48 | Pasó `revisor-seguridad` y una ronda de correcciones (guardianas nuevas, esquemas compartidos en `comun/esquemas.ts`). |
| T-28 · Aviso de pendientes | Hecha | #44 | Adelantada a la ola 4 con el carril B libre. |
| T-29 · Ficha del paciente | Hecha | #50 | Incluye `horaLlegada` en las proyecciones de turno. |
| T-30 · Pantallas de agenda, asignación y ficha | Partes 1 y 2 hechas | #47 y #51 | Las dos pasaron el recorrido manual del usuario. Falta la parte 3: agenda del kinesiólogo y próximos/historial en la ficha. |
| T-31 a T-40 | Pendientes | — | Olas 6 y 7 de `tasks.md`. |

Otros PRs fusionados:
- #10 vuelve `@types/node` a la versión 24 y limita los saltos de versión que propone Dependabot.
- #16 y #19 documentan el avance; #21 precisa la spec y el plan para la ola 3 (DNI, lectura de M2 y alta de kinesiólogo).
- #24, #29 y #32 documentan el avance durante la ola 3.
- #35 y #37 cambian la spec con decisiones del usuario (ver §2c).
- #42 resuelve deuda de documentación y configuración; #43 centraliza `ingresarComo` en las fábricas de prueba.
- #46 documenta el cierre de la ola 4; #49 agrega `Cache-Control: no-store` a toda la API (RNF-14, decisión del usuario).
- #3, #4 y #20 son de Dependabot.
- El #5 (TypeScript 7 en el frontend) se cerró: Angular 22 exige TypeScript `~6.0`.

---

## 2. Ola 2: cómo se cerró

- **T-09 (#15).** Además de las pruebas pedidas, la revisión cambió el diseño del límite por
  dirección:
  - el intento se reserva en la IP antes de argon2 (`reservarIntentoDireccion`), y el punto se
    devuelve recién cuando la sesión o el cambio de contraseña quedan confirmados
    (`liberarIntentoDireccion`);
  - el bloqueo de 15 minutos arranca con el rechazo que alcanza el umbral
    (`confirmarFalloDireccion`), y los ingresos correctos no renuevan la ventana;
  - en una carrera con la cuenta ya bloqueada, el cambio de contraseña responde el mismo 403 que
    una actual incorrecta, en lugar de un 409 que delataba la contraseña;
  - el bloqueo de la cuenta se lee después de verificar la actual, para que una actual correcta no
    corra un segundo argon2 y no se distinga por tiempo;
  - `restablecer-admin` usa `SIN_BLOQUEO`.

- **T-12 (#17).**
  - Hay un único mecanismo de paso pendiente (`pasos.ts` y `middleware.ts`), con los pasos
    `verificar_segundo_factor`, `cambiar_contrasena` y `activar_segundo_factor`.
  - La activación es en dos pasos: QR, y después la confirmación, que devuelve 10 códigos de
    recuperación una sola vez. La verificación está conectada al límite de T-09.
  - Decisiones de la revisión:
    - para el administrador con TOTP activo, acertar solo la contraseña no reinicia el contador de
      la cuenta; lo reinicia la verificación del segundo factor (RNF-02 actualizado en la spec,
      con aprobación del usuario);
    - los códigos de recuperación se quitan con un `array_remove` atómico;
    - un TOTP repetido en serie toma el camino de un código inválido;
    - en Prisma 7.10, `updateMany` con `data: {}` no emite un UPDATE sino un SELECT sin lock, así
      que el ingreso usa `{ ingresosFallidos: { increment: 0 } }` para tomar la fila.
  - La guardiana de `rutas.test.ts` inspecciona la app completa, fija dónde aparece cada variante
    del middleware y qué rutas no usan ninguna, y detecta `router.use`/`app.use` de una variante.
  - El ayudante de pruebas es `ingresarComoAdministradorVerificado`
    (`test/integracion/fabricas.ts`).

- **T-13 (#18).** Rutas `GET` y `POST /api/cuentas`, `POST /api/cuentas/:id/restablecimiento` y
  `POST /api/cuentas/:id/desactivacion`, con `autorizarEscritura('cuentas')` también en el GET.
  Decisiones:
  - se crean solo cuentas de secretaría (la de kinesiólogo nace con su perfil en T-17);
  - la contraseña temporal la elige el administrador;
  - la cuenta del administrador no se gestiona por la API;
  - desactivar es idempotente;
  - se escribe primero `Usuario` y después las sesiones, y las pruebas de carrera lanzan el ingreso
    entre esas dos sentencias.

---

## 2b. Ola 3: cómo se cerró

**Fusionado:** T-14 (#22 y #25), T-16 (#23), T-17 (#26), T-18 (#28), T-19 (#27 y #31) y los
ajustes previos a la ola 4 (#30), más la documentación (#21, #24 y #29).

- **T-18 (#28).** Decisiones:
  - La búsqueda va por query (`GET /api/pacientes?dni=…` o `?nombre=…`, exactamente uno), porque el
    registro de peticiones descarta la query string y así el DNI no queda en los logs.
  - Un DNI buscado que no existe responde 200 con lista vacía (es el caso "ofrecer el alta"); uno
    con formato inválido, 400.
  - La búsqueda por nombre pide al menos 3 caracteres, devuelve a lo sumo 20 pacientes y no
    distingue mayúsculas, pero sí tildes.
  - Prisma no escapa los comodines de LIKE (`%%%` devolvía todos los pacientes): se escapan `%`, `_`
    y `\` en `escaparComodines`.
  - Aceptado: `1234567.5` se lee como el DNI `12345675`, porque la spec acepta puntos en cualquier
    lugar. Exigir los puntos en los miles sería un cambio de spec.
- **T-19 (#27 y #31).** Las pantallas de M2 viven bajo `/secretaria` (secretaría y administrador;
  el kinesiólogo vuelve a su agenda). En Pacientes:
  - un solo campo con selector "Buscar por" DNI o nombre;
  - el DNI se valida en el cliente con la misma regla que el backend (`nucleo/pacientes/dni.ts`), y
    un formato inválido es error del campo, sin consultar a la API;
  - un DNI sin resultados ofrece el alta con ese DNI precargado, sin pasarlo por la URL;
  - alta y edición comparten `paginas/formulario-paciente.ts`; `dni_en_uso` va al campo DNI;
  - por la ruta solo viaja el id del paciente.
- **Ajustes previos a la ola 4 (#30),** decididos por el usuario:
  - la migración `turno_evento_solo_insercion` revoca el `UPDATE` de `scalekine_app` sobre
    `TurnoEvento` (nunca tuvo `DELETE`); `despliegue.md` §7 está actualizado;
  - `crearBaseDeDatos` fija `timezone=UTC` con `options` del pool. La prueba fuerza otra zona con
    `PGOPTIONS` y comprueba que una conexión común la hereda y la de la aplicación no.
- La migración del #30 ya está aplicada en `scalekine_desarrollo`.

**Datos de la base de desarrollo** (`scalekine_desarrollo`, todos ficticios):
- El sistema está instalado con un consultorio de prueba.
- El administrador del usuario tiene el segundo factor activo.
- Hay cuentas `secretaria`, `kinesio` y `secretaria2` (esta última desactivada en la prueba del #25),
  más los kinesiólogos y pacientes ficticios que se crearon en los recorridos del #27 y el #31.

---

## 2c. Ola 4: cómo se cerró

**Fusionado:** T-21 (#33 y #36), T-22 (#34), T-23 (#39), T-24 (#45), T-25 (#38) y T-26 (#40), más
los cambios de spec #35 y #37 y, adelantada, T-28 (#44). El usuario probó el sistema a mano
con todo fusionado: la ola 4 no tiene pantallas todavía (llegan en T-30), así que los turnos se
probaron por la API desde la consola del navegador.

**Decisiones del usuario (cambios de spec):**
- **#35.** Un kinesiólogo con la cuenta desactivada ya no atiende: para asignar es como si no
  existiera. No aparece en la disponibilidad (RF-22, #36) y asignarle un turno da 404
  `kinesiologo_no_encontrado` (RF-23, #34).
- **#37.** Modificar los coseguros registra un `TurnoEvento` de tipo `modificacion_coseguros`, sin
  los montos anteriores (RF-46). Así se mantiene el invariante de que toda escritura de turnos deja
  su evento.

**Contratos** (documentados en el comentario de cada ruta):
- `GET /api/disponibilidad?fecha=&bloque=&pacienteId=` (`m4-agenda/rutasDisponibilidad.ts`).
- `POST /api/turnos`, `POST /api/turnos/:id/transicion` `{ hacia }`,
  `POST /api/turnos/:id/correccion` `{ estado }` y `PUT /api/turnos/:id/coseguros`
  (`m3-turnos/rutasTurnos.ts`).
- `GET /api/turnos/:id/ticket` (`m3-turnos/rutasTicket.ts`).
- Disponibilidad y ticket se autorizan con `autorizarEscritura('turnos')`, como `GET /api/cuentas`:
  existen para asignar, así que los usan quienes escriben turnos. El kinesiólogo recibe 403.

**Decisiones de implementación:**
- La ocupación de franja la decide la base: se atrapa el P2002 y se traduce según el nombre del
  índice (`meta.driverAdapterError.cause.constraint.index`). Cualquier otro P2002 termina en 500 sin
  datos. Prisma está fijado en 7.10.0; si cambia esa forma, las pruebas de 409 lo detectan.
- `transicionar` y `corregir` actualizan condicionados al estado leído; un pedido cruzado recibe 409
  `turno_modificado` sin evento (`plan.md` §4.7).
- `llegadaEn`: se escribe al pasar a `en_espera`, se limpia al corregir a `reservado`, se conserva
  en lo demás y, al corregir a `en_espera` sin hora previa, se registra la hora de la corrección
  (`plan.md` §2.3).
- Coseguros: al asignar son opcionales; al modificarlos hay que mandar las dos claves (`null` o `""`
  = sin cargar), para no borrar un monto sin querer.
- Una fecha con año `0000` se rechaza con 400 (antes llegaba a la base y daba 500).
- El ticket se genera en cada pedido con los datos vigentes, sin DNI ni coseguros, con
  `Cache-Control: no-store` y un nombre de archivo sin datos personales. La prueba de "después de
  reprogramar" mueve el turno con Prisma directo: **T-24 tiene que agregar ese caso por la API.**
- T-26 recorre todas las rutas (la única `DELETE` permitida es la de cerrar sesión) y busca en `src/`
  borrados de Prisma o SQL sobre las tablas de negocio, leídas del esquema.

**Base de desarrollo:** tiene aplicadas todas las migraciones, incluida
`agregar_evento_modificacion_coseguros`. Puede tener turnos, pacientes y eventos ficticios del
recorrido manual.

**T-24 (#45):** `PUT /api/turnos/:id/ubicacion` con `{ kinesiologoId, fecha, horaInicio }`.
Actualiza condicionado al estado y a la ubicación leídos (`plan.md` §4.7); reprogramar a la misma
ubicación es 409 `reprogramacion_sin_cambio`; RF-36 se amplió: tampoco se reprograma hacia un
kinesiólogo con la cuenta desactivada, aunque sea el mismo del turno, y el 404 dice "no existe o
tiene la cuenta desactivada". Los dobles de prueba de transacciones viven en
`test/integracion/ayudantesTurnos.ts` (`baseConEventoRoto`, `baseConLecturaSincronizada`,
`baseConPausaTrasLeer`). Lección: una barrera que solo sincroniza las lecturas no fija quién escribe
primero; para probar un orden concreto hay que forzar la intercalación.

**T-28 (#44):** `GET /api/agenda/pendientes`; compara en hora de pared de la zona del consultorio
(`Intl.DateTimeFormat`), sin desfases fijos.

---

## 2d. Ola 5: estado al pausar (2026-10-15)

**Fusionado:** T-27 (#48), T-29 (#50), T-30 partes 1 y 2 (#47 y #51) y RNF-14 (#49). Falta la
**parte 3 de T-30**: agenda del kinesiólogo (`GET /api/mi-agenda`, ya existe) y las listas de
próximos e historial en la ficha del paciente (`GET /api/pacientes/:id/turnos`, ya existe). El
usuario lo notó en el recorrido del #51: el kinesiólogo todavía no ve nada.

**Contratos nuevos** (en los comentarios de las rutas):
- `GET /api/agenda?fecha=&kinesiologoId=` (secretaría y administrador) y `GET /api/mi-agenda?fecha=`
  (solo kinesiólogo; el kinesiólogo sale de la sesión, un `kinesiologoId` en la query se ignora):
  `m4-agenda/rutasAgendas.ts`.
- `GET /api/pacientes/:id/turnos` → `{ proximos, historial }` con el mismo criterio de "franja
  transcurrida" que el aviso de pendientes (`franjaTranscurrida` en `m4-agenda/pendientes.ts`).
- Las proyecciones de turno traen `horaLlegada` ('HH:MM' en la zona del consultorio): el frontend
  no tiene ninguna zona horaria fija.

**Decisiones:**
- Autorización de la agenda propia: `puedeLeerAgendaPropia` en `comun/autorizacion.ts` y el
  middleware `autorizarAgendaPropia`. Guardianas nuevas en `rutas.test.ts`: la de agenda propia, su
  inversa (el middleware solo puede estar bajo `/mi-agenda`) y una de mundo cerrado (todo GET de
  negocio lleva alguna autorización; la lista blanca está vacía).
- `comun/esquemas.ts` tiene `fechaCivil` (desde 0001-01-01) e `idDeTexto`, compartidos por todas las
  rutas.
- RNF-14 (decisión del usuario): toda respuesta de `/api` lleva `Cache-Control: no-store`.
- Frontend: `<app-volver-al-inicio>` lleva al inicio del rol de la sesión; `app-dialogo` es un
  diálogo accesible propio; `nucleo/ui/descargar.ts` descarga archivos.
- El usuario va a encargar el **diseño visual** al final; hoy no hay una tarea de estilos en
  `tasks.md`. Hay que agregarla (con su criterio de "hecho") antes de T-33, para que las pruebas de
  punta a punta corran sobre la interfaz final.

**Recorridos manuales:** #47 y #51 pasaron. En el #51 el turno de ayer sin marcar se cargó por la
API desde la consola (la asignación por pantalla solo deja fechas desde hoy).

---

## 3. Decisiones tomadas durante la implementación

Las que cambian requisitos o diseño ya están en la spec o el plan. Esta lista sirve para encontrarlas.

| Decisión | Dónde quedó |
|---|---|
| T-07 incorpora `argon2` (argon2id, parámetros de OWASP) solo para hashear y verificar; la política de contraseñas quedó en T-11. | `m1-identidad/contrasenas.ts` |
| Contrato de sesión: `POST`, `GET` y `DELETE /api/sesion`; `PUT /api/sesion/contrasena`; `usuario.debeCambiarContrasena`. | Comentario de `m1-identidad/rutas.ts` |
| RF-07: cambiar la contraseña cierra las demás sesiones de la cuenta y rechaza repetir la actual (decisión del usuario). | `spec.md` RF-07 y §7, `plan.md` §3 M1 (#13) |
| RNF-02: los intentos fallidos al cambiar la contraseña cuentan para el límite (decisión del usuario). | `spec.md`, `plan.md` y `tasks.md` (#15) |
| Límite de intentos con implementación propia, sin `rate-limiter-flexible`. | `plan.md` §3 M1 (#15) |
| `restablecer-2fa-admin` también cierra las sesiones del administrador (decisión del usuario). | `plan.md` §3 M1, RNF-04 (#14) |
| Campo `ultimoPasoTotp` en `Usuario`. | `plan.md` §2.1 (#17) |
| La autorización por rol vive en un solo lugar (`comun/autorizacion.ts`), y una prueba guardiana exige `autorizarEscritura` en toda ruta de escritura. | `test/integracion/rutas.test.ts` (#12) |
| Dependabot no propone saltos mayores de `@types/node`, Angular y `angular-eslint`, ni saltos mayores o menores de `typescript`. | `.github/dependabot.yml` (#10) |
| `overrides` de `deepmerge-ts` y `mysql2`: el CLI de Prisma 7.10 los trae con vulnerabilidades altas. | `backend/package.json` y README |
| Los códigos del segundo factor cuentan para RNF-02, y para el administrador con TOTP solo la verificación reinicia el contador (decisión del usuario). | `spec.md` RNF-02 y §7, `plan.md` §3 M1 (#17) |
| Contrato de gestión de cuentas (T-13). | `plan.md` §3 M1, viñeta RF-08 / RF-09 (#18) |
| Límite por dirección: reserva antes de argon2, liberación al confirmar, bloqueo desde el rechazo que alcanza el umbral. | `plan.md` §3 M1 (#15) |
| DNI de 7 u 8 dígitos; se aceptan puntos y espacios al ingresarlo y se guarda solo con los dígitos (decisión del usuario). | `spec.md` RF-18, `plan.md` §3 M2 |
| Regla de lectura de M2 en `comun/autorizacion.ts`: consultorio, kinesiólogos y pacientes los leen `secretaria` y `administrador`, no el `kinesiologo` (decisión del usuario). | `plan.md` §3 M2 y §4.8 |
| Alta de kinesiólogo como las cuentas de T-13: temporal elegida por el administrador, cuenta gestionada desde `/api/cuentas`, del perfil solo se cambia el bloque (decisión del usuario). | `plan.md` §3 M2 |
| Contrato de kinesiólogos: `GET /api/kinesiologos?bloque=`, `POST /api/kinesiologos` y `PUT /api/kinesiologos/:id/bloque` (PUT porque el sub-recurso se reemplaza entero). | Comentario de `m2-maestros/rutasKinesiologos.ts` (#26) |
| Contrato de pacientes: alta, edición, ficha y búsqueda por query con DNI o nombre (ver §2b). | Comentario de `m2-maestros/rutasPacientes.ts` (#28) |
| `TurnoEvento` sin `UPDATE` para la aplicación, y conexión a PostgreSQL en UTC (decisión del usuario). | `despliegue.md` §7 y `comun/baseDeDatos.ts` (#30) |
| Kinesiólogo con la cuenta desactivada: sin disponibilidad ni asignación (decisión del usuario). | `spec.md` RF-22, RF-23 y §7, `plan.md` §3 M3 y M4 (#35) |
| El cambio de coseguros se audita como `modificacion_coseguros` (decisión del usuario). | `spec.md` RF-46 y §7.7, `plan.md` §2.1 y §3 M3 (#37) |
| Transiciones y correcciones condicionadas al estado leído; regla de `llegadaEn` al corregir. | `plan.md` §2.3 y §4.7 (#39) |
| Disponibilidad y ticket autorizados con `autorizarEscritura('turnos')`. | Comentarios de `rutasDisponibilidad.ts` (#33) y `rutasTicket.ts` (#38) |
| Dependencias nuevas: `pdfkit` (MIT); `@types/pdfkit` y `jsqr` (Apache-2.0) solo en desarrollo. | `backend/package.json` (#38) |

---

## 4. Deuda y observaciones abiertas

| Tema | Propuesta | Estado |
|---|---|---|
| La sesión de PostgreSQL tiene que estar en UTC: adapter-pg envía las fechas sin desfase. Con otra zona, el bloqueo de T-09 duraría horas de más. | Fijar `timezone=UTC` en la conexión (`DATABASE_URL` o `baseDeDatos.ts`). | Resuelto en #30 |
| `scalekine_app` puede modificar `TurnoEvento` (auditoría, RF-46). | Dejarlo solo con `SELECT` e `INSERT` (`despliegue.md` §7). | Resuelto en #30 |
| `plan.md` §5.2 dice que `FRONTEND_ORIGIN` es "para CORS", pero no hay CORS: se usa para verificar el `Origin` de las escrituras. | Corregir la descripción. | Resuelto en #42 |
| El modelo del frontend (`nucleo/sesion/modelo.ts`) no declara `debeCambiarContrasena` ni el estado del segundo factor (`segundoFactor` y `pasoPendiente` de `/api/sesion`). | Hecho en T-14. | Resuelto en #22 |
| El README indica `docker compose exec api node dist/cli/index.js` para producción. | Confirmarlo cuando exista la imagen. | Pendiente de T-35 |
| Pruebas intermitentes en la máquina local con dos carriles corriendo: un primer argon2 que supera los 15 s del límite y una conexión rechazada por PostgreSQL. En el CI nunca pasó. Además, 4 pruebas de unidad triviales (`configuracion`, `logger`, `seguridad` y `errores`) superaron el límite por defecto de 5 s del proyecto `unidad`: con la caché de transformación fría (después de `npm install` o `prisma generate`) o con la máquina cargada. Repetidas con la máquina libre, pasan las 114, y en el CI nunca fallaron. | Si se repite, subir `testTimeout` de integración o precalentar argon2; para unidad, fijar un `testTimeout` explícito en `vitest.config.ts`. | En observación |
| OneDrive bloquea por momentos escrituras en `.git/objects` ("Permission denied"). | Pausar la sincronización mientras trabajan los carriles, o mover el repositorio fuera de OneDrive. | En observación |
| La guardiana de rutas no detecta una variante del middleware envuelta en un closure (detecta por identidad). | Mantenerlo documentado en el comentario de la guardiana; revisar en code review. | En observación |
| Docker Desktop tiene que estar corriendo para las pruebas de integración locales; un worker lo encendió sin preguntar. Además, encender Docker Desktop no levanta el contenedor `scalekine-postgres-1`: hace falta `docker compose up -d` (o `docker start scalekine-postgres-1`). | Los encargos dicen "no tocar Docker"; si PostgreSQL no responde, el worker lo reporta y frena. | Resuelto en los encargos |
| `.env.example` deja `CLAVE_CIFRADO` vacía, y en desarrollo el backend arranca igual: el error aparece recién al activar el segundo factor ("falta la clave de cifrado"). Pasó en el recorrido manual del #22. | Indicar en el README cómo generarla (`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`) o avisar al arrancar en desarrollo si falta. | Resuelto en #42 (README) |
| La base `scalekine_desarrollo` no recibe sola las migraciones nuevas: al probar el #22 le faltaba la del segundo factor (error P2022). | Correr `npm run db:migrar` en `backend/` después de traer migraciones nuevas. | Anotado |
| PostgreSQL se cortó a ratos durante T-18 (conexiones rechazadas y timeouts). Al repetir, todo pasó. | Si se repite, revisar el contenedor (`docker inspect scalekine-postgres-1`) y la memoria de la máquina. | En observación |
| Con poca memoria libre, Claude Code detiene los procesos en segundo plano, incluidos los servidores de un recorrido manual. | Cerrar lo que no se use antes de un recorrido manual; no relanzarlos sin que el usuario lo pida. | En observación |
| `npm run db:migrar` falló con P1001 contra `localhost:5432` aunque el contenedor respondía: el puerto está publicado solo en `127.0.0.1` y el motor de Prisma probablemente resolvió `::1`. | Usar `127.0.0.1` en lugar de `localhost` en `DATABASE_URL_MIGRACIONES` (y en `.env.example`). | Resuelto en #42 (`.env.example` y README); cada `.env` local se ajusta a mano |
| La suite completa tarda 10 a 15 minutos en local, y con los dos carriles corriendo a la vez aparecen timeouts de 15 s en pruebas ajenas (distintas en cada corrida). Solas pasan, y en el CI nunca fallaron. | Evitar correr las dos suites completas a la vez; confiar en el CI para la corrida completa. | En observación |
| `prettier --check` marca casi todos los archivos (CRLF de Windows y sin configuración de Prettier en el backend). | Decidir si se agrega una configuración de Prettier o se deja de mencionar en los encargos. | Decidido: el backend no usa Prettier (su código no sigue ese formato y agregarlo reformatearía todo). El estilo lo dan ESLint y el código vecino; los encargos dejan de pedir `prettier --check` en el backend. El frontend sí tiene `.prettierrc`. |
| Las pruebas de la ola 4 copian en cada archivo el ayudante `ingresarComo`. | Centralizarlo en `test/integracion/fabricas.ts`. | Sin tarea asignada |
| Un PUT de coseguros exige las dos claves: el frontend de T-30 tiene que mandarlas siempre. | Tenerlo en cuenta en T-30. | Anotado |

---

## 5. Flujo multiagente usado hasta ahora

**Roles:**
- **Orquestador:** una sesión de Claude Code en el checkout principal
  (`C:/Users/fibia/OneDrive/Escritorio/scalekine`). Prepara los carriles, escribe los encargos,
  controla el CI y lanza las revisiones. No implementa tareas.
- **Carriles:** *workflows* de Orca, cada uno con su sesión de Claude Code en un worktree propio
  (`C:/Users/fibia/orca/workspaces/scalekine/<nombre>`, rama `ignaMartin22/<nombre>`). Se usaron
  dos: `axolotl` (carril A) y `quahog` (carril B). Comparten el `.git` del checkout principal.
- **Revisión:** el agente `revisor-seguridad` (`.claude/agents/`, Opus, solo lectura) revisa las
  tareas críticas de `tasks.md` antes de fusionar. Las demás las revisa el orquestador.
- **Usuario:** crea los *workflows*, aprueba permisos, decide los cambios de spec y fusiona los PRs.

**Preparar un carril:**
1. Crear su base de pruebas con `infra/postgres/crear-base-pruebas.sh <carril>`.
2. Copiar al worktree el `.env` de la raíz, apuntando `DATABASE_URL_PRUEBAS` y
   `DATABASE_URL_MIGRACIONES_PRUEBAS` a `scalekine_<carril>_pruebas` y con otro `PORT`. Orca crea
   los worktrees con `git worktree`, así que `.worktreeinclude` no aplica.
3. Correr `npm install` y `npx prisma generate` en `backend/`.

**Estructura de un encargo:** contexto (qué hace el otro carril), preparación (rama desde
`origin/main`), qué leer de la spec y el plan, alcance, criterio de "hecho", reglas (archivos que no
debe tocar, sin migraciones ni dependencias sin consultar, lint, tipos, pruebas y auditoría en
verde, *rebase* antes del PR, no fusionar) y aviso final al orquestador con `SendMessage`, con la
URL del PR y las decisiones tomadas.

**Ciclo de una tarea:**
1. Encargo.
2. PR.
3. CI.
4. Revisión, si la tarea es crítica.
5. Correcciones en la misma rama.
6. El orquestador escribe **"listo para fusionar"**.
7. El usuario fusiona.

Si un PR se fusiona antes de terminar la revisión, las correcciones van en una rama nueva
`<tarea>-ajustes` creada desde `origin/main`, con su propio PR.

**Lecciones:**
- **No usar `git stash` en los carriles:** la pila es común a todos los worktrees y puede mezclar
  cambios de otra sesión.
- **Verificar con `git log` antes del `push`:** con OneDrive, un `git add` fallido encadenado con
  un `push` llegó a publicar una rama vacía.
- **Separar los archivos de cada carril:** cuando dos tareas tocan el mismo módulo, una espera a
  la otra o concentra su lógica en archivos propios y hace *rebase* al final.
- **Dejar `vitest.config.ts` y las fábricas de prueba con cambios mínimos:** son los archivos
  compartidos que más chocan.
- **Cupo:** con el plan Pro y dos carriles más las revisiones con Opus, la ola 1 y la mitad de la
  ola 2 consumieron cerca del 88% de una ventana de 5 horas. Implementar con Sonnet, reservar Opus
  para planificar y revisar, y frenar en un punto seguro antes de agotar el cupo.
- **Agentes que no son Claude Code (por ejemplo, opencode):** no reciben `SendMessage`. El encargo
  se les deja en un archivo del worktree excluido de git, y el usuario avisa al orquestador cuando
  abren el PR.

**Ola 2, segunda parte (subagentes nativos):**
- Esta vez los workers fueron subagentes nativos de Claude Code (Sonnet para implementar, Haiku
  para documentación), cada uno en un worktree de Orca ya preparado, con dos como máximo en
  paralelo. El orquestador eligió el modelo de cada uno, y el usuario no tuvo que pasar mensajes.
- El orquestador no aceptó un reporte sin leer el diff y correr pruebas de mutación: así
  aparecieron una prueba de carrera que no probaba el orden de escritura (T-13) y un reporte que
  no coincidía con el código (T-09).
- La revisión de seguridad encontró, en tres rondas por tarea, defectos que las pruebas no
  cubrían: el oráculo del 409, la ventana renovada, la fuga por tiempo del segundo argon2 y el
  `data: {}` de Prisma.
- Correr `revisor-seguridad` sobre un commit fijo (`git show <sha>:<ruta>`) permitió revisar en
  paralelo mientras el worker corregía.

**Ola 3:**
- Antes de lanzar los carriles se cerraron en la spec y el plan tres huecos que la ola 3 necesitaba
  (#21): el formato del DNI, quién lee los datos maestros y el contrato del alta de kinesiólogo.
- Cada carril recibe una sola tarea (o un solo PR) por encargo; el siguiente se lanza cuando el
  anterior está fusionado, porque las tareas de un carril se apoyan en las anteriores.
- **No correr `prettier --write` sobre carpetas enteras:** el backend no tiene configuración de
  prettier, y un worker reformateó unos 60 archivos con comillas dobles (lo deshizo antes de
  commitear). Los encargos ahora lo prohíben.
- Para el recorrido manual de una tarea de frontend, el orquestador levanta backend y `ng serve`
  desde el worktree del carril (el proxy apunta al puerto 3000), instala el sistema en
  `scalekine_desarrollo` con el CLI y crea cuentas ficticias. En Windows, detener la tarea de
  `npx` puede dejar vivo el proceso `node`: verificar qué proceso escucha en el puerto.

- Para levantar los servidores de un recorrido manual, usar `node` directo y no `npx`: en Windows,
  detener `npx` deja vivo el `node` hijo ocupando el puerto. Backend:
  `PORT=3000 node --import tsx --env-file=../.env src/servidor.ts` en `backend/`. Frontend:
  `node node_modules/@angular/cli/bin/ng.js serve --port 4200` en `frontend/`.
- La revisión de los PRs no críticos tuvo dos pasos: el carril corre las mutaciones que pide el
  encargo, y el orquestador agrega las suyas antes de declarar el PR listo para fusionar. En la
  ola 3, ninguna mutación sobrevivió.

- En las tareas críticas, el revisor corre la suite sobre una copia exportada de la rama y una base
  propia, sin tocar los worktrees, y verifica cosas fuera de la suite (el SQL real que emite Prisma,
  carreras repetidas). Encontró en T-22 un 500 por una fecha del año 0000 y en T-23 dos reglas que
  faltaban en el plan.

**Para retomar:**
1. Encender Docker Desktop y verificar `scalekine-postgres-1`.
2. Carril B: **T-30 parte 3** (agenda del kinesiólogo y próximos/historial en la ficha); lleva
   recorrido manual del usuario. Con eso cierra la ola 5.
3. Carril A: ola 6, **T-31 (difusión en tiempo real)**. Se puede adelantar en paralelo con la
   parte 3 (solo toca el backend), si el usuario lo aprueba; después T-32 (agenda viva).
4. Agregar a `tasks.md` la tarea de diseño visual, antes de T-33.
