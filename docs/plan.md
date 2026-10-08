# Plan técnico — Sistema de Turnos para Kinesiología

Deriva de [`spec.md`](./spec.md) y respeta el stack fijado en
[`constitucion.md`](./constitucion.md): Angular, Node.js + Express, PostgreSQL vía Prisma y
Socket.io.

Este documento describe **cómo** se implementa lo que la spec define como **qué**. Cada módulo
declara los RF que le corresponden, y la sección 8 cierra la trazabilidad en ambos sentidos. La
infraestructura de producción y la operación están en [`despliegue.md`](./despliegue.md).

> **Sin pendientes de negocio.** `spec.md` §5.1 está vacío. Lo que sigue marcado **[supuesto]** son
> detalles técnicos que el plan fija por defecto y se pueden ajustar sin tocar la spec.

---

## 1. Estructura de módulos

| # | Módulo | Responsabilidad | RF que cubre |
|---|---|---|---|
| M1 | **Identidad y acceso** | Cuentas, contraseñas, autenticación, sesión, roles, zona horaria | RF-01 … RF-12 |
| M2 | **Datos maestros** | Datos del consultorio, kinesiólogos y su bloque, grilla de franjas, pacientes | RF-13 … RF-21 |
| M3 | **Ciclo de vida del turno** | Asignación, coseguros, ticket con QR, estados, corrección, reprogramación | RF-22 … RF-39 |
| M4 | **Agenda** | Vistas por rol, disponibilidad, aviso de pendientes de marcar | RF-40 … RF-42 |
| M5 | **Tiempo real** | Difusión de cambios y resincronización | RF-43 … RF-45 |
| M6 | **Auditoría e historial** | Registro de cambios y consulta de historial | RF-46, RF-47 |

**Dependencias:** M3 es el núcleo; solo él escribe turnos. M4 y M6 leen turnos, y M5 difunde los
cambios que M3 emite. Ninguno de ellos puede alterar un turno.

**Por qué un único módulo que escribe turnos:** asignación, cambio de estado, corrección y
reprogramación comparten las mismas dos reglas (franja libre para el kinesiólogo y para el
paciente, RF-24/RF-25/RF-37) y el mismo registro de auditoría (RF-46). Concentrarlas en M3 evita
cuatro implementaciones que podrían divergir.

---

## 2. Modelo de datos

Entidades persistidas y sus relaciones. La forma física se define en las migraciones de Prisma.

### 2.1 Entidades

**`Usuario`** (M1)
- Identificador
- Nombre de usuario, único
- Contraseña (hash)
- Rol: `administrador` | `secretaria` | `kinesiologo`
- Activo
- Debe cambiar contraseña: marca que se enciende al crear o restablecer la cuenta (RF-04, RF-08) y
  se apaga cuando el usuario elige la suya (RF-06)
- Ingresos fallidos seguidos, bloqueado hasta y cantidad de bloqueos consecutivos (RNF-02)
- Secreto TOTP, cifrado con la clave de la aplicación, y si el segundo factor está activo (RNF-04,
  solo administrador)
- Códigos de recuperación, guardados como hash y marcados al usarse (RNF-04)

**`Sesion`** (M1)
- Token opaco (en la base se guarda su hash, no el token)
- Usuario asociado
- Creada, vence (creada + 12 h, RF-11) y revocada
- Segundo factor verificado (solo relevante para el administrador, RNF-04)

Tabla propia para que cerrar sesión (RF-10) sea una revocación real, para que restablecer o
desactivar una cuenta pueda cerrar todas sus sesiones (RF-08, RF-09), y para que las sesiones
sobrevivan a un reinicio del servidor (§4.1). Guardar el hash del token hace que una copia de la
base no permita secuestrar sesiones.

**`Kinesiologo`** — perfil 1:1 con `Usuario` (M2)
- Usuario asociado
- Nombre
- Bloque: `manana` | `tarde`

El bloque es una columna y no una tabla versionada: RF-16 pide que un cambio de bloque no altere
los turnos ya asignados, y eso ya se cumple porque cada turno guarda su propia fecha y hora de
inicio (§4.3).

**`Consultorio`** — fila única (M2)
- Nombre
- Dirección
- Teléfono

Va en la base y no en variables de entorno porque la secretaría la edita (RF-13).

**`Paciente`** (M2)
- Identificador
- DNI, único y con formato validado (RF-18)
- Nombre y apellido
- Teléfono
- Obra social (texto; "Particular" si no tiene)

