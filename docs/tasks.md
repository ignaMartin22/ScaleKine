# Tareas — Sistema de Turnos para Kinesiología

Desglose de [`plan.md`](./plan.md) y [`despliegue.md`](./despliegue.md) en tareas ejecutables,
siguiendo el orden de construcción del plan (§7). Cada tarea declara los RF y RNF que cubre y su
criterio de "hecho". Una tarea no está terminada si sus pruebas no pasan.

**Convenciones**

- Cada tarea es un PR (o un commit, si se trabaja solo) que deja `main` funcionando.
- **Hecho** significa: pruebas del nivel indicado en verde, y los criterios de `spec.md` §7 que
  cubre se pueden verificar.
- Las tareas de frontend (`F`) van después de la de backend (`B`) que consumen. Back y front pueden
  avanzar en paralelo dentro de una misma fase (ver "Trabajo en paralelo").
- Si una tarea revela una contradicción con la spec, se frena y se corrige primero la spec.
- Nunca se usan datos reales de pacientes fuera de producción: las pruebas y el desarrollo usan datos
  ficticios.

---

## Trabajo en paralelo

Las tareas se reparten en **carriles**: cada carril es un worktree con su rama y su PR, y trabaja
una tarea por vez. Una ola empieza cuando las tareas de las que depende están fusionadas en `main`.

| Ola | Carril A (camino crítico) | Carril B | Depende de |
|---|---|---|---|
| 1 | T-07 | T-15 → T-20 | Fase 0 |
| 2 | T-08 → T-09 → T-13 | T-11 → T-10 → T-12 | T-07. T-10 y T-12 necesitan T-11; T-13, T-08 y T-11 |
| 3 | T-16 → T-17 → T-18 | T-14 | Backend de la fase 1 |
| 4 | T-22 → T-23 → T-24 | T-19 → T-21 → T-25 → T-26 | Fase 2, T-15 y T-20. T-25 necesita T-22 |
| 5 | T-27 → T-29 | T-28 → T-30 | Fase 3 |
| 6 | T-31 → T-32 | T-35 → T-37 | Fase 4 |
| 7 | T-33 → T-34 | T-36 → T-38 → T-39 | Todo lo anterior |
| — | T-40 | — | Todo |

**Reglas:**

- **Base de pruebas propia.** Las pruebas de integración vacían su base entre caso y caso, así que
  cada carril usa la suya: `infra/postgres/crear-base-pruebas.sh <carril>` crea
  `scalekine_<carril>_pruebas`, y el `.env` del worktree apunta ahí. Si el carril levanta
  servidores, usa otros puertos (`PORT` y el de `ng serve`).
- **Migraciones de a una.** Solo un carril por vez modifica `schema.prisma` o `prisma/migrations`.
- **Lockfiles.** Si dos carriles agregan dependencias, el segundo hace *rebase* sobre `main` y
  regenera `package-lock.json` con `npm install`; nunca se resuelve el conflicto a mano.
- **T-22, T-23 y T-24 van en un solo carril**: escriben el mismo servicio de `m3-turnos`.
- **Antes del PR**, el carril hace *rebase* sobre `main`. Las tareas que tocan sesiones,
  contraseñas, segundo factor, escrituras de turnos, tiempo real o seguridad (T-07, T-09, T-11,
  T-12, T-22, T-23, T-24, T-31, T-34) pasan además por el agente `revisor-seguridad` antes de
  fusionarse.

---

## Fase 0 · Base del repositorio

### T-01 · Estructura del monorepo
- `backend/`, `frontend/`, `e2e/`, `infra/`, `docker-compose.yml` con PostgreSQL (una base de
  desarrollo y una de pruebas), `.gitignore` (incluye todos los `.env*` salvo los de ejemplo),
  `.editorconfig`, y `.env.example` con las variables de `plan.md` §5.2.
- Versión de Node LTS fijada en `.nvmrc` y en `engines`.
- **Hecho:** `docker compose up -d` levanta PostgreSQL; el README explica cómo.

### T-02 · Esqueleto del backend
- Express + TypeScript y carga de configuración validada al arrancar: falla si falta `ZONA_HORARIA`
  o, en producción, `CLAVE_CIFRADO`.
- **Reloj inyectable** y manejo centralizado de errores: código y mensaje de negocio, nunca trazas.
- `helmet` (CSP, `frame-ancestors 'none'`, HSTS), verificación de `Origin` en escrituras, límite de
  100 kB por petición, validación con `zod` como middleware reutilizable.
