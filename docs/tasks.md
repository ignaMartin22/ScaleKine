# Tareas — Sistema de Turnos para Kinesiología

Desglose de [`plan.md`](./plan.md) en tareas ejecutables, en el orden de construcción de su
sección 7. Cada tarea declara los RF que cubre y su criterio de "hecho". Una tarea no está
terminada si sus pruebas no pasan.

**Convenciones**

- Cada tarea es un PR (o un commit, si se trabaja solo) que deja `main` funcionando.
- **Hecho** significa: pruebas del nivel indicado en verde, y los criterios de `spec.md` §7 que
  cubre se pueden verificar.
- Las tareas de frontend (`F`) van después de la de backend (`B`) que consumen. Back y front
  pueden avanzar en paralelo dentro de una misma fase.
- Si una tarea revela una contradicción con la spec, se frena y se corrige primero la spec.

---

## Fase 0 · Base del repositorio

### T-01 · Estructura del monorepo
- `backend/`, `frontend/`, `e2e/`, `docker-compose.yml` con PostgreSQL (una base de desarrollo y una
  de pruebas), `.gitignore`, `.editorconfig`, `.env.example` con las variables de `plan.md` §5.2.
- **Hecho:** `docker compose up -d` levanta PostgreSQL; el README explica cómo.

### T-02 · Esqueleto del backend
- Express + TypeScript, carga de configuración validada al arrancar (falla si falta
  `ZONA_HORARIA`), manejo centralizado de errores de negocio, **reloj inyectable**, endpoint de
  salud, Vitest configurado.
- **RF:** RF-12 (zona horaria).
- **Hecho:** `npm test` corre; una prueba de unidad usa el reloj inyectable.

### T-03 · Esquema de datos
- `schema.prisma` con `Usuario`, `Sesion`, `Consultorio`, `Kinesiologo`, `Paciente`, `Turno` y
  `TurnoEvento` (`plan.md` §2.1). Enums de rol, bloque, estado y tipo de evento. Montos de
  coseguro decimales.
- Migración SQL manual con los dos índices únicos parciales (`plan.md` §2.3, §4.14).
- **RF:** RF-29, RF-38.
- **Hecho:** la migración aplica sobre una base vacía.

### T-04 · Arnés de pruebas de integración
- Vitest contra la base de pruebas: migración al inicio, limpieza entre pruebas, fábricas de datos
  (usuario, kinesiólogo, paciente, turno).
- Prueba que verifica que los índices parciales existen y rechazan un segundo turno activo del
  mismo kinesiólogo y del mismo paciente, y aceptan dos kinesiólogos distintos en la misma franja.
- **RF:** RF-24, RF-25 (garantía del esquema).
- **Hecho:** las pruebas de índices pasan contra PostgreSQL real.

### T-05 · Esqueleto del frontend
- Angular con rutas por rol (`/admin`, `/secretaria`, `/kinesiologo`), guardas de ruta, cliente
  HTTP con cookies, manejo de errores de la API y layout base.
- **Hecho:** la app compila y navega entre rutas vacías.

---

## Fase 1 · Identidad y acceso (M1)

### T-06 · B · Sesiones
- Login con hash bcrypt/argon2, mensaje genérico ante credenciales inválidas, cookie opaca con la
  sesión en base, logout que revoca, sin expiración por inactividad.
- **RF:** RF-01, RF-02, RF-10, RF-11.
- **Hecho:** integración de login correcto, incorrecto (mismo mensaje para usuario y contraseña) y
  logout que invalida la cookie.

### T-07 · B · Autorización por rol
- Middleware único que declara qué módulos escribe cada rol (`plan.md` §4.8): `administrador`
  todo, `secretaria` pacientes, consultorio y turnos, `kinesiologo` nada. El rol se lee de la
  sesión.
- **RF:** RF-03.
- **Hecho:** matriz de integración rol × módulo de escritura.

### T-08 · B · Comando de instalación
- CLI que crea la cuenta de administrador con contraseña temporal (impresa una sola vez) y la fila
  de `Consultorio` con nombre, dirección y teléfono. Permite regenerar la contraseña temporal del
  administrador (`plan.md` §9).
- **RF:** RF-05.
- **Hecho:** sobre una base vacía, el comando deja un administrador marcado para cambio de
  contraseña y un consultorio.

### T-09 · B · Contraseñas
- Bloqueo de toda petición, salvo cambio de contraseña y logout, mientras la cuenta esté marcada.
  Cambio de la propia contraseña con la actual. Mínimo de 8 caracteres.
- **RF:** RF-06, RF-07.
- **Hecho:** integración: una cuenta marcada recibe rechazo en cualquier otro endpoint y queda
  libre después de cambiar la contraseña.

### T-10 · B · Gestión de cuentas
- El administrador crea cuentas de secretaría con contraseña temporal, restablece contraseñas y
  desactiva cuentas, y las dos últimas operaciones revocan las sesiones de la cuenta en la misma
  transacción.
- **RF:** RF-04, RF-08, RF-09.
- **Hecho:** integración de cada operación, incluida la revocación de sesiones abiertas.

