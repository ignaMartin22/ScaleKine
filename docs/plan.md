# Plan técnico — Sistema de Turnos para Kinesiología

Deriva de [`spec.md`](./spec.md) y respeta el stack fijado en
[`constitucion.md`](./constitucion.md): Angular, Node.js + Express, PostgreSQL vía Prisma,
Socket.io y un servicio externo de email.

Este documento describe **cómo** se implementa lo que la spec define como **qué**. Cada módulo
declara los RF que le corresponden, y la sección 8 cierra la trazabilidad en ambos sentidos.

> **Bloqueo de partida.** Los cuatro pendientes de `spec.md:382-389` (gestión de contraseñas,
> primera cuenta de recepción, contenido del email, duración de la franja) no están resueltos.
> Cada decisión de este plan que dependa de ellos está marcada con **[supuesto]** y hay que
> confirmarla antes de escribir código.

---

## 1. Estructura de módulos

El sistema se separa en siete módulos. La frontera entre ellos sigue quién es responsable de la
acción, no la tabla que toca, para que un cambio de estado (el núcleo del producto) no dependa de
cuatro módulos distintos.

| # | Módulo | Responsabilidad | RF que cubre |
|---|---|---|---|
| M1 | **Identidad y acceso** | Cuentas, autenticación, sesión, roles, zona horaria del sistema | RF-01 … RF-08 |
| M2 | **Datos maestros** | Alta, edición, búsqueda y horario de pacientes y médicos | RF-14 … RF-19 |
| M3 | **Agenda** | Disponibilidad, filtros, campos mostrados, orden de la espera, contador de inasistencias | RF-09 … RF-13, RF-20 |
| M4 | **Ciclo de vida del turno** | Máquina de estados, creación, disponibilidad de franja, reglas de rol | RF-21 … RF-37 |
| M5 | **Tiempo real** | Difusión de cambios a las agendas abiertas y resincronización | RF-38 … RF-40 |
| M6 | **Recordatorios** | Programación, envío, reintento y supresión | RF-41 … RF-45 |
| M7 | **Auditoría e historial** | Registro de altas y cambios, consulta de historial | RF-46 … RF-49 |

**Dependencias:** M4 no depende de nadie; todos los demás dependen de M4 (un turno no se crea ni se
consulta sin pasar por la máquina de estados). M5 y M6 se enganchan a M4 como efectos
secundarios: M4 decide, M5 difunde y M6 programa. Ninguno de los dos puede alterar un turno.

**Por qué un módulo de ciclo de vida separado:** M3, M6 y M7 necesitan conocer el estado de un
turno, pero ninguno tiene permiso para cambiarlo. Concentrar las transiciones en M4 garantiza que
RF-25, RF-26, RF-31 y RF-33 tengan un único lugar donde ser verdad, en lugar de cuatro
implementaciones que podrían divergir.

---

## 2. Modelo de datos

Entidades persistidas, con sus relaciones. Sin dialecto SQL: la forma física se define en las
migraciones de Prisma.

### 2.1 Entidades

**`Usuario`** — identidad y acceso (M1)
- Identificador
- Email de acceso, único
- Contraseña (hash)
- Rol: `recepcion` | `medico`
- Activo
- La sesión vive aparte: las sesiones no expiran (RF-07), por lo que no hay marca de vencimiento
  que se agote sola.

**`Sesion`** — registro de las sesiones abiertas
- Token opaco
- Usuario asociado
- Creada y revocada
- Existe como tabla propia, y no como columna en `Usuario`, para que RF-06 (cerrar sesión) sea una
  revocación real y no un borrado de estado de usuario. Permitir revocar una sola sesión sin
  tocar la cuenta es lo que hace posible el "salir" sin bloquear a los demás usuarios del
  consultorio.

**`Medico`** — perfil profesional, relación 1:1 con `Usuario` (M2)
- Usuario asociado
- Nombre
- Horario de atención vigente

**`HorarioMedico`** — historial de horarios, para que el cambio a futuro (RF-17) no borre el pasado
- Médico
- Día de la semana
- Hora de inicio y hora de fin
- Vigente desde