- `pino` con redacción de datos personales y URLs registradas sin parámetros de consulta.
- Endpoint `/api/salud` sin datos y Vitest configurado.
- **RF/RNF:** RF-12, RNF-08, RNF-10.
- **Hecho:** pruebas de que las cabeceras de seguridad están presentes, de que una escritura con
  `Origin` ajeno se rechaza, de que un error no expone la traza, y de que un campo `dni` sale
  redactado en el log.

### T-03 · Esquema de datos y permisos
- `schema.prisma` con `Usuario`, `Sesion`, `Consultorio`, `Kinesiologo`, `Paciente`, `Turno` y
  `TurnoEvento` (`plan.md` §2.1), incluidos los campos de bloqueo, TOTP y vencimiento de sesión.
  Enums de rol, bloque, estado y tipo de evento. Montos de coseguro decimales.
- Migración SQL manual con los dos índices únicos parciales (`plan.md` §2.3, §4.14).
- Migración de permisos para `scalekine_app` (sin `DELETE` salvo `Sesion` y límite de intentos) y
  `scalekine_respaldo` (solo lectura), según `despliegue.md` §7. Script de inicialización que crea
  los mismos tres usuarios en el PostgreSQL de Docker.
- **RF/RNF:** RF-29, RF-38, RNF-09.
- **Hecho:** las migraciones aplican sobre una base vacía, y los servicios de desarrollo se conectan
  con `scalekine_app`.

### T-04 · Arnés de pruebas de integración
- Vitest contra la base de pruebas: migración al inicio, limpieza entre pruebas y fábricas de datos
  ficticios (usuario, kinesiólogo, paciente, turno).
- Pruebas de los índices parciales: rechazan un segundo turno activo del mismo kinesiólogo y del
  mismo paciente, y aceptan dos kinesiólogos distintos en la misma franja.
- Pruebas de permisos: `scalekine_app` no puede ejecutar `DELETE` sobre `Turno` ni alterar el
  esquema.
- **RF/RNF:** RF-24, RF-25, RF-39, RNF-09 (garantías del esquema).
- **Hecho:** las pruebas pasan contra PostgreSQL real.

### T-05 · Esqueleto del frontend
- Angular con rutas por rol (`/admin`, `/secretaria`, `/kinesiologo`), guardas de ruta, cliente HTTP
  con cookies, manejo de errores de la API y layout base.
- Build de producción compatible con la CSP de `despliegue.md` §6.2: sin scripts en línea, con
  `inlineCritical: false`.
- **RF/RNF:** RNF-10.
- **Hecho:** la app compila y navega entre rutas vacías. Servido con la CSP de producción, la consola
  no muestra violaciones.

### T-06 · Integración continua
- GitHub Actions en cada PR: lint, compilación, pruebas de unidad e integración con PostgreSQL de
  servicio, y `npm audit --audit-level=high` que hace fallar el pipeline. Dependabot semanal.
- **RF/RNF:** RNF-11.
- **Hecho:** un PR muestra el pipeline en verde, y una dependencia vulnerable a propósito lo pone en
  rojo.

---

## Fase 1 · Identidad, acceso y seguridad de cuentas (M1)

### T-07 · B · Sesiones
- Login con mensaje genérico ante credenciales inválidas.
- Cookie opaca `Secure`, `HttpOnly` y `SameSite=Strict`; en la base se guarda el hash del token.
- Vencimiento a las 12 horas de iniciada, sin vencimiento por inactividad. Logout que revoca.
- **RF/RNF:** RF-01, RF-02, RF-10, RF-11, RNF-01 (cookie).
- **Hecho:** pruebas de integración de login correcto e incorrecto (mismo mensaje para usuario y
  contraseña), logout que invalida la cookie, y sesión rechazada al pasar las 12 horas (reloj
  inyectable).

### T-08 · B · Autorización por rol
- Middleware único que declara qué módulos escribe cada rol (`plan.md` §4.8): `administrador` todos;
  `secretaria` pacientes, consultorio y turnos; `kinesiologo` ninguno. El rol se lee de la sesión.
- **RF/RNF:** RF-03.
- **Hecho:** matriz de integración rol × módulo de escritura.

### T-09 · B · Límite de intentos
- Bloqueo por cuenta (5 fallos → 15 minutos, cada bloqueo siguiente dura el doble) y por IP (20
  fallos en 15 minutos → 15 minutos), con `rate-limiter-flexible` sobre PostgreSQL. El
  restablecimiento de contraseña levanta el bloqueo de la cuenta.