### T-11 · F · Acceso y administración de cuentas
- Pantalla de login, pantalla obligatoria de cambio de contraseña, cambio de contraseña desde el
  menú, redirección por rol, listado de cuentas del administrador con alta, restablecimiento y
  desactivación.
- **RF:** RF-01, RF-04, RF-06 … RF-10.
- **Hecho:** recorrido manual completo con las tres cuentas.

---

## Fase 2 · Datos maestros (M2)

### T-12 · B · Grilla
- Módulo puro: horas de inicio por bloque (seis a la mañana, la última a las 11:45; cuatro a la
  tarde), duración de 45 minutos, días hábiles de lunes a viernes como parámetro, fin de una franja.
- **RF:** RF-15.
- **Hecho:** unidad, con fechas en sábado y domingo sin franjas.

### T-13 · B · Consultorio
- Lectura y edición de nombre, dirección y teléfono por `secretaria` y `administrador`.
- **RF:** RF-13.
- **Hecho:** integración de edición y de rechazo para `kinesiologo`.

### T-14 · B · Kinesiólogos
- Alta de `Usuario` + `Kinesiologo` en una transacción (administrador), cambio de bloque, listado
  por bloque.
- **RF:** RF-14, RF-16.
- **Hecho:** integración: el alta crea las dos filas o ninguna; cambiar de bloque no toca turnos.

### T-15 · B · Pacientes
- Alta con DNI, nombre y apellido, teléfono y obra social obligatorios; validación de formato de
  DNI; edición con revalidación; búsqueda exacta por DNI y parcial por nombre.
- **RF:** RF-17, RF-18, RF-19, RF-20, RF-21 (búsqueda).
- **Hecho:** unidad de formato de DNI; integración de unicidad, edición y búsqueda.

### T-16 · F · Consultorio, kinesiólogos y pacientes
- Pantalla de datos del consultorio; alta y edición de kinesiólogos (administrador); sección
  **Pacientes** con buscador y ficha de datos editable (las listas de turnos llegan en T-27).
- **RF:** RF-13, RF-14, RF-16, RF-17, RF-20, RF-21.
- **Hecho:** recorrido manual de cada pantalla.

---

## Fase 3 · Ciclo de vida del turno y auditoría (M3 + M6)

### T-17 · B · Tabla de transiciones
- Tabla declarativa del flujo normal (cuatro filas), consulta de acciones disponibles por estado y
  rol, y mensajes de rechazo.
- **RF:** RF-29, RF-34.
- **Hecho:** unidad exhaustiva 5 × 5 estados × 3 roles: se aceptan exactamente las cuatro filas.

### T-18 · B · Disponibilidad
- Dada fecha, bloque y paciente opcional: kinesiólogos del bloque con sus franjas libres.
- **RF:** RF-22, RF-15.
- **Hecho:** unidad del cálculo y una integración con turnos activos y cerrados.

### T-19 · B · Asignar
- `asignar`: valida datos y bloque, crea el turno en `reservado` con coseguros y escribe el
  `TurnoEvento` de asignación en la misma transacción. Traduce la violación de índice a "franja
  ocupada" o "el paciente ya tiene turno en esa franja". Admite fecha vencida.
- **RF:** RF-23, RF-24, RF-25, RF-26, RF-46.
- **Hecho:** integración de cada rechazo y del evento escrito.

### T-20 · B · Transiciones, corrección y coseguros
- `transicionar` (escribe `llegada_en` al pasar a `en_espera`), `corregir` (cualquier estado,
  evento de tipo `correccion`, limpia `llegada_en` al volver a `reservado`) y `modificarCoseguros`.
- **RF:** RF-27, RF-30, RF-31, RF-32, RF-33, RF-35, RF-37, RF-38, RF-46.
- **Hecho:** integración de cada transición del flujo, de una corrección desde un estado cerrado
  hacia uno activo sobre una franja ocupada (rechazada) y libre (aceptada), y de los eventos.

### T-21 · B · Reprogramar
- `reprogramar` de un turno `reservado` a otra fecha, franja y/o kinesiólogo del bloque
  correspondiente; rechazo si no está `reservado` o si la franja nueva está ocupada; evento sin
  ubicación anterior.
- **RF:** RF-36, RF-37, RF-46.
- **Hecho:** integración de los casos válidos y de los tres rechazos.

### T-22 · B · Ticket
- Endpoint que genera el PDF con `qrcode` + `pdfkit` a partir del turno y del consultorio vigentes.
  El QR lleva número de turno, paciente, kinesiólogo, fecha y hora en texto; sin DNI ni coseguros.
- **RF:** RF-28.
- **Hecho:** integración que decodifica el QR del PDF generado, antes y después de reprogramar y
  de cambiar los datos del consultorio.

### T-23 · B · Sin borrado
- Verificar que no hay ruta ni método de servicio que elimine turnos o cuentas.
- **RF:** RF-39, RF-09.
- **Hecho:** prueba de integración que recorre las rutas registradas y no encuentra `DELETE` sobre
  turnos ni cuentas.

---

## Fase 4 · Agenda y ficha (M4 + M6)