**`Turno`** (M3)
- Identificador
- Paciente y kinesiólogo
- Fecha
- Hora de inicio de la franja
- Estado: `reservado` | `en_espera` | `asistio` | `no_asistio` | `anulado`
- `llegada_en`: momento en que pasó a `en_espera`
- Coseguro según obra social (monto, opcional)
- Coseguro adicional (monto, opcional)
- Creado por y creado en

**`TurnoEvento`** — auditoría (M6)
- Turno
- Tipo: `asignacion` | `cambio_estado` | `correccion` | `reprogramacion`
- Estado anterior y estado nuevo (solo en `cambio_estado` y `correccion`)
- Autor
- Ocurrido en

En `reprogramacion` no se guarda la fecha ni la franja anteriores (D-9).

### 2.2 La grilla no se persiste

La grilla de franjas (`spec.md` §2) es configuración del sistema, no datos: duración de 45 minutos
y la lista de horas de inicio por bloque. Las franjas disponibles se calculan a partir de ella
(§4.2).

La grilla aplica de lunes a viernes para todos los kinesiólogos (D-21). Los días se modelan como
parámetro para que cambiarlos no requiera migración.

### 2.3 Reglas que el modelo garantiza por sí solo

| Regla | Cómo se garantiza | RF |
|---|---|---|
| No hay dos turnos activos del mismo kinesiólogo en la misma franja | Índice único parcial sobre (kinesiólogo, fecha, hora de inicio) filtrado a `reservado` y `en_espera` | RF-24, RF-37 |
| No hay dos turnos activos del mismo paciente en la misma franja | Índice único parcial sobre (paciente, fecha, hora de inicio) filtrado a los estados activos | RF-25, RF-37 |
| Solo existen los cinco estados | Enum en el esquema | RF-29 |
| Un turno no se elimina | Ausencia de toda vía de borrado en la aplicación, y el usuario de base de la aplicación sin permiso `DELETE` sobre turnos, eventos, usuarios ni pacientes (`despliegue.md` §7) | RF-39, RF-09 |

**Por qué índices parciales:** cubren de una sola vez las cuatro formas de ocupar una franja
—asignar, corregir hacia un estado activo, reprogramar y corregir una reprogramación— sin que cada
operación tenga que repetir el chequeo. Liberar una franja (RF-38) no requiere ninguna operación:
es la ausencia de fila activa.

**Por qué la igualdad de hora de inicio alcanza para el paciente:** los dos kinesiólogos de la
mañana comparten grilla, así que dos turnos simultáneos siempre tienen la misma hora de inicio.
Si algún día los bloques tuvieran grillas desfasadas, esta regla es la primera que hay que revisar
(§4.4).

**Por qué `llegada_en` en `Turno`:** RF-40 ordena la espera por hora de llegada en cada push de
tiempo real. Se escribe en la misma transacción que el evento de auditoría. Una corrección que
saca al turno de `en_espera` la conserva; una que lo devuelve a `reservado` la limpia.

### 2.4 Lo que no está en el modelo

- Ficha clínica, cobros, catálogo de obras sociales: fuera de alcance.
- Tabla de franjas materializadas: se derivan de la grilla.
- Ubicación anterior de un turno reprogramado: fuera de alcance (D-9).
- Bandeja de envíos o recordatorios: el recordatorio salió del alcance (D-6).

---

## 3. Módulo por módulo

### M1 · Identidad y acceso — RF-01 … RF-12

- **RF-01**: el backend devuelve rol y perfil; la redirección es del frontend. El backend nunca
  confía en un rol enviado por el cliente.
- **RF-03**: la autorización se declara por módulo y rol, no por endpoint (§4.8):
  `administrador` escribe en todos los módulos; `secretaria`, solo en pacientes, datos del consultorio y turnos;
  `kinesiologo` no escribe en ningún lado y solo lee sus propios turnos.
- **RF-04 / RF-14**: la cuenta de secretaría se crea sola; la de kinesiólogo, junto con su perfil
  en una transacción (M2). Ambas nacen con la marca de cambio de contraseña.
- **RF-05**: un comando de instalación crea la cuenta de administrador con una contraseña temporal
  que imprime una sola vez por consola. No hay cuenta por defecto con una contraseña conocida.
- **RF-06**: mientras la sesión pertenezca a una cuenta marcada, el backend rechaza toda petición
  salvo el cambio de contraseña y el cierre de sesión. El bloqueo vive en el servidor, no en una
  redirección del frontend.
- **RF-07**: el cambio exige la contraseña actual; en el primer ingreso, la actual es la temporal.
  En la misma transacción se revocan las demás sesiones de la cuenta, y se rechaza una nueva igual a
  la actual. Un cambio concurrente con otra escritura de la contraseña se rechaza con 409. El
  ingreso crea su sesión en una transacción que reconfirma el hash verificado, para que no
  sobreviva una sesión abierta con la contraseña anterior.