- **RF/RNF:** RNF-02.
- **Hecho:** pruebas de integración de ambos umbrales y de la duración creciente, con reloj
  inyectable. El mensaje es idéntico exista o no la cuenta.

### T-10 · B · Comando de instalación y operación
- CLI con estos subcomandos:
  - `instalar`: crea el administrador con contraseña temporal, impresa una sola vez, y el
    consultorio.
  - `restablecer-admin`: regenera la contraseña temporal del administrador.
  - `restablecer-2fa-admin`: desactiva su segundo factor para que lo vuelva a activar.
  - `revocar-sesiones`: revoca todas las sesiones, para responder a incidentes (`despliegue.md` §12).
- **RF/RNF:** RF-05, RNF-04 (recuperación).
- **Hecho:** pruebas de integración de cada subcomando sobre una base vacía o poblada.

### T-11 · B · Contraseñas
- `argon2id`, mínimo de 12 caracteres y rechazo de contraseñas comunes, con la misma validación al
  crear, cambiar y restablecer.
- Bloqueo de toda petición, salvo cambio de contraseña y logout, mientras la cuenta esté marcada.
  Cambio de la propia contraseña con la actual.
- **RF/RNF:** RF-06, RF-07, RNF-03.
- **Hecho:** pruebas de integración: una cuenta marcada recibe rechazo en cualquier otro endpoint y
  queda libre al cambiar la contraseña; las contraseñas cortas o comunes se rechazan.

### T-12 · B · Segundo factor del administrador
- Activación de TOTP: devuelve el QR para la app autenticadora y 10 códigos de recuperación que se
  muestran una sola vez.
- Verificación en cada ingreso; los códigos de recuperación son de un solo uso.
- Secreto cifrado con AES-256-GCM. Una sesión de administrador sin el segundo factor verificado
  solo accede a la verificación.
- **RF/RNF:** RNF-04.
- **Hecho:** pruebas de integración de activación, ingreso con código válido e inválido, código de
  recuperación usado dos veces (rechazado) y bloqueo de la sesión sin verificar.

### T-13 · B · Gestión de cuentas
- El administrador crea cuentas de secretaría con contraseña temporal, restablece contraseñas y
  desactiva cuentas. Restablecer y desactivar revocan las sesiones de la cuenta en la misma
  transacción.
- **RF/RNF:** RF-04, RF-08, RF-09.
- **Hecho:** pruebas de integración de cada operación, incluida la revocación de sesiones abiertas.

### T-14 · F · Acceso y administración de cuentas
- Login, cambio obligatorio de contraseña, activación y verificación del segundo factor (con
  descarga o impresión de los códigos de recuperación), cambio de contraseña desde el menú,
  redirección por rol, vuelta al login cuando la sesión vence, y listado de cuentas del
  administrador con alta, restablecimiento y desactivación.
- **RF/RNF:** RF-01, RF-04, RF-06 … RF-11, RNF-04.
- **Hecho:** recorrido manual completo con las tres cuentas, incluido el primer ingreso del
  administrador con activación del segundo factor.

---

## Fase 2 · Datos maestros (M2)

### T-15 · B · Grilla
- Módulo puro con:
  - Horas de inicio por bloque: seis a la mañana, la última a las 11:45; cuatro a la tarde.
  - Duración de 45 minutos.
  - Días hábiles de lunes a viernes, como parámetro.
  - Cálculo del fin de una franja.
- **RF/RNF:** RF-15.
- **Hecho:** pruebas de unidad, incluidos sábado y domingo sin franjas.

### T-16 · B · Consultorio
- Lectura y edición de nombre, dirección y teléfono por `secretaria` y `administrador`.
- **RF/RNF:** RF-13.
- **Hecho:** pruebas de integración de edición y del rechazo para `kinesiologo`.

### T-17 · B · Kinesiólogos
- Alta de `Usuario` + `Kinesiologo` en una transacción (administrador), cambio de bloque y listado
  por bloque.
- **RF/RNF:** RF-14, RF-16.
- **Hecho:** pruebas de integración: el alta crea las dos filas o ninguna, y cambiar de bloque no
  toca turnos.

### T-18 · B · Pacientes
- Alta con DNI, nombre y apellido, teléfono y obra social obligatorios.
- Validación del formato de DNI y edición con revalidación.
- Búsqueda exacta por DNI y parcial por nombre.
- **RF/RNF:** RF-17, RF-18, RF-19, RF-20, RF-21 (búsqueda).
- **Hecho:** pruebas de unidad del formato de DNI y de integración de unicidad, edición y búsqueda.