`HorarioMedico` es una tabla aparte y no un par de columnas en `Medico` porque RF-17 exige que un
cambio de horario no altere los turnos ya registrados, y la Constitución exige que toda transición
quede registrada. Con una tabla versionada, el horario vigente se resuelve por "la fila con
`vigente_desde` más reciente no posterior a la fecha consultada", y el horario de una fecha pasada
sigue siendo consultable. Con dos columnas, el horario de ayer habría quedado sobrescrito.

**[supuesto]** El horario se define por día de la semana. Si un consultorio tiene horarios
irregulares por fecha concreta, hace falta una tabla de excepciones por fecha.

**`Paciente`** (M2)
- Identificador
- Nombre
- DNI, único y con formato validado (RF-15)
- Email, opcional
- Teléfono, opcional

**`Turno`** (M4)
- Identificador
- Paciente y médico
- Fecha
- Hora de inicio de la franja
- Estado
- `llegada_en`: momento en que pasó a `en_espera`
- Creado por y creado en

**`TurnoEvento`** — auditoría de altas y cambios (M7)
- Turno
- Estado anterior, nulo en la creación
- Estado nuevo
- Autor: usuario **o** origen `sistema`
- Ocurrido en

**`EnvioRecordatorio`** — bandeja de salida de email (M6)
- Turno
- Estado: `pendiente` | `enviado` | `descartado`
- Intentos
- Próximo intento
- Último error

### 2.2 Reglas que el modelo debe garantizar por sí solo

Estas cuatro reglas se implementan en el esquema, no solo en el código de aplicación. Si el modelo
las garantiza, la sección 3 puede asumir que se cumplen.

| Regla | Cómo se garantiza | RF |
|---|---|---|
| No hay dos turnos activos del mismo médico en la misma franja | Índice único parcial sobre (médico, fecha, hora de inicio) filtrado a los estados activos | RF-22 |
| No hay dos turnos activos del mismo paciente en la misma franja | Índice único parcial sobre (paciente, fecha, hora de inicio) filtrado a los estados activos | RF-23 |
| Un turno no cambia de estado por fuera de la tabla | Restricción de dominio sobre los valores de estado, más la tabla de transiciones en M4 | RF-25, RF-26 |
| El turno conserva su registro siempre | Ausencia de toda vía de borrado en la aplicación y en el esquema | RF-36 |

**Por qué índices parciales y no una comprobación en el código:** RF-37 dice que dos acciones
simultáneas se resuelven aplicando la última, no rechazando. Con una comprobación en el código,
ambas acciones pasan el chequeo y la segunda inserta encima de la primera: el turno queda duplicado
y la franja doblemente ocupada. El índice parcial convierte la colisión en un error de la base que
la segunda acción reporta como "franja ocupada", yRF-22 y RF-23 se cumplen sin importar cuántas
peticiones llegan a la vez. La Constitución ya argumentaba que el modelo relacional da integridad
"gratis"; este es el caso donde eso decide la arquitectura.

**Por qué `llegada_en` además de `TurnoEvento`:** RF-12 ordena la cola del médico por hora de
llegada, y esa consulta corre en cada push de RF-38. `TurnoEvento` es append-only y requiere
agregar y desagregar para obtener el valor. `llegada_en` en `Turno` es una proyección del mismo
hecho, escrita en la misma transacción; `TurnoEvento` sigue siendo la fuente de verdad. La
duplicación solo puede divergir por la acción que escribe ambas, que es la misma transacción.

**Por qué `EnvioRecordatorio` y no un envío directo:** RF-45 exige reintento automático, y un
reintento que no sobrevive a un reinicio del proceso no es un reintento. La bandeja persiste la
intención de enviar y su estado; el proceso la consume. Además permite implementar RF-44 —descartar
el envío de un turno que se canceló— sin enviar nada: el registro queda `descartado` y se puede
auditar que el recordatorio no salió.

### 2.3 Lo que no está en el modelo

- **Ficha clínica, notas, evolución.** Fuera de alcance.
- **Tabla de franjas materializadas.** Las franjas se derivan del horario vigente del médico
  (§4.2).
