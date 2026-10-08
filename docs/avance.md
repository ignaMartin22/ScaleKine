# Avance de la implementación

Estado al 2026-10-08, con la ola 2 a medias. Este documento registra qué está hecho, qué quedó a
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
| T-08 · Autorización por rol | Hecha | #12 | Incluye la prueba guardiana de rutas (ver §5). |
| T-09 · Límite de intentos | **En revisión, bloqueada** | #15, rama `t-09-limite-intentos` | Faltan pruebas pedidas por la revisión. Ver §2. |
| T-10 · CLI de instalación | Hecha | #14 | |
| T-11 · Contraseñas | Hecha | #11 y #13 | El #13 aplica dos rondas de revisión de seguridad. |
| T-12 · Segundo factor | **En curso, parcial** | rama `t-12-segundo-factor`, commit `a903f9c`, sin PR | Ver §3. |
| T-13 · Gestión de cuentas | Pendiente | — | Ver §4. |
| T-15 · Grilla | Hecha | #6 | Adelantada a la ola 1, porque es un módulo puro. |
| T-20 · Tabla de transiciones | Hecha | #7 | Adelantada a la ola 1, porque es un módulo puro. |
| T-14, T-16 a T-19, T-21 a T-40 | Pendientes | — | Olas 3 a 7 de `tasks.md`. |

Otros PRs fusionados:
- #10 vuelve `@types/node` a la versión 24 y limita los saltos de versión que propone Dependabot.
- #3 y #4 son de Dependabot.
- El #5 (TypeScript 7 en el frontend) se cerró: Angular 22 exige TypeScript `~6.0`.

---

## 2. T-09: correcciones pendientes del PR #15

**Qué hace el PR:**
- Actualiza RNF-02 en la spec (§3.9 y §7), el plan y `tasks.md` con la decisión del usuario: los
  intentos fallidos de la contraseña actual al cambiarla cuentan igual que los ingresos fallidos.
- Implementa el límite sobre la tabla `limite_intentos`, sin `rate-limiter-flexible`, porque esa
  librería usa `Date.now()` y no admite el reloj inyectable.
- **Por dirección:** un bloqueo responde 429 `demasiados_intentos` antes de leer la cuenta.
- **Por cuenta:** un único `UPDATE` atómico suma el fallo y, al quinto, bloquea
  15 min × 2^`bloqueosConsecutivos`.
- Un rechazo con la cuenta bloqueada es indistinguible del de credenciales inválidas, también en
  el tiempo de respuesta.
- Exporta `SIN_BLOQUEO` desde `m1-identidad/index.ts`, para que lo usen los restablecimientos.

**Veredicto de la revisión de seguridad:** bloquea solo por pruebas. No encontró defectos de
seguridad en el código.

**Correcciones obligatorias:**
1. En `backend/test/integracion/limite-intentos.test.ts`, en el bloque del cambio de contraseña
   (líneas ~274-323), agregar las pruebas con reloj inyectable del borde del primer bloqueo
   (15 min − 1 ms y 15 min exactos) y del segundo bloqueo de 30 min. Alcanza con copiar las del
   ingreso usando `cambiar(...)` en lugar de `fallar(...)`.
2. Probar las condiciones nuevas `OR bloqueadoHasta null/lte ahora` de `servicio.ts` (líneas ~92 y
   ~201): un espía sobre `findUnique` que bloquee la cuenta en el medio, como las pruebas de carrera
   de T-11, para comprobar que un bloqueo concurrente no deja crear una sesión.
3. **Rebase sobre `main`:** el #14 (T-10) ya está fusionado. `restablecer-admin`
   (`backend/src/cli/comandos.ts`) tiene que pasar a usar `...SIN_BLOQUEO` en lugar de poner los
   tres campos en cero a mano.

**Menores, para la misma ronda:**
- Reservar el punto de la dirección antes de argon2 (`INSERT … RETURNING points`). Hoy una ráfaga
  paralela desde una misma IP pasa el chequeo antes de que se registre ningún fallo y supera los 20
  por ventana; el límite por cuenta igual la corta.
- Anotar en `plan.md` §3 M1 que la clave es la IP exacta, así que una IPv6 puede rotar dentro de
  su /64.
- Corregir el comentario de `LimiteIntentos` en `schema.prisma`, que todavía nombra a
  `rate-limiter-flexible`.
- No guardar IPs más de lo necesario: hoy las filas vencidas se borran solo cuando llega otro fallo
  y quedan en las copias diarias. Borrarlas también al chequear, o guardar un HMAC de la IP.
- Ajustar la frase de RNF-02 "igual al de credenciales inválidas": en el cambio de contraseña el
  rechazo es el 403 `contrasena_actual_incorrecta`.
