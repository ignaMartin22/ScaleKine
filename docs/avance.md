# Avance de la implementación

Estado al 2026-10-08, con la ola 2 terminada. Este documento registra qué está hecho, qué quedó a
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
| T-14, T-16 a T-19, T-21 a T-40 | Pendientes | — | Olas 3 a 7 de `tasks.md`. |

Otros PRs fusionados:
- #10 vuelve `@types/node` a la versión 24 y limita los saltos de versión que propone Dependabot.
- #16 documenta el avance al pausar la ola 2.
- #3 y #4 son de Dependabot.
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

---

## 4. Deuda y observaciones abiertas

| Tema | Propuesta | Estado |
|---|---|---|
| La sesión de PostgreSQL tiene que estar en UTC: adapter-pg envía las fechas sin desfase. Con otra zona, el bloqueo de T-09 duraría horas de más. | Fijar `timezone=UTC` en la conexión (`DATABASE_URL` o `baseDeDatos.ts`). | Sin tarea asignada |
| `scalekine_app` puede modificar `TurnoEvento` (auditoría, RF-46). | Dejarlo solo con `SELECT` e `INSERT` (`despliegue.md` §7). | Propuesta sin decidir |
| `plan.md` §5.2 dice que `FRONTEND_ORIGIN` es "para CORS", pero no hay CORS: se usa para verificar el `Origin` de las escrituras. | Corregir la descripción. | Propuesta sin decidir |
| El modelo del frontend (`nucleo/sesion/modelo.ts`) no declara `debeCambiarContrasena` ni el estado del segundo factor (`segundoFactor` y `pasoPendiente` de `/api/sesion`). | Hacerlo en T-14. | Pendiente de T-14 |
| El README indica `docker compose exec api node dist/cli/index.js` para producción. | Confirmarlo cuando exista la imagen. | Pendiente de T-35 |
| Pruebas intermitentes en la máquina local con dos carriles corriendo: un primer argon2 que supera los 15 s del límite y una conexión rechazada por PostgreSQL. En el CI nunca pasó. Además, 4 pruebas de unidad triviales (`configuracion`, `logger`, `seguridad` y `errores`) superaron el límite por defecto de 5 s del proyecto `unidad`: con la caché de transformación fría (después de `npm install` o `prisma generate`) o con la máquina cargada. Repetidas con la máquina libre, pasan las 114, y en el CI nunca fallaron. | Si se repite, subir `testTimeout` de integración o precalentar argon2; para unidad, fijar un `testTimeout` explícito en `vitest.config.ts`. | En observación |
| OneDrive bloquea por momentos escrituras en `.git/objects` ("Permission denied"). | Pausar la sincronización mientras trabajan los carriles, o mover el repositorio fuera de OneDrive. | En observación |
| La guardiana de rutas no detecta una variante del middleware envuelta en un closure (detecta por identidad). | Mantenerlo documentado en el comentario de la guardiana; revisar en code review. | En observación |
| Docker Desktop tiene que estar corriendo para las pruebas de integración locales; un worker lo encendió sin preguntar. | Los encargos dicen "no tocar Docker"; si no está corriendo, el worker lo reporta. | Resuelto en los encargos |

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

**Para retomar la ola 2:**
La ola 2 está terminada. Sigue la ola 3 de `tasks.md`: T-16 → T-17 → T-18 en el carril A y T-14
en el carril B.