- **Columna de zona horaria por registro.** La zona es única del sistema (RF-08), no por dato.
- **Auditoría de navegación.** Fuera de alcance.

---

## 3. Módulo por módulo

### M1 · Identidad y acceso — RF-01 … RF-08

Funciones: autenticar, cerrar sesión, crear cuentas, resolver el rol de quien actúa, exponer la
zona horaria del sistema.

Puntos donde la spec deja elección al plan:

- **RF-01 (redirección por rol)**: el backend devuelve el rol y el perfil; la redirección es
  responsabilidad del frontend. El backend nunca confía en un rol enviado por el cliente.
- **RF-03 (permisos)**: el control es del backend. Ocultar botones es RF-35, que es de
  presentación, pero la garantía real de RF-03 requiere que el servidor rechace.
- **RF-07 (sin expiración)**: la sesión no lleva vencimiento. El único límite es el reinicio del
  proceso si las sesiones viven en memoria (§4.5).

**[supuesto]** Enquanto los cuatro pendientes de `spec.md:382-389` no se resuelvan, M1 no tiene
cambio de contraseña, recuperación ni desactivación. Se implementa solo el alta de cuentas
(RF-04) y la creación de la primera cuenta (RF-05). Cualquier médico que pierda su clave queda
inaccesible y recepción no tiene forma de ayudarlo: es un agujero conocido, no una decisión.

### M2 · Datos maestros — RF-14 … RF-19

Funciones: alta y edición de pacientes y médicos, validación de DNI, búsqueda, gestión del
horario con vigencia.

- **RF-15 (DNI)**: la validación de formato ocurre en el backend. La unicidad la garantiza el
  modelo (§2.2). La revalidación en RF-18 es la misma regla aplicada a una edición, no un caso
  aparte.
- **RF-17 (horario a futuro)**: una edición cierra la vigencia anterior con la fecha de corte y abre
  una nueva. Los turnos existentes guardan fecha y hora de inicio propias, no una referencia al
  horario, así que no se ven afectados por construcción.
- **RF-19 (búsqueda)**: la búsqueda por nombre es por coincidencias parciales; la por DNI es
  exacta. No se implementa búsqueda difusa: recepción conoce el DNI cuando lo busca.

### M3 · Agenda — RF-09 … RF-13, RF-20

Funciones: calcular franjas disponibles, filtrar, proyectar los campos de un turno, ordenar la
espera, contar inasistencias.

- **RF-20 (disponibilidad)**: se calculan todas las franjas del horario vigente y se descartan las
  que tienen un turno activo, del médico y del paciente. La consulta ya trae la lista de turnos
  activos de la franja, así que el descarte es en memoria.
- **RF-11 (campos)**: la proyección es una función del rol y del estado, en un solo lugar. Que M4
  exponga la lista de acciones disponibles por estado y rol evita que M3 y el frontend calculen la
  misma regla y se desincronicen (RF-35).
- **RF-12 (orden de la espera)**: orden por `llegada_en`. Los empates se resuelven por orden de
  llegada al sistema, que es la misma columna.
- **RF-13 (contador de inasistencias)**: cuenta de `no_asistio` por fecha y por médico. Se calcula
  en la misma consulta que la agenda, no en una aparte.

### M4 · Ciclo de vida del turno — RF-21 … RF-37

Es el módulo central. **Una sola tabla de transiciones en el código**, declarada explícitamente
—origen, destino, rol autorizado, condición— y usada por todo el sistema.

Funciones: crear turno, aplicar transición, calcular disponibilidad de franja, resolver qué acciones
ve el usuario.

La tabla de transiciones es la implementación directa de la tabla de `spec.md:180-185`, y las tres
reglas que la gobiernan salen de ella, no de condicionales repartidos:

- **RF-26 / RF-34 (rechazo)**: una transición ausente de la tabla se rechaza, y el mensaje se
  construye a partir de la misma tabla: si hay una transición de salida, se nombra; si el estado
  es terminal, la tabla no tiene salida y el mensaje dice que el turno está cerrado. Es lo que
  resolvió D-7 sin necesidad de un caso especial en el mensaje.