- **RF-08 / RF-09**: restablecer y desactivar revocan todas las sesiones de la cuenta en la misma
  transacción. Una cuenta desactivada conserva su fila, porque `Turno` y `TurnoEvento` la
  referencian como autor.
- **RF-11**: cada petición y cada conexión de Socket.io verifican que la sesión no esté vencida ni
  revocada. Al conectar el socket se programa su desconexión para el momento del vencimiento, y el
  frontend vuelve al login.
- **RNF-02 (límite de intentos):** el bloqueo por cuenta vive en `Usuario`; el de dirección IP usa
  `rate-limiter-flexible` con almacenamiento en PostgreSQL, para que sobreviva a reinicios. Express
  confía solo en la IP que informa el proxy local (`trust proxy` = 1).
- **RNF-03 (contraseñas):** hash `argon2id` con los parámetros recomendados por OWASP; mínimo de 12
  caracteres; rechazo de las contraseñas de una lista embebida de contraseñas comunes. Se validan
  igual al crear, cambiar y restablecer. Los espacios de los extremos no cuentan para el largo ni
  para la comparación con la lista, y una contraseña en blanco se rechaza.
- **RNF-04 (segundo factor del administrador):** TOTP con `otplib`. El secreto se cifra con
  AES-256-GCM usando `CLAVE_CIFRADO`. La activación muestra un QR para la app autenticadora y 10
  códigos de recuperación que se ven una sola vez. Una sesión de administrador sin el segundo factor
  verificado solo accede a la pantalla de verificación (mismo mecanismo de bloqueo que RF-06). El
  comando de instalación incluye un subcomando para restablecer el segundo factor desde el servidor.

### M2 · Datos maestros — RF-13 … RF-21

- **RF-13**: una sola fila de `Consultorio`, creada por el comando de instalación y editable por
  `secretaria` y `administrador`. El ticket la lee al generarse, así que un cambio rige desde el
  próximo ticket sin invalidar nada.
- **RF-14**: alta de `Usuario` con rol `kinesiologo` y de `Kinesiologo` en la misma transacción,
  ejecutada por el administrador.
- **RF-15 / RF-16**: el bloque determina qué horas de inicio ofrece la grilla. Un cambio de bloque
  solo afecta los cálculos de disponibilidad; los turnos existentes no se tocan.
- **RF-18**: formato de DNI validado en el backend; unicidad garantizada por el esquema.
- **RF-19**: un único endpoint de búsqueda exacta por DNI que la pantalla de asignación consulta
  apenas se completa el campo. Si no hay coincidencia, el mismo formulario pasa al alta.
- **RF-21**: búsqueda por nombre con coincidencias parciales; por DNI, exacta. La ficha del paciente
  es una sola pantalla que combina sus datos (M2) y su historial (M6, RF-47). Solo para
  `secretaria` y `administrador`.

### M3 · Ciclo de vida del turno — RF-22 … RF-39

Es el núcleo. Expone cinco operaciones de escritura, para `secretaria` y `administrador`, y una
de lectura (el ticket):

| Operación | Efecto | RF |
|---|---|---|
| `asignar` | Crea el turno en `reservado` con sus coseguros | RF-23 … RF-26 |
| `modificarCoseguros` | Cambia los montos; no toca estado ni franja | RF-27 |
| `transicionar` | Aplica una acción del flujo normal | RF-30 … RF-33 |
| `corregir` | Lleva el turno a cualquier estado | RF-35 |
| `reprogramar` | Cambia fecha, franja y/o kinesiólogo de un turno `reservado` | RF-36 |
| `ticket` | Devuelve el PDF del ticket con QR, generado con los datos vigentes | RF-28 |

**Tabla del flujo normal en un solo lugar.** Las cuatro transiciones de `spec.md` §3.5 viven en
una tabla declarativa en el código. `transicionar` solo acepta lo que está en la tabla, y la misma
tabla responde qué acciones mostrar para un estado (RF-34). El frontend no la conoce: recibe la
lista de acciones disponibles con cada turno.

**Corrección separada del flujo.** `corregir` es otra operación, no una fila comodín de la tabla.
Así el flujo normal sigue siendo estricto y verificable, y la auditoría distingue sin ambigüedad
un "no asistió" del día a día de uno corregido (`TurnoEvento.tipo`).

**Ocupación de franja.** `asignar`, `reprogramar` y `corregir` hacia un estado activo pueden chocar
con los índices de §2.3. El error de la base se traduce a un rechazo de negocio con el motivo
(RF-24, RF-25, RF-37).