### T-24 · B · Agendas
- Agenda de secretaría: todos los turnos por fecha y kinesiólogo, proyección completa y acciones
  disponibles. Agenda del kinesiólogo: solo sus turnos, filtrados por la sesión, separados en
  espera y próximos, sin acciones. Rechazo para el kinesiólogo de búsqueda, ficha e historial.
- **RF:** RF-40, RF-41, RF-03 (lecturas del kinesiólogo).
- **Hecho:** integración: un kinesiólogo no obtiene turnos ajenos aunque pase otro identificador.

### T-25 · B · Aviso de pendientes
- Consulta de turnos activos cuya franja terminó, de cualquier fecha.
- **RF:** RF-42.
- **Hecho:** unidad con reloj inyectable e integración.

### T-26 · B · Ficha del paciente
- Turnos del paciente partidos en próximos (ascendente) e historial (descendente).
- **RF:** RF-47.
- **Hecho:** integración con reloj inyectable alrededor del límite de una franja.

### T-27 · F · Pantallas de agenda, asignación y ficha
- Agenda de secretaría con filtros, acciones del flujo, corrección, reprogramación, edición de
  coseguros, descarga de ticket y aviso de pendientes.
- Flujo de asignación: fecha → bloque → kinesiólogos con franjas libres → DNI (recupera o da de
  alta) → coseguros → confirmar → descarga del ticket.
- Agenda del kinesiólogo: en espera y próximos, sin acciones.
- Ficha del paciente con próximos e historial.
- **RF:** RF-19, RF-22, RF-23, RF-27, RF-28, RF-34 … RF-36, RF-40, RF-41, RF-42, RF-47.
- **Hecho:** recorrido manual del día completo de un consultorio.

---

## Fase 5 · Tiempo real (M5)

### T-28 · B · Difusión
- Socket.io autenticado con la cookie de sesión; salas por kinesiólogo y de secretaría; emisión
  después del commit de cada operación de M3; reprogramación entre kinesiólogos a ambas salas.
- **RF:** RF-43, RF-44.
- **Hecho:** contrato con dos clientes: el cambio llega a la sala correcta y no a la de otro
  kinesiólogo.

### T-29 · F · Agenda viva
- Suscripción en ambas agendas, indicador de conexión caída, nueva consulta de la agenda al
  reconectar.
- **RF:** RF-43, RF-44, RF-45.
- **Hecho:** con dos navegadores, un cambio en la secretaría aparece en el kinesiólogo sin recargar;
  al cortar y restablecer la red, la agenda se sincroniza.

---

## Fase 6 · Cierre

### T-30 · E2E
- Playwright con dos contextos (secretaría y kinesiólogo): instalar → cambiar contraseña → alta de
  kinesiólogo → asignar → ticket → llegó → asistió, con el kinesiólogo viendo cada paso; intento de
  escritura del kinesiólogo contra la API rechazado.
- **RF:** RF-01, RF-03, RF-06, RF-43 y el flujo principal.
- **Hecho:** suite E2E en verde.

### T-31 · Verificación de salida
- Recorrer `spec.md` §7 punto por punto, completar la sección **Setup** del README y documentar el
  despliegue (instalación, comando de administrador, zona horaria, HTTPS).
- **Hecho:** todos los criterios de §7 tildados.

---

## Cobertura de RF por tarea

| RF | Tareas | RF | Tareas | RF | Tareas |
|---|---|---|---|---|---|
| RF-01 | T-06, T-11, T-30 | RF-17 | T-15, T-16 | RF-33 | T-20 |
| RF-02 | T-06 | RF-18 | T-15 | RF-34 | T-17, T-27 |
| RF-03 | T-07, T-24, T-30 | RF-19 | T-15, T-27 | RF-35 | T-20, T-27 |
| RF-04 | T-10, T-11 | RF-20 | T-15, T-16 | RF-36 | T-21, T-27 |
| RF-05 | T-08 | RF-21 | T-15, T-16 | RF-37 | T-20, T-21 |
| RF-06 | T-09, T-11 | RF-22 | T-18, T-27 | RF-38 | T-03, T-20 |
| RF-07 | T-09, T-11 | RF-23 | T-19, T-27 | RF-39 | T-23 |
| RF-08 | T-10, T-11 | RF-24 | T-04, T-19 | RF-40 | T-24, T-27 |
| RF-09 | T-10, T-23 | RF-25 | T-04, T-19 | RF-41 | T-24, T-27 |
| RF-10 | T-06, T-11 | RF-26 | T-19 | RF-42 | T-25, T-27 |
| RF-11 | T-06 | RF-27 | T-20, T-27 | RF-43 | T-28, T-29, T-30 |
| RF-12 | T-02 | RF-28 | T-22, T-27 | RF-44 | T-28, T-29 |
| RF-13 | T-13, T-16 | RF-29 | T-03, T-17 | RF-45 | T-29 |
| RF-14 | T-14, T-16 | RF-30 | T-20 | RF-46 | T-19, T-20, T-21 |
| RF-15 | T-12, T-18 | RF-31 | T-20 | RF-47 | T-26, T-27 |
| RF-16 | T-14, T-16 | RF-32 | T-20 | | |