- **RF-33 (rol)**: la tabla declara el rol, y el chequeo de rol es parte de la misma consulta. El
  rechazo por rol y el rechazo por transición salen del mismo lugar.
- **RF-35 (acciones)**: la tabla tiene un método inverso que devuelve las transiciones disponibles
  desde un estado para un rol. RF-35 se cumple por construcción en lugar de por sincronización
  con el frontend.

**RF-32 (franja liberada)**: un turno terminal deja de ocupar su franja porque el índice parcial
solo considera los estados activos. No hay ninguna operación de "liberar": liberar es la ausencia
de fila activa.

**RF-36 (no borrar)**: no existe endpoint de borrado de turno. Un turno mal creado se cancela
(RF-29) y se crea el correcto.

### M5 · Tiempo real — RF-38 … RF-40

Funciones: difundir cambios de estado, emitir advertencia de conexión, resincronizar al reconectar.

- **Salas**: una sala por médico y una sala global para recepción. Un turno pertenece a la sala de
  su médico; recepción recibe todos los eventos. La separación permite que M4 difunda sin saber
  quién está mirando.
- **Alcance de la difusión**: M4 emite un evento de cambio; M5 decide a qué salas va. M4 no
  conhece el sistema de tiempo real, y M5 no puede escribir en la base.
- **RF-40 (conexión y resincronización)**: el frontend detecta pérdida de conexión y la marca; al
  reconectar vuelve a pedir la agenda del día en lugar de confiar en lo que tenía en memoria. Es
  lo que garantiza que un médico no vea una agenda congelada sin saberlo.

### M6 · Recordatorios — RF-41 … RF-45

Funciones: programar el envío, enviarlo, reintentarlo, descartarlo si el turno ya no aplica.

- **Programación**: un turno `reservado` con email genera un registro en `EnvioRecordatorio` para
  24 h antes del inicio de su franja. Si ese momento ya pasó, no se genera nada (RF-41).
- **RF-43 (email cargado tarde)**: cargar el email de un paciente dispara la misma programación
  para sus turnos `reservado` pendientes. Es la misma función que usa M4 al crear, no una segunda
  implementación.
- **RF-44 (supresión)**: al alcanzar un estado terminal, el registro de envío pendiente pasa a
  `descartado`. Un envío que ya salió no se retira: está fuera de alcance
  (`spec.md:332-333`).
- **RF-45 (reintento)**: el fallo deja el registro con su próximo intento. **[supuesto]** Tres
  intentos con espera creciente, y al agotarlos el registro queda en estado terminal de fallo sin
  intervención de un usuario, porque RF-45 no contempla intervención humana.

### M7 · Auditoría e historial — RF-46 … RF-49

Funciones: registrar alta y cambios, servir el historial.

- **RF-46 / RF-47 (registro)**: la escritura del evento ocurre en la misma transacción que el
  cambio de estado. Un cambio sin registro no es posible, ni por error.
- **RF-30 (autor `sistema`)**: el paso automático a `no_asistio` registra origen `sistema` y autor
  nulo, para que la auditoría distinga "lo hizo recepción" de "lo hizo el sistema".
- **RF-48 / RF-49 (historial)**: la consulta filtra por franja ya transcurida y estado terminal.
  El acceso se restringe a recepción en el backend: es un dato de agenda, no un dato de consulta
  clínica.

---

## 4. Decisiones técnicas y alternativas descartadas

Cada decisión indica la alternativa considerada y por qué se descartó. Las que no están en el
alcanance de la Constitución.

### 4.1 Sesión en cookie con tabla propia, en lugar de JWT

**Elegido:** cookie de sesión opaca, con el registro de la sesión en la base.

*Descartado:* JWT. El token se autovalidaría sin consultar la base, pero RF-06 exige que cerrar
sesión deje de exponer los datos, y con JWT el token sigue siendo válido hasta expirar. Habría que
anadir una lista de revocación, que es la sesión en base con más pasos. Además, RF-07 pide sesiones
que no expiran: un JWT sin expiración no se puede revocar con la limitación de tamaño que tiene.