**Ticket con QR (RF-28).** El ticket no se guarda: se genera en el backend cada vez que se pide, a
partir del turno actual. Así una reprogramación no deja un ticket viejo almacenado, y no hace falta
invalidar nada. Al asignar, el frontend ofrece la descarga inmediatamente con el identificador que
devuelve `asignar`. El QR lleva texto plano (número de turno, paciente, kinesiólogo, fecha y hora),
no un enlace (§4.11).

**Cada operación escribe su evento** de `TurnoEvento` en la misma transacción (RF-46) y, tras el
commit, emite un evento de dominio que M5 difunde.

### M4 · Agenda — RF-40 … RF-42

- **RF-40 (kinesiólogo)**: consulta filtrada al kinesiólogo de la sesión, nunca a un parámetro del
  cliente. La proyección es la misma que la de la secretaría, sin la lista de acciones (D-15).
  Todos los endpoints de lectura que acepta el rol `kinesiologo` filtran por el kinesiólogo de la
  sesión; los de búsqueda de pacientes e historial lo rechazan (D-16).
- **RF-41 (secretaría)**: todos los turnos, filtrables por fecha y kinesiólogo, con la proyección
  completa y la lista de acciones disponibles de M3.
- **RF-22 (disponibilidad)**: dada una fecha y un bloque, devuelve los kinesiólogos de ese bloque y,
  para cada uno, las horas de inicio de la grilla menos las que tienen un turno activo suyo o del
  paciente. Es una única consulta de los turnos activos de la fecha, resuelta en memoria.
- **RF-42 (aviso)**: consulta de turnos activos cuya franja terminó (`fecha + hora de inicio + 45 min
  < ahora`). Se calcula al leer: no hay proceso en segundo plano, porque el sistema nunca cambia un
  estado por su cuenta (§4.5).

### M5 · Tiempo real — RF-43 … RF-45

- **Salas**: una por kinesiólogo y una de secretaría. Un cambio va a la sala del kinesiólogo del
  turno y a la de secretaría. Una reprogramación que cambia de kinesiólogo va a ambas salas de
  kinesiólogo.
- **Proyección**: todas las salas reciben la misma proyección del turno; la lista de acciones
  disponibles solo viaja a la sala de secretaría (que incluye al administrador).
- **RF-45**: el frontend detecta la pérdida de conexión y lo marca en pantalla. Al reconectar vuelve
  a pedir la agenda en vez de confiar en lo que tenía en memoria.

### M6 · Auditoría e historial — RF-46, RF-47

- **RF-46**: los eventos se escriben dentro de las operaciones de M3; no hay otra vía de escritura.
- **RF-47**: todos los turnos del paciente, en cualquier estado, separados por si la franja ya
  terminó: próximos en orden ascendente e historial en orden descendente. Una sola consulta, partida
  en memoria con el reloj inyectable. Disponible para `secretaria`
  y `administrador`. El rol `kinesiologo` lo tiene vedado (D-16).

---

## 4. Decisiones técnicas y alternativas descartadas

### 4.1 Sesión en cookie con tabla propia, en lugar de JWT

**Elegido:** cookie de sesión opaca, con la sesión persistida en la base.

*Descartado:* JWT. RF-10 exige que cerrar sesión invalide el acceso, y RF-08 y RF-09 que se puedan
cerrar las sesiones de otro; un JWT sigue siendo válido hasta expirar, y revocarlo exige una lista
negra, que es una tabla de sesiones con más pasos. Además, el token quedaría expuesto a JavaScript
si se guarda fuera de una cookie `HttpOnly` (RNF-01).

*Descartado también:* sesiones en memoria del proceso. Un reinicio del servidor cerraría todas las
agendas abiertas, incluidas las que los kinesiólogos usan como monitor.

### 4.2 Grilla como configuración, en lugar de una tabla de franjas

**Elegido:** la grilla es un parámetro (duración y horas de inicio por bloque) y las franjas se
derivan al consultar.

*Descartado:* materializar una fila por franja y fecha. Simplifica la disponibilidad, pero obliga a
generar filas por adelantado y a reconciliarlas ante un cambio de bloque o de días de atención. Con
derivación, el volumen de un consultorio (tres agendas, diez franjas por día) hace el cálculo
trivial.

### 4.3 Bloque como columna, en lugar de un horario versionado

**Elegido:** `Kinesiologo.bloque`.

*Descartado:* una tabla de horarios con vigencia. Era necesaria cuando el sistema marcaba
inasistencias solo y tenía que reconstruir qué franjas existían en una fecha pasada. Con
inasistencia manual, el pasado solo se consulta a través de los turnos, que guardan su propia hora.