- Mover "el restablecimiento levanta el bloqueo" al criterio de "hecho" de T-13, que es donde se
  implementa.

Después de corregir, el PR vuelve a pasar por `revisor-seguridad`.

---

## 3. T-12: estado del avance parcial

Rama `t-12-segundo-factor`, commit `a903f9c` ("T-12: avance parcial (en curso)"), creada sobre
`main` antes de T-10. Todavía no tiene código de la funcionalidad.

**Hecho:**
- Dependencias con versión exacta: `otplib` 13.5.0, `qrcode` 1.5.4 y `@types/qrcode` 1.5.6. Las dos
  primeras ya estaban previstas en el plan (§3 M1 y §4.11).
- Campo `Usuario.ultimoPasoTotp Int?`, con su migración aditiva
  `20261007235900_agregar_ultimo_paso_totp` (solo `ALTER TABLE … ADD COLUMN`) y su línea en
  `plan.md` §2.1. La aprobó el orquestador: sirve para que un mismo código TOTP no se reutilice
  dentro de su ventana, y no hace falta tocar permisos.

**Diseño ya decidido, pendiente de escribir:**
1. **Un único mecanismo de "paso pendiente" en `middleware.ts`.** El paso de una sesión, en orden:
   - `verificar_segundo_factor`: administrador con TOTP activo y sesión sin verificar;
   - `cambiar_contrasena`;
   - `activar_segundo_factor`: administrador sin TOTP activo;
   - ninguno.

   Cada variante del middleware declara qué pasos admite:

   | Variante | Pasos que admite |
   |---|---|
   | `exigirSesion` | solo "ninguno" |
   | `GET /sesion` | cualquiera |
   | `PUT /sesion/contrasena` | "ninguno" o `cambiar_contrasena` |
   | Activación | solo `activar_segundo_factor` |
   | Verificación | solo `verificar_segundo_factor` |

   - Códigos 403: `debe_verificar_segundo_factor`, `debe_cambiar_contrasena` y
     `debe_activar_segundo_factor`.
   - Un `WeakMap` de handler a pasos admitidos reemplaza al `WeakSet` actual, y la guardiana de
     `test/integracion/rutas.test.ts` se extiende para fijar dónde aparece cada variante.
2. **`segundoFactor.ts` propio.**
   - Cifrado AES-256-GCM con `config.claveCifrado`, en formato `v1:iv:tag:texto`, con el id de
     usuario como dato asociado. Sin clave configurada, error de negocio claro.
   - Activación en dos pasos:
     - `POST /api/sesion/segundo-factor/activacion` devuelve el QR como `data:`;
     - `POST …/activacion/confirmar`, con un código válido, activa el TOTP, deja la sesión
       verificada y devuelve los 10 códigos de recuperación una sola vez.
   - Verificación con `POST …/verificar`: 6 dígitos se toman como TOTP y cualquier otra cosa como
     código de recuperación.
   - Los códigos de recuperación se guardan con hash SHA-256 (son de alta entropía) y se quitan
     con una escritura condicionada a la lista leída.
   - El TOTP usa el reloj inyectable y una tolerancia de un paso, con escritura condicionada
     `ultimoPasoTotp IS NULL OR < paso del código aceptado`.
3. **Cambios mínimos en `servicio.ts` y `rutas.ts`:** `totpActivo` y `segundoFactorVerificado` en
   la sesión. `/api/sesion` informa `segundoFactor` (`no_requerido`, `sin_activar`,
   `sin_verificar` o `verificado`) y `pasoPendiente`.
4. **Pruebas:**
   - activación con el secreto cifrado en la base;
   - ingreso con código válido e inválido;
   - código de recuperación usado dos veces y en simultáneo;
   - TOTP repetido y en simultáneo;
   - bloqueo de las demás rutas;
   - secretaría y kinesiólogo sin segundo factor;
   - `restablecer-2fa-admin`.

**Al retomar:**
1. Hacer *rebase* sobre `main` con T-09 ya fusionada.
2. Conectar los códigos fallidos al contador de T-09.
3. Hacer que `restablecer-2fa-admin` deje también `ultimoPasoTotp` en null.
4. Agregar a `.env.example` una nota sobre `CLAVE_CIFRADO` en desarrollo.
5. Abrir el PR, que pasa por `revisor-seguridad`.

---

## 4. T-13: indicaciones acumuladas antes de empezar

Surgieron de las revisiones de T-09, T-10 y T-11:

- **Orden de escritura en el restablecimiento (RF-08) y la desactivación (RF-09):** primero la fila
  de `Usuario` y después la revocación de sesiones, dentro de la misma transacción. Al revés, un
  ingreso que confirme en el medio deja una sesión viva. `restablecer-admin` y
  `restablecer-2fa-admin` (T-10) ya siguen ese orden.