### 4.2 Franjas derivadas del horario, en lugar de una tabla de franjas

**Elegido:** el horario del médico define un patrón; las franjas se calculan al vuelo a partir de la
duración fija y el horario vigente de esa fecha.

*Descartado:* materializar una tabla `Franja` con una fila por bloque agendable. Simplificaría la
consulta de disponibilidad, pero RF-17 permite cambiar el horario a futuro, y eso obliga a
recalcular y reconciliar filas existentes en cada cambio, decidiendo qué pasa con las que ya
estaban reservadas. Con derivación, un turno guarda su propia fecha y hora de inicio y no depende
de que el patrón siga igual. El costo es que la disponibilidad se calcula en cada consulta, lo que
es holgado para el volumen de un consultorio.

### 4.3 Un solo registro por médico, en lugar de un historial de horarios

**Elegido:** `HorarioMedico` versionado con fecha de vigencia.

*Descartado:* dos columnas de horario en `Medico`. Es más simple, pero un cambio de horario
destruye el patrón pasado, y sin él no se puede reconstruir qué franjas existían en una fecha
anterior — que es lo que necesitan RF-30 (¿venció una franja?) y RF-32 (¿la franja está libre?).

### 4.4 Restricción de estado en el esquema, en lugar de solo en el código

**Elegido:** el conjunto de cinco estados es una restricción de dominio, y la tabla de
transiciones vive en el código de M4.

*Descartado:* activar la tabla de transiciones como disparador de base de datos. Sería la
integridad más fuerte, pero el disparador tendría que reconstruir la tabla de transiciones en SQL,
con los roles dentro de la base, y quedaría duplicada respecto de M4. La Constitución quiere que el
modelo relacional aporte integridad, y eso ya ocurre con los índices parciales de §2.2, que son
donde importa. La tabla de transiciones se queda en el código, en un solo lugar.

### 4.5 Sesiones en la base, en lugar de en memoria

**Elegido:** sesiones persistidas.

*Descartado:* sesiones solo en memoria del proceso. Cumple RF-07 sin vencimiento, pero un reinicio
del servidor cierra todas las agendas, incluidos los médicos a mitad de jornada. En un consultorio
con un único proceso, el reinicio ocurre en el momento menos pensado.

### 4.6 Proveedor de email

**Elegido:** un proveedor transaccional con API sobre HTTPS, con la bandeja `EnvioRecordatorio`
como propietaria del estado del envío.

*Descartado:* SMTP directo con Nodemailer. Evita un intermediario, pero deja el envío en manos de la
configuración del consultorio, que es exactamente la parte que no se quiere depender. La
dependencia con el proveedor es inevitable en cualquier caso —RF-45 ya la asume—; lo que se busca es
que esa dependencia no sea también una dependencia de la red del consultorio.

*Descartado también:* un proveedor transaccional frente a uno de marketing. La diferencia real es
que el segundo no garantiza entrega ni reporta rebotes de forma utilizable, y RF-45 necesita saber
que un envío falló.

### 4.7 Comparación de franjas por igualdad, en lugar de solapamiento

**Elegido:** dos turnos se pisan solo si comparten médico, fecha y hora de inicio.

*Descartado:* comparación por solapamiento de intervalos. Es más correcta en el abstracto, pero
con duración fija y un patrón uniforme la igualdad da el mismo resultado, y es expresable como un
índice único parcial (§2.2). El solapamiento obligaría a comparar rangos en el chequeo y dejaría de
poder garantizarse con el índice. Si algún día las duraciones fueran variables, esta decisión es la
primera que habría que revisar.

### 4.8 Concurrencia: aplicar la última acción, en lugar de bloqueo optimista

**Elegido:** sin versión ni bloqueo. La acción se aplica; si choca con el índice de unicidad, se
reporta como conflicto de negocio (franja ocupada).