### 4.4 Ocupación por igualdad de hora de inicio, en lugar de solapamiento

**Elegido:** dos turnos chocan si comparten kinesiólogo (o paciente), fecha y hora de inicio.

*Descartado:* comparar intervalos. Con una única grilla de duración fija, la igualdad da el mismo
resultado y se puede garantizar con un índice parcial. Si la grilla dejara de ser única, hay que
revisar esta decisión.

### 4.5 Aviso de pendientes calculado al leer, en lugar de un proceso periódico

**Elegido:** una consulta sobre los turnos activos con la franja terminada.

*Descartado:* un barrido periódico que marque o señale los turnos. El sistema no cambia estados
por su cuenta (regla 9), así que no hay nada que escribir; un proceso en segundo plano solo agregaría
una pieza que puede fallar en silencio.

### 4.6 Corrección como operación propia, en lugar de abrir la tabla de transiciones

**Elegido:** `corregir` aparte de `transicionar`.

*Descartado:* agregar todas las combinaciones a la tabla. El flujo normal dejaría de ser
verificable, la pantalla ofrecería 4 acciones en cada estado, y la auditoría no podría distinguir
el trabajo diario de las correcciones.

### 4.7 Sin control de concurrencia entre escrituras

**Elegido:** sin versiones ni bloqueo optimista. Los índices de §2.3 impiden el único daño
estructural posible (doble ocupación de franja).

*Descartado:* bloqueo optimista. Las secretarias no trabajan en simultáneo (D-12); el kinesiólogo
no escribe. No hay escenario realista de dos escrituras cruzadas sobre el mismo turno.

### 4.8 Autorización por rol a nivel de método, en lugar de por endpoint

**Elegido:** cada rol tiene declarado en qué módulos puede escribir (todos para `administrador`;
M2 pacientes y consultorio, y M3, para `secretaria`; ninguno para `kinesiologo`), y esa declaración se aplica en un
único middleware.

*Descartado:* declarar permisos endpoint por endpoint. Es más flexible, pero cada endpoint nuevo
abre la posibilidad de olvidar el chequeo, y la regla de negocio es global (D-3).

### 4.9 Montos de coseguro como decimal

**Elegido:** tipo decimal de precisión fija en pesos.

*Descartado:* coma flotante, porque los montos de dinero no deben acumular error de redondeo
aunque hoy sean informativos.

### 4.10 Interfaz en un solo idioma

**Elegido:** castellano.

*Descartado:* i18n desde el inicio. El producto es single-tenant y no hay un segundo idioma en el
horizonte.

### 4.11 Ticket en PDF generado en el backend, con QR de texto plano

**Elegido:** el backend arma el PDF (librería `qrcode` para el código y `pdfkit` para el documento) a
partir del turno vigente y de los datos vigentes de `Consultorio` (RF-13). El QR contiene los datos del turno en
texto; el ticket no incluye DNI ni coseguros.

*Descartado:* generar el ticket en el frontend. Funcionaría, pero el contenido dependería de lo que
el cliente tenga en memoria. Generarlo en el servidor garantiza que refleje el turno vigente, que
es lo que pide RF-28.

*Descartado:* un QR con un enlace al turno. Exigiría una página pública o un acceso para pacientes,
y el paciente no es usuario del sistema (sección 4 de la spec). El texto plano se lee con cualquier
celular sin conexión al sistema.

### 4.12 TypeScript en backend y frontend

**Elegido:** TypeScript en los dos lados, con los tipos de dominio (estados, roles, bloques) definidos
una vez en el backend y reflejados en el frontend.

*Descartado:* JavaScript en el backend. Angular ya impone TypeScript; usar JS solo en el servidor
deja sin chequeo de tipos justamente la tabla de transiciones y las proyecciones por rol, que es
donde un error de nombre de campo pasa desapercibido.

### 4.13 Herramientas de prueba

**Elegido:** Vitest para unidad e integración del backend, Supertest para la API, un PostgreSQL real
en Docker para integración, `socket.io-client` para el contrato de tiempo real y Playwright para
E2E con dos contextos de navegador (secretaría y kinesiólogo).

*Descartado:* una base en memoria o SQLite para integración. Los índices únicos parciales (§2.3)
son la garantía central de RF-24, RF-25 y RF-37, y tienen que probarse en el motor que los ejecuta.

### 4.14 Índices parciales en una migración SQL manual

Prisma no expresa índices únicos parciales en su esquema. Se crean en una migración SQL escrita a
mano dentro de `prisma/migrations`, y una prueba de integración verifica que existen. Es la única
parte del esquema que no sale de `schema.prisma`.