### T-19 · F · Consultorio, kinesiólogos y pacientes
- Pantalla de datos del consultorio.
- Alta y edición de kinesiólogos (administrador).
- Sección **Pacientes** con buscador y ficha de datos editable. Las listas de turnos llegan en T-30.
- **RF/RNF:** RF-13, RF-14, RF-16, RF-17, RF-20, RF-21.
- **Hecho:** recorrido manual de cada pantalla.

---

## Fase 3 · Ciclo de vida del turno y auditoría (M3 + M6)

### T-20 · B · Tabla de transiciones
- Tabla declarativa del flujo normal (cuatro filas), consulta de las acciones disponibles por estado
  y rol, y mensajes de rechazo.
- **RF/RNF:** RF-29, RF-34.
- **Hecho:** prueba de unidad exhaustiva, 5 × 5 estados × 3 roles: se aceptan exactamente las cuatro
  filas.

### T-21 · B · Disponibilidad
- Dada una fecha, un bloque y un paciente opcional, devuelve los kinesiólogos del bloque con sus
  franjas libres.
- **RF/RNF:** RF-22, RF-15.
- **Hecho:** prueba de unidad del cálculo y prueba de integración con turnos activos y cerrados.

### T-22 · B · Asignar
- Valida los datos y el bloque, crea el turno en `reservado` con sus coseguros y escribe el
  `TurnoEvento` de asignación en la misma transacción.
- Traduce la violación de índice a "franja ocupada" o a "el paciente ya tiene turno en esa franja".
- Admite fechas vencidas.
- **RF/RNF:** RF-23, RF-24, RF-25, RF-26, RF-46.
- **Hecho:** pruebas de integración de cada rechazo y del evento escrito.

### T-23 · B · Transiciones, corrección y coseguros
- `transicionar`: escribe `llegada_en` al pasar a `en_espera`.
- `corregir`: lleva el turno a cualquier estado, con evento de tipo `correccion`, y limpia
  `llegada_en` al volver a `reservado`.
- `modificarCoseguros`.
- **RF/RNF:** RF-27, RF-30, RF-31, RF-32, RF-33, RF-35, RF-37, RF-38, RF-46.
- **Hecho:** pruebas de integración de:
  - Cada transición del flujo normal.
  - Una corrección desde un estado cerrado hacia uno activo, sobre una franja ocupada (rechazada) y
    sobre una libre (aceptada).
  - Los eventos de auditoría de cada operación.

### T-24 · B · Reprogramar
- Mueve un turno `reservado` a otra fecha, franja o kinesiólogo del bloque correspondiente.
- Rechaza si el turno no está `reservado` o si la franja nueva está ocupada.
- Escribe el evento sin la ubicación anterior.
- **RF/RNF:** RF-36, RF-37, RF-46.
- **Hecho:** pruebas de integración de los casos válidos y de los tres rechazos.

### T-25 · B · Ticket
- Endpoint que genera el PDF con `qrcode` + `pdfkit` a partir del turno y del consultorio vigentes.
- El QR lleva número de turno, paciente, kinesiólogo, fecha y hora en texto, sin DNI ni coseguros.
- **RF/RNF:** RF-28.
- **Hecho:** prueba de integración que decodifica el QR del PDF generado, antes y después de
  reprogramar y de cambiar los datos del consultorio.

### T-26 · B · Sin borrado
- Verifica que no haya ruta ni método de servicio que elimine turnos o cuentas.
- **RF/RNF:** RF-39, RF-09.
- **Hecho:** prueba de integración que recorre las rutas registradas y no encuentra `DELETE` sobre
  turnos ni cuentas. Se suma a la prueba de permisos de T-04.

---

## Fase 4 · Agenda y ficha (M4 + M6)

### T-27 · B · Agendas
- Agenda de secretaría: todos los turnos por fecha y kinesiólogo, con la proyección completa y las
  acciones disponibles.
- Agenda del kinesiólogo: solo sus turnos, filtrados por la sesión, separados en espera y próximos,
  sin acciones.
- Rechazo para el kinesiólogo de la búsqueda de pacientes, la ficha y el historial.
- **RF/RNF:** RF-40, RF-41, RF-03 (lecturas del kinesiólogo).
- **Hecho:** prueba de integración: un kinesiólogo no obtiene turnos ajenos aunque pase otro
  identificador.