*Descartado:* control de versiones optimista que rechace la escritura si el registro cambió. Es más
estricto, pero D-19 decidió explícitamente que la última acción gana, y rechazar la segunda sería
contradecir una decisión de alcance ya tomada. La consecuencia aceptada es que un turno puede
terminar `en_espera` si recepción y médico actúan con 20 ms de diferencia; RF-39 hace que todas las
agendas converjan a ese estado final.

### 4.9 Barrido periódico de inasistencias, en lugar de cálculo al leer

**Elegido:** un proceso que revisa periódicamente los turnos `reservado` cuya franja venció y aplica
la transición a `no_asistio`.

*Descartado:* calcular la inasistencia al leer la agenda, sin escribir. Es más simple y no requiere
un proceso que corra, pero RF-30 exige que el estado cambie y quede registrado (RF-46). Si el estado
solo se calculara al leer, un turno con inasistencia seguiría `reservado` en la base, ocuparía la
franja para las decisiones de disponibilidad, y no tendría evento de auditoría. La escritura al leer
—hacer el cambio dentro de un GET— resolvería eso, pero hace que una consulta screen modifique
datos, lo que complica caché, permisos y trazabilidad de errores.

*Descartado también:* un planificador externo (cron del sistema operativo). Agrega una dependencia
de infraestructura al despliegue más simple del producto, que es un consultorio corriendo en una
máquina.

### 4.10 Un solo modelo de usuario, en lugar de usuario más perfil de médico

**Elegido:** `Usuario` con rol, y `Medico` como perfil 1:1 para el horario.

*Descartado:* una sola tabla con columnas de horario y nombre opcionales. Menos tablas, pero cada
consulta de usuario tendría que filtrar las columnas que no aplican según el rol, y el modelo no
impide que un médico tenga horario y una recepcionista no. La Constitución separa roles; el modelo
refleja esa separación.

### 4.11 Orden de la espera por `llegada_en` proyectado, en lugar de derivado del historial

**Elegido:** columna `llegada_en` en `Turno`, escrita junto al evento de auditoría.

*Descartado:* derivar el orden agregando `TurnoEvento`. Evita duplicar el dato, pero obliga a
agregar eventos por turno para ordenar la cola, en la consulta que se dispara en cada push de
RF-38. La proyección se escribe en la misma transacción que el evento, que es la única forma de que
divergirían.

### 4.12 Sin)i18n de la interfaz

**Elegido:** la interfaz está en un solo idioma.

*Descartado:* preparado para varios idiomas desde el inicio. El producto es single-tenant para un
consultorio, y la Constitución prioriza funcionar bien para un consultorio antes que escalar. Los
mensajes de rechazo que el backend produce —RF-34— son parte de la API y se localizan en el
frontend, no en el servidor.

---

## 5. Fronteras del sistema

- **El backend es la única autoridad sobre el estado de un turno.** El frontend calcula qué botones
  mostrar (RF-35) pero ninguna acción se ejecuta si el servidor la rechaza.
- **El frontend no conoce la tabla de transiciones.** Recibe la lista de acciones disponibles desde
  la API. Duplicar esa tabla en el cliente es la forma más probable de que RF-35 y RF-26 se
  contradigan en producción.
- **El sistema de tiempo real no escribe en la base.** M5 difunde, M4 decide.
- **El proceso de email no cambia estados.** M6 lee la bandeja y envía; el estado del turno lo
  conoce M4.
- **El frontend detecta su propia conexión caída** y marca la agenda, porque el servidor no puede
  afirmar que un cliente está desconectado (RF-40).

---

## 6. Estrategia de tests

El riesgo del producto no está en las formas de carga ni en las pantallas: está en la máquina de
estados y en que dos personas miren la misma agenda. La estrategia pone el esfuerzo ahí.

### 6.1 Niveles

**Nivel 1 · Unidad — la tabla de transiciones y las reglas puras (M4, M2, M3)**
Sin base de datos, sin red. Se verifica la tabla de transiciones de forma exhaustiva por
combinación: para los cinco estados de origen × los cinco de destino × los tres roles, el sistema
acepta exactamente las cuatro filas de la tabla de `spec.md:180-185` y rechaza todo lo demás. Los
mensajes de RF-34 se verifican también como unidad, incluida la rama de estado terminal que motivó
D-7. Se cubren además el cálculo de franjas desde el horario, la validación de DNI y el cálculo de
la ventana de 24 h de RF-41.