### 4.15 Defensas de la aplicación

**Elegido** (RNF-01, RNF-08, RNF-10):
- `helmet` con CSP estricta (`default-src 'self'`, sin scripts en línea ni orígenes externos),
  `frame-ancestors 'none'` y HSTS (además de Caddy, ver `despliegue.md`).
- Validación de cada cuerpo, parámetro y consulta con `zod` antes de llegar al servicio. Límite de
  tamaño de petición de 100 kB.
- CSRF: la cookie es `SameSite=Strict` y, además, toda petición de escritura verifica que el
  encabezado `Origin` sea el de la aplicación. El handshake de Socket.io verifica lo mismo.
- Errores: el manejador central responde un código y un mensaje de negocio; el detalle va solo al
  log del servidor.
- Logs con `pino` y redacción de campos (`dni`, `nombre`, `telefono`, `obraSocial`, coseguros,
  contraseñas, tokens). Las URLs se registran sin parámetros de consulta, para que una búsqueda por
  DNI no quede en el log.

*Descartado:* tokens CSRF sincronizados. Con frontend y API en el mismo origen, `SameSite=Strict`
más la verificación de `Origin` cubren el mismo riesgo con menos piezas.

### 4.16 Producción en DigitalOcean, región Frankfurt

**Elegido:** un Droplet en Frankfurt con Docker Compose (Caddy + backend + frontend estático) y
PostgreSQL administrado de DigitalOcean en la misma región, conectados por red privada. El Droplet
arranca en 1 GB de RAM y se amplía si la memoria lo pide. Copia externa diaria en un proveedor
distinto, también dentro de la Unión Europea. El detalle, los costos y la operación están en
[`despliegue.md`](./despliegue.md).

*Descartado por ahora:* PostgreSQL propio en el mismo Droplet, con el registro de transacciones
cifrado en el bucket externo. Baja el costo a la mitad, pero los backups, los parches y la
recuperación a un punto en el tiempo (RNF-07) quedarían a cargo de un único desarrollador. Se
reconsidera si el costo pasa a ser decisivo para la clínica.

*Descartado:* Hetzner (UE) con PostgreSQL propio. Tiene la misma carga operativa que la opción
anterior y ya no es más barato: en junio de 2026 subió sus precios y, en octubre de 2026, sus planes
económicos no se pueden contratar.

*Descartado:* Scaleway (Francia) con base administrada. Cuesta lo mismo que la opción elegida, pero
su base solo tiene copias diarias, sin recuperación a un punto en el tiempo (RNF-07).

*Descartado:* DonWeb (Argentina). Evita la transferencia internacional, pero no ofrece PostgreSQL
administrado y su backup semanal no alcanza RNF-07.

*Descartado:* AWS São Paulo. La menor latencia, pero Brasil no figura en la lista de países
adecuados de la AAIP (RNF-05) y el costo es el doble o más.

*Descartado:* servidor en la clínica. Cortes de luz e internet, riesgo físico y backups manuales.

---

## 5. Fronteras del sistema

- **El backend es la única autoridad sobre los turnos.** El frontend muestra las acciones que la
  API le devuelve y ninguna se ejecuta si el servidor la rechaza.
- **El frontend no conoce la tabla de transiciones.** Duplicarla en el cliente es la forma más
  probable de que RF-34 y la validación del servidor se contradigan.
- **El tiempo real no escribe en la base.** M5 difunde; M3 decide.
- **El rol se toma de la sesión, nunca de la petición.**
- **El frontend detecta su propia conexión caída** (RF-45), porque el servidor no puede afirmar que
  un cliente está desconectado.

### 5.1 Estructura del repositorio

```
/
├── backend/            Express + Prisma + Socket.io (TypeScript)
│   ├── prisma/         schema.prisma y migraciones (incluida la de índices parciales)
│   ├── src/
│   │   ├── modulos/    m1-identidad, m2-maestros, m3-turnos, m4-agenda, m5-tiempo-real, m6-auditoria
│   │   ├── comun/      reloj inyectable, errores de negocio, autorización, configuración
│   │   └── cli/        comando de instalación (administrador y consultorio)
│   └── test/           unidad e integración
├── frontend/           Angular
├── e2e/                Playwright
├── docker-compose.yml  PostgreSQL de desarrollo y de pruebas
└── docs/
```

Cada módulo de `backend/src/modulos` expone sus rutas y su servicio. Ningún módulo importa el
repositorio de otro: se comunican por los servicios, y los turnos solo se escriben desde
`m3-turnos`.

### 5.2 Configuración