### T-28 · B · Aviso de pendientes
- Consulta de los turnos activos cuya franja terminó, de cualquier fecha.
- **RF/RNF:** RF-42.
- **Hecho:** pruebas de unidad con reloj inyectable y de integración.

### T-29 · B · Ficha del paciente
- Turnos del paciente, partidos en próximos (orden ascendente) e historial (orden descendente).
- **RF/RNF:** RF-47.
- **Hecho:** prueba de integración con reloj inyectable alrededor del límite de una franja.

### T-30 · F · Pantallas de agenda, asignación y ficha
- Agenda de secretaría con filtros, acciones del flujo, corrección, reprogramación, edición de
  coseguros, descarga del ticket y aviso de pendientes.
- Flujo de asignación: fecha → bloque → kinesiólogos con franjas libres → DNI (recupera o da de
  alta) → coseguros → confirmar → descarga del ticket.
- Agenda del kinesiólogo: en espera y próximos, sin acciones.
- Ficha del paciente con próximos e historial.
- **RF/RNF:** RF-19, RF-22, RF-23, RF-27, RF-28, RF-34 … RF-36, RF-40, RF-41, RF-42, RF-47.
- **Hecho:** recorrido manual del día completo de un consultorio.

---

## Fase 5 · Tiempo real (M5)

### T-31 · B · Difusión
- Socket.io autenticado con la cookie de sesión, con verificación de `Origin` en el handshake.
- Salas por kinesiólogo y de secretaría.
- Emisión después del commit de cada operación de M3; una reprogramación entre kinesiólogos va a
  ambas salas.
- Desconexión programada al vencer la sesión.
- **RF/RNF:** RF-11, RF-43, RF-44, RNF-10.
- **Hecho:** prueba de contrato con dos clientes: el cambio llega a la sala correcta y no a la de
  otro kinesiólogo; un socket con sesión vencida se desconecta.

### T-32 · F · Agenda viva
- Suscripción en ambas agendas, indicador de conexión caída, nueva consulta de la agenda al
  reconectar, y vuelta al login si el servidor cierra el socket por vencimiento.
- **RF/RNF:** RF-43, RF-44, RF-45.
- **Hecho:** con dos navegadores, un cambio en la secretaría aparece en el kinesiólogo sin recargar;
  al cortar y restablecer la red, la agenda se sincroniza.

---

## Fase 6 · Cierre funcional

### T-33 · E2E
- Playwright con dos contextos (secretaría y kinesiólogo) que recorre:
  1. Instalar.
  2. Cambiar contraseña y activar el segundo factor.
  3. Alta de un kinesiólogo.
  4. Asignar un turno y descargar el ticket.
  5. Marcar llegó y después asistió, con el kinesiólogo viendo cada paso.
- Incluye un intento de escritura del kinesiólogo contra la API, que debe ser rechazado.
- **RF/RNF:** RF-01, RF-03, RF-06, RF-43, RNF-04 y el flujo principal.
- **Hecho:** la suite E2E pasa en verde.

### T-34 · Verificación de seguridad de la aplicación
- Pruebas automatizadas transversales:
  - Recorrer el flujo completo con un DNI conocido y verificar que no aparece en los logs
    capturados.
  - Todas las rutas responden con las cabeceras de seguridad.
  - Ninguna respuesta de error contiene trazas.
- **RF/RNF:** RNF-08, RNF-10.
- **Hecho:** las pruebas pasan en CI.

---

## Fase 7 · Producción (`despliegue.md`)

### T-35 · Imágenes y configuración de producción
- `Dockerfile` de `web` (Caddy + Angular compilado), `api` (Node sin root, sistema de archivos de
  solo lectura) y `respaldo` (`pg_dump` + `age` + `rclone`).
- `docker-compose.prod.yml` y `Caddyfile` de `despliegue.md` §6.
- **RF/RNF:** RNF-01, RNF-10.
- **Hecho:** el stack de producción levanta en local con un certificado de prueba, y las cabeceras y
  la CSP coinciden con §6.2.

### T-36 · Infraestructura y endurecimiento
- `infra/provision.sh` (idempotente) y la configuración de DigitalOcean según `despliegue.md` §4,
  §5 y §7:
  - Proyecto con 2FA, VPC, Droplet y Cloud Firewall en FRA1.
  - PostgreSQL administrado con fuentes de confianza y ventana de mantenimiento.
  - Los tres usuarios de la base.
  - SSH endurecido, `unattended-upgrades`, `fail2ban`, rotación de logs y swap de 1 GB.