**Nivel 2 · Integración — la base de datos real (M4, M7, M2)**
Contra un PostgreSQL real, no contra un doble. El objetivo es verificar que las reglas de §2.2 se
cumplen: los índices parciales rechazan el segundo turno activo del mismo médico y del mismo
paciente; los estados fuera del conjunto son rechazados por el esquema; no existe forma de borrar
un turno. Aquí se prueban las transiciones con su evento de auditoría en la misma transacción, y
RF-30 y RF-47 con sus eventos.

**Nivel 3 · Contrato de tiempo real (M5)**
Con dos clientes conectados, uno de ellos ejecuta la acción y el otro debe recibir el cambio sin
recargar (RF-38, RF-39). Se verifica también que un turno solo se difunde a la sala del médico
correspondiente y a la de recepción, no a las de otros médicos (RF-09).

**Nivel 4 · Extremo a extremo (M3, M4, M1)**
Sobre la aplicación. Se recorre el flujo completo con dos sesiones simultáneas —recepción y
médico— porque es la única forma de cubrir RF-35, RF-38 y RF-39 como los vive el consultorio. Aquí
se verifican RF-01, RF-02, RF-03, RF-09, RF-10, RF-11, RF-12, RF-13, RF-33 y RF-49 desde la interfaz.

### 6.2 Pruebas de tiempo y de concurrencia

Dos grupos que se planifican desde el principio porque no se pueden agregar al final:

- **Reloj controlado.** Toda prueba que dependa de la hora usa un reloj inyectable, no el reloj del
  sistema. Sin esto, RF-30, RF-41, RF-43 y RF-48 no son verificables: dependen de que una franja
  haya terminado o de que faltan 24 h. La encontré es la de la noche anterior: un turno `reservado`
  con la franja vencida de ayer no puede convertirse en inasistencia durante una prueba normal.
- **Concurrencia real.** RF-37 se prueba con dos peticiones simultáneas sobre el mismo turno y
  sobre la misma franja, verificando que queda un solo turno activo y que ambas agendas reflejan el
  mismo estado. Es la prueba que valida la decisión de §4.8 contra el índice parcial de §2.2.

### 6.3 Trazabilidad de las pruebas

Cada prueba declara el RF que cubre y cada RF tiene al menos una. La matriz completa está en la
sección 8. No se acepta una prueba que no apunte a un RF: sería funcionalidad no especificada.

**Cobertura exigida sin excepción:** RF-25, RF-26, RF-27, RF-28, RF-29, RF-30, RF-31, RF-33, RF-34
— la máquina de estados completa, incluida la excepción retroactiva de D-9. **Cobertura exigida
para los requisitos de la Constitución:** cada no negociable de `constitucion.md:45-49` tiene al
menos una prueba, aunque el RF equivalente ya esté cubierto.

### 6.4 Qué no se prueba y por qué

- **Pruebas de carga y rendimiento.** Un consultorio genera decenas de turnos por día. La
  preocupación real de volumen es el envío de emails programados, que se mide en el tiempo, no en
  la concurrencia.
- **Pruebas del proveedor de email real.** RF-45 se verifica con un doble que falla a demanda; el
  proveedor se integra en el despliegue y su comportamiento no es controlable desde el tests.
- **Pruebas de la interfaz de usuario más allá del flujo.** No hay estados de carga, animaciones
  ni responsive dentro del alcance, así que no hay nada que exigirle.

---

## 7. Orden de construcción

El orden sigue dependencias reales, no el orden de los RF.

1. **M1 y M2** — sin ellos no hay nada que probar. También resuelven los pendientes de
   `spec.md:382-389` si el negocio los define antes de empezar.
2. **M4** — la máquina de estados y el modelo. Es la parte de la que depende el resto, y la que
   más pruebas lleva.
3. **M3** — la agenda es lo que hace utilizable a M4.
4. **M7** — la auditoría se escribe dentro de M4, así que va con él; la consulta de historial puede
   esperar al final.