| Variable | Uso |
|---|---|
| `DATABASE_URL` | Conexión a PostgreSQL |
| `ZONA_HORARIA` | Zona IANA del consultorio, p. ej. `America/Argentina/Buenos_Aires` (RF-12) |
| `PORT` | Puerto del backend |
| `FRONTEND_ORIGIN` | Origen permitido para CORS y para el handshake de Socket.io |
| `COOKIE_SECURE` | `true` en producción (cookie de sesión solo por HTTPS, RNF-01) |
| `CLAVE_CIFRADO` | Clave de 32 bytes para cifrar los secretos TOTP (RNF-04). Se respalda fuera del servidor: sin ella, el administrador debe reactivar su segundo factor |
| `NODE_ENV` | `production` en producción: desactiva trazas en las respuestas |
| `LOG_LEVEL` | Nivel de log de `pino` |

En producción, `DATABASE_URL` usa el usuario de aplicación sin permisos de estructura y exige SSL
(`sslmode=require`). Las migraciones corren con otro usuario, `DATABASE_URL_MIGRACIONES`, que solo
se usa durante el despliegue (RNF-09).

Los datos del consultorio no son variables de entorno: viven en la tabla `Consultorio` (RF-13).

---

## 6. Estrategia de tests

El riesgo está en la ocupación de franjas (dos kinesiólogos en paralelo, reprogramación,
correcciones) y en que el kinesiólogo vea su agenda al día.

### 6.1 Niveles

**Unidad (M2, M3, M4).** Sin base ni red.
- Tabla del flujo: los 5 estados de origen × 5 de destino, aceptando exactamente las 4 filas de
  `spec.md` §3.5.
- Acciones visibles por estado y rol (RF-34).
- Cálculo de la grilla: seis franjas a la mañana, con la última a las 11:45, y cuatro a la tarde.
- Disponibilidad y condición de "pendiente de marcar", con reloj inyectable.
- Validación de DNI.

**Integración (M2, M3, M6), contra PostgreSQL real.**
- Los índices parciales rechazan el segundo turno activo del mismo kinesiólogo y del mismo
  paciente, y aceptan dos kinesiólogos distintos en la misma franja.
- Corrección y reprogramación hacia una franja ocupada se rechazan (RF-37).
- Cada operación de M3 escribe su `TurnoEvento` con el tipo correcto.
- No existe vía de borrado.

**Contrato de tiempo real (M5).** Con dos clientes conectados: el cambio llega sin recargar, solo
a la sala del kinesiólogo correcto. Una reprogramación entre
kinesiólogos llega a ambos.

**Extremo a extremo (M1, M3, M4).** Dos sesiones simultáneas, secretaría y kinesiólogo, recorriendo
el flujo completo: asignar → llegó → asistió, con el kinesiólogo viendo cada paso. Se verifica que
el kinesiólogo no ve acciones ni puede ejecutarlas contra la API.

**Seguridad (M1 y transversal).**
- Bloqueo de cuenta e IP con sus umbrales y su duración creciente (RNF-02), con reloj inyectable.
- Contraseñas cortas o comunes rechazadas en alta, cambio y restablecimiento (RNF-03).
- Administrador sin TOTP verificado bloqueado; códigos de recuperación de un solo uso (RNF-04).
- Sesión vencida a las 12 horas rechazada en HTTP y desconectada en Socket.io (RF-11).
- Cabeceras de seguridad presentes en todas las respuestas; petición de escritura con `Origin`
  ajeno rechazada (RNF-01, RNF-10).
- Una prueba que ejecuta el flujo completo con un DNI conocido y verifica que no aparece en la
  salida de logs capturada (RNF-08).

### 6.2 Reloj controlado

Toda prueba que dependa de la hora (aviso de pendientes, historial, disponibilidad de "hoy") usa un
reloj inyectable, no el del sistema.

### 6.3 Qué no se prueba

- **Carga y rendimiento:** tres agendas de diez franjas por día.
- **Concurrencia entre secretarias:** fuera de alcance (D-12); los índices cubren el único daño
  estructural.

---

## 7. Orden de construcción

1. **M1 y M2** — cuentas, kinesiólogos, pacientes y grilla.
2. **M3 con M6** — el ciclo de vida y su auditoría, que se escriben en la misma transacción.
3. **M4** — las vistas que hacen utilizable a M3, incluido el aviso.
4. **M5** — tiempo real, que solo se prueba con dos clientes reales.
5. **M6, consulta de historial.**
6. **Despliegue** — infraestructura, copias, monitoreo y endurecimiento (`despliegue.md`).

---

## 8. Matriz de trazabilidad