- **RF/RNF:** RNF-05, RNF-06, RNF-09, RNF-13.
- **Hecho:** los ítems de la lista de `despliegue.md` §15 correspondientes a red, base y servidor
  verificados.

### T-37 · Copias externas y restauración
- Bucket en la UE con Object Lock y retención de 30 días, y clave con el mínimo permiso. Par de
  claves `age`, temporizador de systemd de la tarea diaria con latido,
  `infra/verificar-restauracion.sh` y `docs/operacion/restauraciones.md`.
- **RF/RNF:** RNF-05, RNF-06, RNF-07, RNF-12.
- **Hecho:** primera copia subida, descargada, descifrada, restaurada y verificada, con su registro.
  Un intento de borrarla falla por el Object Lock.

### T-38 · Monitoreo y alertas
- Monitor externo de `/api/salud` y del certificado, latido de copias y alertas de DigitalOcean,
  según `despliegue.md` §11.
- **RF/RNF:** RNF-12.
- **Hecho:** simulacro con la API detenida y con el latido omitido: las dos alertas llegan al
  administrador.

### T-39 · Despliegue continuo
- Workflow de etiqueta según `despliegue.md` §10:
  1. Construcción y publicación de imágenes.
  2. Migraciones con `scalekine_migraciones`.
  3. `docker compose up -d`.
  4. Prueba de humo y vuelta a la versión anterior si falla.
- **RF/RNF:** RNF-09, RNF-11.
- **Hecho:** una etiqueta despliega sola; una prueba de humo fallida a propósito deja corriendo la
  versión anterior.

### T-40 · Puesta en producción
- Recorrer la lista de `despliegue.md` §15, ejecutar el comando de instalación, verificar
  `spec.md` §7 punto por punto y completar la sección **Setup** del README.
- **RF/RNF:** RNF-05 y todos los criterios de `spec.md` §7.
- **Hecho:** todos los criterios tildados, y las medidas de `despliegue.md` §14 firmadas o en curso
  con la clínica.

---

## Cobertura de requisitos por tarea

| Req. | Tareas | Req. | Tareas | Req. | Tareas |
|---|---|---|---|---|---|
| RF-01 | T-07, T-14, T-33 | RF-21 | T-18, T-19 | RF-41 | T-27, T-30 |
| RF-02 | T-07 | RF-22 | T-21, T-30 | RF-42 | T-28, T-30 |
| RF-03 | T-08, T-27, T-33 | RF-23 | T-22, T-30 | RF-43 | T-31, T-32, T-33 |
| RF-04 | T-13, T-14 | RF-24 | T-04, T-22 | RF-44 | T-31, T-32 |
| RF-05 | T-10 | RF-25 | T-04, T-22 | RF-45 | T-32 |
| RF-06 | T-11, T-14, T-33 | RF-26 | T-22 | RF-46 | T-22, T-23, T-24 |
| RF-07 | T-11, T-14 | RF-27 | T-23, T-30 | RF-47 | T-29, T-30 |
| RF-08 | T-13, T-14 | RF-28 | T-25, T-30 | RNF-01 | T-07, T-35 |
| RF-09 | T-13, T-26 | RF-29 | T-03, T-20 | RNF-02 | T-09 |
| RF-10 | T-07, T-14 | RF-30 | T-23 | RNF-03 | T-11 |
| RF-11 | T-07, T-14, T-31 | RF-31 | T-23 | RNF-04 | T-10, T-12, T-14, T-33 |
| RF-12 | T-02 | RF-32 | T-23 | RNF-05 | T-36, T-37, T-40 |
| RF-13 | T-16, T-19 | RF-33 | T-23 | RNF-06 | T-36, T-37 |
| RF-14 | T-17, T-19 | RF-34 | T-20, T-30 | RNF-07 | T-37 |
| RF-15 | T-15, T-21 | RF-35 | T-23, T-30 | RNF-08 | T-02, T-34 |
| RF-16 | T-17, T-19 | RF-36 | T-24, T-30 | RNF-09 | T-03, T-04, T-36, T-39 |
| RF-17 | T-18, T-19 | RF-37 | T-23, T-24 | RNF-10 | T-02, T-05, T-31, T-34, T-35 |
| RF-18 | T-18 | RF-38 | T-03, T-23 | RNF-11 | T-06, T-39 |
| RF-19 | T-18, T-30 | RF-39 | T-04, T-26 | RNF-12 | T-37, T-38 |
| RF-20 | T-18, T-19 | RF-40 | T-27, T-30 | RNF-13 | T-36 |