5. **M5** — el tiempo real, que solo se puede probar con dos clientes reales.
6. **M6** — el recordatorio, que es el único módulo con dependencia externa y el único que puede
   fallar sin que el sistema se entere.

---

## 8. Matriz de trazabilidad

| RF | Módulo | Nivel de prueba |
|---|---|---|
| RF-01 | M1 | E2E |
| RF-02 | M1 | E2E + unidad (mensaje) |
| RF-03 | M1 | E2E + integración |
| RF-04 | M1 | E2E + integración |
| RF-05 | M1 | E2E (verificación de despliegue) |
| RF-06 | M1 | E2E |
| RF-07 | M1 | E2E |
| RF-08 | transversal | integración (valores de fecha) |
| RF-09 | M3 | contrato + E2E |
| RF-10 | M3 | E2E |
| RF-11 | M3 | E2E |
| RF-12 | M3 | unidad (orden) + E2E |
| RF-13 | M3 | integración + E2E |
| RF-14 | M2 | integración |
| RF-15 | M2 | unidad (formato) + integración (unicidad) |
| RF-16 | M2 | integración + E2E |
| RF-17 | M2 | integración |
| RF-18 | M2 | integración |
| RF-19 | M2 | integración |
| RF-20 | M3 | unidad (cálculo) + integración |
| RF-21 | M4 | integración |
| RF-22 | M4 | integración (índice parcial) |
| RF-23 | M4 | integración (índice parcial) |
| RF-24 | M4 | integración |
| RF-25 | M4 | integración (esquema) |
| RF-26 | M4 | unidad (exhaustiva) + integración |
| RF-27 | M4 | unidad + integración |
| RF-28 | M4 | unidad + integración |
| RF-29 | M4 | unidad + integración |
| RF-30 | M4 | unidad (reloj) + integración |
| RF-31 | M4 | unidad + integración |
| RF-32 | M4 | integración |
| RF-33 | M4 | unidad (matriz rol×estado) + E2E |
| RF-34 | M4 | unidad (ambas ramas del mensaje) |
| RF-35 | M4 | E2E (acción por estado y rol) |
| RF-36 | M4 | integración (no existe vía de borrado) |
| RF-37 | M4 | integración (concurrencia real) |
| RF-38 | M5 | contrato |
| RF-39 | M5 | contrato |
| RF-40 | M5 | contrato |
| RF-41 | M6 | unidad (ventana de 24 h) + integración |
| RF-42 | M6 | integración |
| RF-43 | M6 | integración |
| RF-44 | M6 | integración |
| RF-45 | M6 | integración (doble que falla) |
| RF-46 | M7 | integración |
| RF-47 | M7 | integración |
| RF-48 | M7 | integración |
| RF-49 | M7 | E2E |

**Cobertura:** los 49 RF tienen al menos un nivel de prueba asignado, y cada uno tiene al menos un
criterio de finalización en `spec.md:412-504`.

---

## 9. Riesgos técnicos

| Riesgo | Origen | Mitigación prevista |
|---|---|---|
| Gestión de contraseñas sin resolver | `spec.md:382-383` | Ninguna hasta que el negocio defina. Un médico que pierde su clave queda fuera del sistema y recepción no puede ayudarlo. |
| Franja de duración no fijada | `spec.md:388-389` | La duración se resuelve como un parámetro del sistema (§4.2). Si resulta variable por médico, la decisión de §4.7 es la primera que hay que revisar. |
| Colisiones silenciosas por D-19 | `spec.md:371` | Aceptado. El índice parcial impide el daño estructural (RF-22, RF-23) y RF-39 hace converger las agendas. Un turno puede terminar en un estado distinto del que quien miraba la pantalla esperaba. |
| Zona horaria mal configurada | RF-08 | Es un parámetro de instalación, y todo el cálculo de franjas depende de él. Debe fijarse antes del primer despliegue y no cambiarse después. |
| Proveedor de email caído | RF-45 | La bandeja persiste el envío pendiente; nada se pierde, solo se demora. |