| RF | Módulo | Nivel de prueba |
|---|---|---|
| RF-01 | M1 | E2E |
| RF-02 | M1 | E2E + unidad (mensaje) |
| RF-03 | M1 | integración (API) + E2E |
| RF-04 | M1 | integración |
| RF-05 | M1 | E2E (verificación de despliegue) |
| RF-06 | M1 | integración (API bloqueada) + E2E |
| RF-07 | M1 | integración |
| RF-08 | M1 | integración (sesiones revocadas) |
| RF-09 | M1 | integración (sesiones revocadas, registros conservados) |
| RF-10 | M1 | E2E |
| RF-11 | M1 | integración |
| RF-12 | transversal | integración |
| RF-13 | M2 | integración + E2E (ticket refleja el cambio) |
| RF-14 | M2 | integración |
| RF-15 | M2 | unidad (grilla) |
| RF-16 | M2 | integración |
| RF-17 | M2 | integración |
| RF-18 | M2 | unidad (formato) + integración (unicidad) |
| RF-19 | M2 | integración + E2E |
| RF-20 | M2 | integración |
| RF-21 | M2 | integración |
| RF-22 | M4 | unidad + integración |
| RF-23 | M3 | integración |
| RF-24 | M3 | integración (índice parcial) |
| RF-25 | M3 | integración (índice parcial) |
| RF-26 | M3 | integración |
| RF-27 | M3 | integración |
| RF-28 | M3 | integración (contenido del QR y datos vigentes tras reprogramar) |
| RF-29 | M3 | integración (esquema) |
| RF-30 | M3 | unidad + integración |
| RF-31 | M3 | unidad + integración |
| RF-32 | M3 | unidad + integración |
| RF-33 | M3 | unidad + integración |
| RF-34 | M3 | unidad (acciones por estado y rol) + E2E |
| RF-35 | M3 | integración |
| RF-36 | M3 | integración |
| RF-37 | M3 | integración |
| RF-38 | M3 | integración |
| RF-39 | M3 | integración |
| RF-40 | M4 | integración + E2E |
| RF-41 | M4 | E2E |
| RF-42 | M4 | unidad (reloj) + integración |
| RF-43 | M5 | contrato + E2E |
| RF-44 | M5 | contrato |
| RF-45 | M5 | contrato |
| RF-46 | M6 | integración |
| RF-47 | M6 | E2E |
| RNF-01 | M1 + infraestructura | integración (cabeceras, cookie) + verificación de despliegue |
| RNF-02 | M1 | integración (reloj) |
| RNF-03 | M1 | unidad + integración |
| RNF-04 | M1 | integración + E2E |
| RNF-05 | infraestructura | verificación de despliegue (inventario de servicios y regiones) |
| RNF-06 | infraestructura | verificación de despliegue |
| RNF-07 | infraestructura | prueba de restauración mensual documentada |
| RNF-08 | transversal | integración (logs capturados) |
| RNF-09 | infraestructura + migraciones | integración (permisos del usuario) + verificación de despliegue |
| RNF-10 | transversal | integración |
| RNF-11 | CI | `npm audit` en el pipeline |
| RNF-12 | infraestructura | simulacro de caída y de backup fallido |
| RNF-13 | infraestructura | verificación de despliegue |

---

## 9. Riesgos técnicos

| Riesgo | Origen | Mitigación |
|---|---|---|
| Pérdida de la contraseña del administrador | D-18 | Nadie más puede restablecerla. El comando de instalación permite regenerar la contraseña temporal del administrador desde el servidor. |
| Turnos olvidados sin marcar | D-8 | Aviso permanente de pendientes (RF-42). |
| Corrección usada como atajo | D-10 | Queda registrada como `correccion` con autor; se puede auditar. |
| Grilla desfasada entre bloques en el futuro | §4.4 | La ocupación por igualdad deja de alcanzar; revisar índices. |
| Zona horaria mal configurada | RF-12 | Parámetro de instalación; fijarlo antes del primer despliegue. |
| Pérdida de `CLAVE_CIFRADO` | RNF-04 | Se respalda en un gestor de contraseñas del administrador. Sin ella, el segundo factor se restablece desde el servidor. |
| Pérdida del segundo factor del administrador | RNF-04 | Códigos de recuperación y subcomando de restablecimiento en el servidor. |
| Caída de DigitalOcean o de la región | RNF-07 | Copia externa diaria en otro proveedor y procedimiento de reconstrucción en `despliegue.md`. |
| Un servicio auxiliar (monitoreo, errores) fuera de países adecuados | RNF-05, RNF-08 | Inventario de servicios en `despliegue.md`; ningún dato personal sale de la aplicación por logs. |