- **Reutilizar lo existente:**
  - `validarPoliticaContrasena` (T-11), para la contraseña temporal;
  - `SIN_BLOQUEO` (T-09), porque el restablecimiento levanta el bloqueo; agregar este punto a su
    criterio de "hecho";
  - `autorizarEscritura('cuentas')` después de `exigirSesion`, el bloqueante, en cada ruta de
    escritura.
- **Prueba guardiana:** hoy no detecta un `router.use(...)` de la variante permisiva a nivel de
  router. Conviene que T-13 la extienda, porque va a montar rutas en el router de identidad.
- La escritura del cambio de contraseña ya está condicionada al hash leído (T-11), así que un
  restablecimiento concurrente no queda pisado.

---

## 5. Decisiones tomadas durante la implementación

Las que cambian requisitos o diseño ya están en la spec o el plan. Esta lista sirve para encontrarlas.

| Decisión | Dónde quedó |
|---|---|
| T-07 incorpora `argon2` (argon2id, parámetros de OWASP) solo para hashear y verificar; la política de contraseñas quedó en T-11. | `m1-identidad/contrasenas.ts` |
| Contrato de sesión: `POST`, `GET` y `DELETE /api/sesion`; `PUT /api/sesion/contrasena`; `usuario.debeCambiarContrasena`. | Comentario de `m1-identidad/rutas.ts` |
| RF-07: cambiar la contraseña cierra las demás sesiones de la cuenta y rechaza repetir la actual (decisión del usuario). | `spec.md` RF-07 y §7, `plan.md` §3 M1 (#13) |
| RNF-02: los intentos fallidos al cambiar la contraseña cuentan para el límite (decisión del usuario). | `spec.md`, `plan.md` y `tasks.md` (#15, sin fusionar) |
| Límite de intentos con implementación propia, sin `rate-limiter-flexible`. | `plan.md` §3 M1 (#15, sin fusionar) |
| `restablecer-2fa-admin` también cierra las sesiones del administrador (decisión del usuario). | `plan.md` §3 M1, RNF-04 (#14) |
| Campo `ultimoPasoTotp` en `Usuario`. | `plan.md` §2.1 (rama de T-12) |
| La autorización por rol vive en un solo lugar (`comun/autorizacion.ts`), y una prueba guardiana exige `autorizarEscritura` en toda ruta de escritura. | `test/integracion/rutas.test.ts` (#12) |
| Dependabot no propone saltos mayores de `@types/node`, Angular y `angular-eslint`, ni saltos mayores o menores de `typescript`. | `.github/dependabot.yml` (#10) |
| `overrides` de `deepmerge-ts` y `mysql2`: el CLI de Prisma 7.10 los trae con vulnerabilidades altas. | `backend/package.json` y README |

---

## 6. Deuda y observaciones abiertas

| Tema | Propuesta | Estado |
|---|---|---|
| La sesión de PostgreSQL tiene que estar en UTC: adapter-pg envía las fechas sin desfase. Con otra zona, el bloqueo de T-09 duraría horas de más. | Fijar `timezone=UTC` en la conexión (`DATABASE_URL` o `baseDeDatos.ts`). | Sin tarea asignada |
| `scalekine_app` puede modificar `TurnoEvento` (auditoría, RF-46). | Dejarlo solo con `SELECT` e `INSERT` (`despliegue.md` §7). | Propuesta sin decidir |
| `plan.md` §5.2 dice que `FRONTEND_ORIGIN` es "para CORS", pero no hay CORS: se usa para verificar el `Origin` de las escrituras. | Corregir la descripción. | Propuesta sin decidir |
| El modelo del frontend (`nucleo/sesion/modelo.ts`) no declara `debeCambiarContrasena` ni el estado del segundo factor. | Hacerlo en T-14. | Pendiente de T-14 |
| El README indica `docker compose exec api node dist/cli/index.js` para producción. | Confirmarlo cuando exista la imagen. | Pendiente de T-35 |
| Pruebas intermitentes en la máquina local con dos carriles corriendo: un primer argon2 que supera los 15 s del límite y una conexión rechazada por PostgreSQL. En el CI nunca pasó. | Si se repite, subir `testTimeout` de integración o precalentar argon2. | En observación |
| OneDrive bloquea por momentos escrituras en `.git/objects` ("Permission denied"). | Pausar la sincronización mientras trabajan los carriles, o mover el repositorio fuera de OneDrive. | En observación |

---

## 7. Flujo multiagente usado hasta ahora

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

**Para retomar la ola 2:**
1. Correcciones de T-09 (§2), nueva revisión y fusión.
2. Terminar T-12 sobre `main` con T-09 (§3), revisión y fusión.
3. T-13 (§4).
