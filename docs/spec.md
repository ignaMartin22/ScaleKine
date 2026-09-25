# Especificación — Sistema de Turnos para Kinesiología

**Documento de alcance funcional.** Describe *qué* debe hacer el sistema y *por qué*.
No contiene decisiones de implementación: esas van en `plan.md`.

Cada requisito está expresado en notación EARS y numerado como `RF-nn`. La sección 7 traduce
cada `RF` a un criterio de finalización verificable.

---

## 1. Problema y objetivo

La coordinación entre recepción y los médicos se hace hoy de forma manual: la recepcionista no
tiene una forma fiable de avisar que el paciente llegó, y el médico no tiene visibilidad de quién
lo espera sin que alguien interrumpa la consulta en curso.

El sistema debe:

- **Dar visibilidad al médico** de quién está esperando, en tiempo real y sin interrupciones.
- **Dar a recepción una herramienta única** para gestionar la agenda del día.
- **Dejar registro** de cada turno y de cada cambio de estado, con autor y momento.

---

## 2. Actores, definiciones y convenciones

| Actor | Acceso | Responsabilidad |
|---|---|---|
| Recepcionista | Login propio | Carga de pacientes, médicos y turnos; gestión de la agenda; control de estados |
| Médico / Kinesiólogo | Login propio | Consulta su agenda y cierra sus turnos |
| Paciente | Sin acceso | Recibe el recordatorio por email |

**Definiciones:**

- **Franja:** bloque horario de duración fija dentro del horario de atención de un médico. Dos
  turnos se pisan solo si ocupan **la misma franja**.
- **Turno activo:** turno en estado `reservado` o `en_espera`. Solo los turnos activos ocupan su
  franja.
- **Estado terminal:** `finalizado`, `cancelado` o `no_asistio`. Un turno terminal no admite más
  cambios de estado y libera su franja.
- **Inasistencia:** un turno `reservado` cuya franja terminó sin que nadie lo marcara `en_espera`.
- **Zona horaria:** única, configurable al instalar. Todas las fechas, franjas y horas del sistema
  se interpretan en esa zona.
- **Anticipación del recordatorio:** 24 horas antes del inicio de la franja.

---

## 3. Requisitos funcionales (EARS)

### 3.1 Acceso y cuentas

- **RF-01** — *Evento:* Cuando un usuario se autentica con credenciales válidas, entonces el
  sistema lo redirige a la pantalla de su rol.
  *Por qué:* Cada rol tiene un alcance distinto sobre la agenda y las acciones disponibles.

- **RF-02** — *Evento:* Cuando un usuario intenta autenticarse con credenciales inválidas, entonces
  el sistema rechaza el acceso e informa que las credenciales no son válidas, sin revelar cuál
  parte fue incorrecta.
  *Por qué:* Evitar que un tercero enumere los usuarios del consultorio.

- **RF-03** — *Evento:* Cuando un usuario autenticado intenta una acción que su rol no permite,
  entonces el sistema la rechaza e informa que no está autorizado, sin alterar ningún dato.
  *Por qué:* La separación entre recepción y médico es una regla de negocio, no una comodidad de
  interfaz.

- **RF-04** — *Evento:* Cuando recepción crea la cuenta de un médico o de un profesional de
  recepción, con un rol asignado, entonces el sistema la registra y la deja activa.
  *Por qué:* El alta de personal es una decisión interna del consultorio. Cada persona con su
  propia cuenta es lo que hace auditable quién hizo cada cambio.

- **RF-05** — *Evento:* Al habilitarse el sistema por primera vez, entonces existe al menos una
  cuenta de recepción activa.
  *Por qué:* Sin una cuenta inicial nadie podría crear las demás y el consultorio quedaría sin
  acceso.

- **RF-06** — *Evento:* Cuando un usuario cierra sesión, entonces el sistema invalida su sesión y la
  pantalla deja de mostrar los datos de la agenda.
  *Por qué:* La agenda contiene datos personales de pacientes y no debe quedar expuesta en un
  equipo compartido.

- **RF-07** — *Restricción:* Mientras un usuario permanezca autenticado, entonces su sesión no
  expira por inactividad.
  *Por qué:* El médico deja la pantalla en la sala de espera y vuelve a la consulta; cerrarla por
  inactividad lo saca del sistema justo cuando más lo necesita.

- **RF-08** — *Restricción:* El sistema interpreta todas las fechas, franjas y horas en una única
  zona horaria, configurada al instalarse.
  *Por qué:* Un consultorio opera en un solo huso. Mezclarlos desalinea la agenda, la hora de
  llegada y el momento del recordatorio.

### 3.2 Alcance de la agenda

- **RF-09** — *Restricción:* Mientras un usuario esté autenticado como médico, entonces el sistema
  le muestra únicamente los turnos que tiene asignados.
  *Por qué:* El médico solo atiende su agenda; ver la de otros no aporta nada a su consulta.

- **RF-10** — *Evento:* Cuando recepción solicita la agenda, entonces el sistema le muestra los
  turnos de todos los médicos, filtrables por fecha y por médico.
  *Por qué:* Recepción coordina el día completo del consultorio, no una agenda individual. El
  acceso a un paciente puntual se resuelve por nombre o DNI (RF-19).

- **RF-11** — *Restricción:* Mientras se muestra un turno en una agenda, entonces el sistema muestra
  paciente, médico, fecha, franja, estado actual y, si está `en_espera`, la hora en que fue marcado
  como tal. Los dos roles ven los mismos campos.
  *Por qué:* Recepción necesita localizar un turno por cualquiera de estos datos, y el médico
  necesita la hora de llegada para ordenar la espera.

- **RF-12** — *Restricción:* Mientras un turno se encuentre `en_espera`, entonces el sistema lo
  presenta ordenado por hora de llegada en la agenda del médico.
  *Por qué:* Saber quién espera solo es accionable si además se sabe a quién atiende primero.

- **RF-13** — *Evento:* Cuando recepción abre la agenda de una fecha, entonces el sistema le muestra
  cuántas inasistencias quedaron registradas en esa fecha.
  *Por qué:* La inasistencia se resuelve sola y no genera ninguna alerta; sin un contador, recepción
  no se entera de que dejó de venir gente.

### 3.3 Datos maestros

- **RF-14** — *Evento:* Cuando recepción registra un paciente con nombre y DNI válidos, entonces el
  sistema lo guarda y lo hace disponible para agendar; email y teléfono son opcionales.
  *Por qué:* El paciente es la entidad alrededor de la que gira todo el registro de turnos, pero
  exigirle un canal de contacto dejaría al consultorio sin agendar (decisión D-1).

- **RF-15** — *Comportamiento no deseado:* Si el DNI no tiene un formato válido, o ya está
  registrado en otro paciente, entonces el sistema impide el alta o la edición e informa el motivo.
  *Por qué:* El DNI identifica al paciente y alimenta la deduplicación; sin validación, se cargan
  pacientes duplicados o con el documento mal tipeado.

- **RF-16** — *Evento:* Cuando recepción registra un médico con nombre y horario de atención, entonces
  el sistema lo guarda y le habilita su agenda y su cuenta.
  *Por qué:* Cada médico necesita un espacio de agenda independiente y una cuenta propia, y su
  horario es lo que define qué franjas se pueden ofrecer.

- **RF-17** — *Evento:* Cuando recepción modifica el horario de atención de un médico, entonces el
  sistema aplica el cambio solo a las franjas futuras y no altera los turnos ya registrados.
  *Por qué:* Un médico puede ampliar o reducir su disponibilidad, pero cambiar su horario no debe
  desarmar la agenda que ya quedó reservada.

- **RF-18** — *Evento:* Cuando recepción edita los datos de un paciente o de un médico, entonces el
  sistema guarda los cambios y revalida el DNI.
  *Por qué:* Un alta equivocada no se puede deshacer; el sistema tiene que permitir corregirla sin
  perder la garantía de unicidad.

- **RF-19** — *Evento:* Cuando se busca un paciente o un médico por nombre o DNI, entonces el
  sistema muestra las coincidencias.
  *Por qué:* Sin búsqueda, recepción no reutiliza los datos ya cargados y termina duplicando
  pacientes.

### 3.4 Creación de turnos

- **RF-20** — *Evento:* Cuando recepción solicita las franjas disponibles de un médico en una fecha,
  entonces el sistema devuelve las franjas sin turno activo dentro de su horario de atención, tanto
  para ese médico como para el paciente elegido.
  *Por qué:* Recepción necesita ver directamente qué puede ofrecer, sin calcularlo a mano y sin
  ofrecer una franja que la creación vaya a rechazar.

- **RF-21** — *Evento:* Cuando recepción crea un turno con paciente, médico, fecha y franja válidos, y
  la franja está libre para el médico y para el paciente, entonces el sistema registra el turno en
  estado `reservado`.
  *Por qué:* La reserva es el punto de partida del ciclo de vida. Se admiten fechas ya vencidas para
  permitir carga retroactiva (decisión D-13).

- **RF-22** — *Comportamiento no deseado:* Si la franja seleccionada ya tiene un turno activo para
  ese médico, entonces el sistema impide crear el turno e informa que la franja está ocupada.
  *Por qué:* Un médico no puede atender a dos pacientes en la misma franja.

- **RF-23** — *Comportamiento no deseado:* Si el paciente ya tiene un turno activo en esa misma
  franja, entonces el sistema impide crear el turno e informa del conflicto.
  *Por qué:* Evita que el paciente se auto-doble-reserve y llegue a una consulta imposible.

- **RF-24** — *Comportamiento no deseado:* Si el turno se crea sin paciente, médico, fecha o franja
  válidos, entonces el sistema impide la creación e informa qué dato falta.
  *Por qué:* Un turno incompleto no es agendable y rompe la trazabilidad del historial.

### 3.5 Ciclo de vida del turno

El sistema reconoce exactamente cinco estados: `reservado`, `en_espera`, `finalizado`, `cancelado`
y `no_asistio`. Estas son las únicas transiciones permitidas:

| Desde | Hacia | Quién puede ejecutarla | Condición |
|---|---|---|---|
| `reservado` | `en_espera` | Recepción | Ninguna |
| `reservado` | `cancelado` | Recepción | Ninguna |
| `reservado` | `no_asistio` | Sistema | La franja terminó y el turno ya existía cuando terminó |
| `en_espera` | `finalizado` | Médico o recepción | Ninguna |

- **RF-25** — *Restricción:* El sistema reconoce únicamente los cinco estados definidos en esta
  sección; ningún otro valor es válido para un turno.
  *Por qué:* Un conjunto cerrado de estados es lo que hace verificable que el historial de un
  paciente nunca contenga una secuencia imposible.

- **RF-26** — *Restricción:* El sistema solo admite las transiciones de la tabla anterior; cualquier
  otra se rechaza sin modificar el turno.
  *Por qué:* El estado es el registro de lo que ocurrió; permitir atajos o retrocesos lo vuelve una
  secuencia imposible.

- **RF-27** — *Evento:* Cuando recepción marca un turno `reservado` como `en_espera`, entonces el
  sistema cambia su estado y registra el cambio.
  *Por qué:* Es la señal de que el paciente llegó, que es el hecho que el médico necesita ver. Se
  admite incluso en una franja ya vencida, para poder registrar una carga retroactiva (D-13).

- **RF-28** — *Evento:* Cuando el médico o recepción marcan un turno `en_espera` como `finalizado`,
  entonces el sistema cambia su estado y registra el cambio.
  *Por qué:* Cierra el turno y lo hace visible en el historial. Ambos roles deben poder hacerlo
  porque el médico cierra su consulta y recepción necesita resolver los casos en que el paciente
  no llegó a ser atendido o se retiró.

- **RF-29** — *Evento:* Cuando recepción marca un turno `reservado` como `cancelado`, entonces el
  sistema cambia su estado y libera la franja.
  *Por qué:* El paciente puede no asistir o avisar que no viene. Cancelar deja la franja
  reutilizable en lugar de bloquearla.

- **RF-30** — *Evento:* Cuando termina la franja de un turno `reservado` que ya existía antes de que
  terminara, entonces el sistema cambia su estado a `no_asistio` y registra el cambio.
  *Por qué:* Sin esta salida, el turno quedaría `reservado` para siempre, con la franja bloqueada y
  fuera del historial. Es lo que mantiene la cola del médico limpia sin depender de que recepción
  actúe.

- **RF-31** — *Restricción:* Mientras un turno se encuentre en estado terminal, entonces el sistema
  no admite ningún cambio de estado sobre él.
  *Por qué:* Alterar un estado terminal destruiría el registro de lo ocurrido.

- **RF-32** — *Evento:* Cuando un turno alcanza un estado terminal, entonces su franja queda
  disponible para nuevas reservas.
  *Por qué:* La franja de un turno que ya terminó o que se canceló no debe seguir bloqueando la
  agenda.

- **RF-33** — *Comportamiento no deseado:* Si el médico intenta marcar un turno como `en_espera` o
  como `cancelado`, entonces el sistema rechaza la acción e informa que esa acción es de recepción.
  *Por qué:* "El paciente llegó" y "el paciente no viene" son hechos que confirma recepción, que es
  quien está en contacto con el consultorio.

- **RF-34** — *Comportamiento no deseado:* Si se intenta una transición no permitida, entonces el
  sistema no modifica el turno e informa cuál es la transición válida desde su estado actual; si el
  turno está en estado terminal, informa que el turno está cerrado y no tiene acciones disponibles.
  *Por qué:* Un rechazo que no explica la regla hace que el sistema se perciba como roto, y un
  rechazo que promete una transición que no existe es peor.

- **RF-35** — *Restricción:* Mientras un turno esté en un estado que admita transición para el rol del
  usuario que mira, entonces el sistema muestra la acción correspondiente; en los estados
  terminales no muestra ninguna. Sobre un turno `reservado`, recepción ve siempre tanto la acción
  de llegada como la de cancelación.
  *Por qué:* Las reglas de transición deben ser descubribles sin que el usuario las aprenda a los
  golpes, y las acciones disponibles dependen de quién mira.

- **RF-36** — *Restricción:* El sistema no permite eliminar un turno; todo turno Conserva su registro
  hasta alcanzar un estado terminal.
  *Por qué:* Borrar destruiría evidencia y permitiría hacer desaparecer turnos. Un turno creado por
  error se resuelve cancelándolo y creando el correcto.

- **RF-37** — *Evento:* Cuando un turno cambia de estado mientras otra persona está accionándolo, o
  se intenta crear un turno sobre una franja que otra persona acaba de reservar, entonces el sistema
  aplica el cambio recibido y lo refleja en las agendas abiertas.
  *Por qué:* En un consultorio con varias recepcionistas las acciones se cruzan; el sistema no debe
  bloquear el trabajo de nadie por una colisión, y todas las agendas deben converger al mismo
  estado (RF-39).

### 3.6 Visibilidad en tiempo real

- **RF-38** — *Evento:* Cuando un turno cambia a `en_espera`, entonces la agenda del médico
  correspondiente lo refleja sin que el médico recargue la página.
  *Por qué:* Es el objetivo central del producto: que el médico sepa quién espera sin que nadie
  interrumpa la consulta en curso.

- **RF-39** — *Evento:* Cuando un turno cambia de estado por cualquier acción, entonces todas las
  agendas abiertas que lo muestran reflejan el nuevo estado sin recarga manual.
  *Por qué:* Varias personas miran la misma agenda; una vista divergente genera desconfianza y
  llamadas de verificación.

- **RF-40** — *Restricción:* Mientras la conexión con el sistema esté interrumpida, entonces el
  sistema advierte que la agenda puede estar desactualizada; una vez restablecida la conexión, el
  sistema sincroniza la pantalla con el estado actual de los turnos.
  *Por qué:* Un médico que ve una agenda congelada puede tomar decisiones sobre datos viejos sin
  saberlo.

### 3.7 Recordatorio al paciente

- **RF-41** — *Evento:* Cuando se cumple la anticipación de un turno que sigue `reservado` y el
  paciente tiene email cargado, entonces el sistema envía el recordatorio a ese email.
  *Por qué:* El recordatorio reduce el ausentismo, que es el costo operativo principal de la agenda.
  Si el turno se reserva con menos de 24 h de antelación, el recordatorio no se envía.

- **RF-42** — *Comportamiento no deseado:* Si el paciente no tiene email cargado, entonces el
  sistema no envía recordatorio de ese turno y la reserva no se bloquea.
  *Por qué:* Decisión D-1: la reserva nunca se pierde por falta de canal de contacto.

- **RF-43** — *Evento:* Cuando se carga el email de un paciente que ya tiene turnos `reservado`
  pendientes, entonces el sistema programa el recordatorio de cada uno según la anticipación.
  *Por qué:* La reserva sin recordatorio fue una limitación de los datos, no una decisión del
  consultorio; en cuanto se conoce el email, la información debe aprovecharse.

- **RF-44** — *Comportamiento no deseado:* Si un turno alcanza `cancelado` o `no_asistio`, entonces
  el sistema no envía el recordatorio de ese turno.
  *Por qué:* Avisar de un turno que ya no existe degrada la confianza en el canal de contacto.

- **RF-45** — *Opcional:* Donde el envío del email falle por un error del proveedor externo, entonces
  el sistema reintenta el envío sin intervención de un usuario.
  *Por qué:* El resultado del recordatorio depende de la disponibilidad de un tercero; un fallo
  transitorio no debe requerir que alguien esté pendiente.

### 3.8 Auditoría e historial

- **RF-46** — *Evento:* Cuando el estado de un turno cambia, entonces el sistema registra el estado
  anterior, el nuevo, quién lo ejecutó y cuándo.
  *Por qué:* Sin trazabilidad, un reclamo sobre un turno no se puede reconstruir.

- **RF-47** — *Evento:* Cuando un turno se crea, entonces el sistema registra quién lo creó y cuándo.
  *Por qué:* El alta es el primer hecho del turno y quien la hizo es tan relevante como quién
  cambió un estado después.

- **RF-48** — *Evento:* Cuando un turno alcanza un estado terminal y su franja ya transcurrió,
  entonces ese turno pasa a formar parte del historial del paciente.
  *Por qué:* El historial responde por lo que pasó. Un turno a futuro no es historial todavía.

- **RF-49** — *Evento:* Cuando recepción consulta el historial de un paciente, entonces el sistema
  muestra sus turnos con franja ya transcurida, en estado terminal, con fecha, médico y estado
  final. Ningún otro rol puede consultarlo.
  *Por qué:* Recepción responde las consultas de agenda. El historial de otros pacientes no aporta
  nada a la consulta que el médico está atendiendo.

---

## 4. Fuera de alcance

**Esta lista es la fuente de verdad del alcance.** La constitución la referencia y no la duplica.

Los puntos siguientes quedan explícitamente fuera del MVP y no deben implementarse salvo decisión
nueva, conforme al no negociable de la constitución.

- **Borrado de turnos.** Un turno mal creado se cancela y se rehace (RF-36).
- **Reintento o reversión de cambios de estado.** Un error de carga se resuelve con un nuevo turno.
- **Notificación al paciente de una cancelación o una inasistencia.** El paciente recibe el
  recordatorio previo y nada más.
- **Cancelación por parte del paciente.** El paciente no accede al sistema.
- **Cancelación de un turno ya iniciado.** `en_espera` y los estados terminales no son cancelables
  (RF-31); un paciente que llega y se retira se resuelve con RF-28.
- **SMS, WhatsApp o notificaciones push.** El MVP envía únicamente email.
- **Facturación, historia clínica, evolución del paciente o notas de la consulta.** El sistema
  gestiona turnos, no información clínica.
- **Gestión de licencias, feriados o vacaciones.** El horario de atención es el que carga recepción.
- **Reportes, métricas, estadísticas o exportación de datos.**
- **Self-service del paciente** (pedir, reprogramar o cancelar turno).
- **Multi-tenant.** Un despliegue es un consultorio.
- **App móvil nativa.** El alcance es web.
- **Auditoría de navegación** (quién consultó qué). Solo se registran altas y cambios de estado.

---

## 5. Decisiones de alcance y su motivo

| # | Decisión | Motivo |
|---|---|---|
| D-1 | El turno se crea aunque el paciente no tenga email ni teléfono; el recordatorio simplemente no se envía. | Exigir un canal de contacto dejaría al consultorio sin agendar. Un turno sin aviso es mejor que ningún turno. |
| D-2 | La superposición se valida por médico **y** por paciente, sobre la misma franja. | Evita que el paciente se auto-doble-reserve y llegue a una consulta imposible. |
| D-3 | Los cambios de estado no tienen ventana temporal. | Permite corregir la carga de datos tarde, incluida la carga retroactiva. |
| D-4 | El recordatorio por email entra en el MVP; los demás canales quedan afuera. | El ausentismo es el costo principal de la agenda. |
| D-5 | Cada persona tiene su propia cuenta y recepción las crea, incluidas las de recepción. | La constitución exige un login por rol. Dos personas en una misma cuenta destruirían la auditoría. |
| D-6 | Se agrega el estado terminal `cancelado`, solo por recepción y solo desde `reservado`. | Sin él, el paciente que avisa que no viene deja su turno en `reservado` y la franja bloqueada. |
| D-7 | Una transición inválida se rechaza sin modificar el turno; en un estado terminal el mensaje dice que el turno está cerrado. | Un rechazo que promete una transición inexistente es peor que un rechazo que explica la regla. |
| D-8 | La cancelación no tiene restricción de fecha. | Un turno `reservado` nunca llegó a abrirse, así que cancelarlo nunca borra evidencia. |
| D-9 | `no_asistio` es un estado propio y el sistema lo aplica solo al terminar la franja. **Excepción:** no se aplica a los turnos creados cuando su franja ya había vencido, que quedan en manos de recepción. | Es lo que mantiene la cola del médico limpia sin depender de que recepción actúe, y a la vez impide que la carga retroactiva (D-13) nazca muerta. |
| D-10 | El historial incluye solo turnos con franja ya transcurida. | La constitución lo define como "turnos anteriores"; un turno a futuro no es historial todavía. |
| D-11 | Recepción puede modificar el horario de un médico, con efecto solo a futuro. | Los médicos amplían o reducen su disponibilidad; cambiar el horario no debe desarmar la agenda ya agendada. |
| D-12 | El recordatorio se envía 24 h antes; si el turno se reserva con menos de antelación, no se envía. | Cubre el caso normal sin recargar al paciente con avisos de última hora. |
| D-13 | Se admite crear turnos con fecha ya vencida. | Recepción necesita registrar y corregir turnos viejos. |
| D-14 | Los datos de pacientes y médicos son editables por recepción, con el DNI revalidado. | Un alta equivocada no se puede deshacer; el sistema debe permitir corregirla. |
| D-15 | Cargar el email de un paciente dispara el recordatorio de sus turnos pendientes. | La falta de email fue una limitación de los datos, no una decisión del consultorio. |
| D-16 | No se avisa al paciente cuando su turno se cancela. Riesgo aceptado. | Evita un segundo tipo de email y todo lo que arrastra. En un consultorio chico lo resuelve un llamado de recepción. |
| D-17 | Las sesiones no expiran por inactividad. | El médico deja la pantalla en la sala de espera y volver a autenticarse lo saca del sistema en el peor momento. |
| D-18 | El fallo de envío de email se reintenta automáticamente. | Un fallo transitorio de un tercero no debe exigir que alguien esté pendiente. |
| D-19 | Ante dos acciones simultáneas sobre el mismo turno, la última se aplica. | En un consultorio chico bloquear el trabajo de recepción por una colisión es un costo mayor que el de converger al estado final. |
| D-20 | La creación de un turno también queda auditada. | El alta es el primer hecho del turno y quien la hizo importa tanto como quién cambió un estado después. |
| D-21 | El médico y recepción ven los mismos campos de un turno. | Un solo conjunto de datos que mantener, y la garantía de unicidad del DNI protege contra el registro duplicado. |
| D-22 | Solo recepción consulta el historial de un paciente. | Es la pantalla que responde consultas de agenda; no aporta a la consulta que el médico atiende. |
| D-23 | Recepción ve un contador de inasistencias por fecha. | La inasistencia se resuelve sola y no dispara ninguna alerta; sin el contador, nadie se entera. |
| D-24 | `spec.md` es la fuente de verdad del alcance; la constitución lo referencia. | Dos listas divergentes de "fuera de alcance" permiten reintroducir sin querer lo que se excluyó a propósito. |

### 5.1 Pendientes que requieren decisión del negocio

Estos puntos no están resueltos y bloquean la redacción de `plan.md`:

- **Gestión de contraseñas.** No hay requisito para cambiar una contraseña, recuperar una perdida,
  desactivar una cuenta ni entregarla a un médico nuevo. Hoy solo existe la creación (RF-04).
- **Asignación de la primera cuenta de recepción.** RF-05 exige que exista, pero no dice quién la
  define ni cómo se entrega.
- **Contenido del email de recordatorio.** El texto, el remitente y si incluye la dirección del
  consultorio no están definidos.
- **Duración de la franja.** La constitución la fija, pero su valor (30 minutos en el material de
  origen) nunca se будó explícito en la spec.

---

## 6. Reglas de negocio consolidadas

1. Solo existen cinco estados: `reservado`, `en_espera`, `finalizado`, `cancelado`, `no_asistio`.
2. Las transiciones válidas son exactamente las de la tabla de la sección 3.5.
3. `finalizado`, `cancelado` y `no_asistio` son terminales y liberan la franja.
4. Solo los turnos activos ocupan una franja.
5. Un paciente no puede tener dos turnos activos en la misma franja.
6. Un médico no puede tener dos turnos activos en la misma franja.
7. Todo alta y todo cambio de estado quedan registrados con autor y momento.
8. Ningún turno se elimina.

---

## 7. Criterios de finalización

El MVP se considera terminado cuando **todos** los puntos siguientes son verificables.

### 7.1 Acceso y convenciones

- [ ] Recepción y médico se autentican con credenciales propias y ven pantallas distintas (RF-01).
- [ ] Un login inválido se rechaza con un mensaje genérico (RF-02).
- [ ] Un rol no puede ejecutar acciones reservadas al otro, y se le informa sin alterar datos (RF-03).
- [ ] Recepción puede crear cuentas de médicos y de recepción, cada una activa y con su rol (RF-04).
- [ ] El sistema es utilizable desde el primer arranque, con una cuenta de recepción activa (RF-05).
- [ ] Cerrar sesión deja de exponer los datos de la agenda (RF-06).
- [ ] La sesión de un usuario no expira por inactividad (RF-07).
- [ ] Fechas, franjas y horas se interpretan en una única zona horaria configurable (RF-08).

### 7.2 Alcance de la agenda

- [ ] El médico ve únicamente los turnos que tiene asignados (RF-09).
- [ ] Recepción ve los turnos de todos los médicos y puede filtrar por fecha y por médico (RF-10).
- [ ] Cada turno en agenda muestra paciente, médico, fecha, franja, estado y hora de llegada si
      está `en_espera`, y ambos roles ven los mismos campos (RF-11).
- [ ] Los turnos `en_espera` aparecen ordenados por hora de llegada (RF-12).
- [ ] La agenda de una fecha muestra cuántas inasistencias tuvo (RF-13).

### 7.3 Datos maestros

- [ ] Recepción registra un paciente con nombre y DNI, sin email ni teléfono si no los tiene
      (RF-14).
- [ ] Un DNI con formato inválido o ya registrado se rechaza, tanto al crear como al editar
      (RF-15).
- [ ] Recepción registra un médico con nombre y horario, y este queda con agenda y cuenta propias
      (RF-16).
- [ ] Cambiar el horario de un médico solo afecta a las franjas futuras (RF-17).
- [ ] Recepción puede editar los datos de un paciente o un médico, y el DNI se revalida (RF-18).
- [ ] La búsqueda por nombre o DNI encuentra pacientes y médicos existentes (RF-19).

### 7.4 Turnos

- [ ] Recepción ve las franjas libres de un médico para una fecha, ya filtradas también por el
      paciente elegido (RF-20).
- [ ] Un turno se crea en `reservado` con paciente, médico, fecha y franja válidos, y admite fecha
      ya vencida (RF-21).
- [ ] No se puede crear un turno en una franja con turno activo del mismo médico (RF-22).
- [ ] No se puede crear un turno en una franja con turno activo del mismo paciente (RF-23).
- [ ] Un turno con datos faltantes no se crea, y el mensaje indica cuál falta (RF-24).

### 7.5 Estados

- [ ] El sistema no reconoce ningún estado fuera de los cinco definidos (RF-25).
- [ ] Solo existen las transiciones de la tabla; cualquier otra se rechaza sin modificar el turno
      (RF-26).
- [ ] `reservado` → `en_espera` solo lo ejecuta recepción, incluso en una franja vencida (RF-27).
- [ ] `en_espera` → `finalizado` lo ejecutan médico o recepción (RF-28).
- [ ] `reservado` → `cancelado` solo lo ejecuta recepción (RF-29).
- [ ] Al terminar la franja, un turno `reservado` que ya existía pasa solo a `no_asistio`; uno creado
      con la franja vencida no pasa solo (RF-30).
- [ ] Un turno terminal no admite más cambios de estado (RF-31).
- [ ] La franja de un turno terminal queda disponible para nuevas reservas (RF-32).
- [ ] El médico no puede marcar `en_espera` ni `cancelado` (RF-33).
- [ ] Una transición rechazada no modifica el turno e indica la válida; sobre un turno terminal
      indica que está cerrado y no tiene acciones (RF-34).
- [ ] Las acciones visibles dependen del estado y del rol; sobre un `reservado`, recepción ve
      siempre llegada y cancelación (RF-35).
- [ ] No existe ninguna forma de eliminar un turno (RF-36).
- [ ] Dos acciones simultáneas sobre el mismo turno convergen al último estado aplicado y todas las
      agendas lo reflejan (RF-37).

### 7.6 Tiempo real

- [ ] El médico ve un turno pasar a `en_espera` sin recargar la página (RF-38).
- [ ] Los cambios de estado se propagan a todas las agendas abiertas sin recarga manual (RF-39).
- [ ] Una interrupción de conexión advierte que la agenda puede estar desactualizada, y al
      reconectar la pantalla se sincroniza (RF-40).

### 7.7 Recordatorio

- [ ] Un turno `reservado` con email dispara el recordatorio 24 h antes del inicio de su franja
      (RF-41).
- [ ] Un turno reservado con menos de 24 h de antelación no dispara recordatorio (RF-41).
- [ ] Un turno sin email no dispara recordatorio y no bloqueó la reserva (RF-42).
- [ ] Cargar el email de un paciente dispara el recordatorio de sus turnos `reservado` pendientes
      (RF-43).
- [ ] Un turno `cancelado` o `no_asistio` no dispara recordatorio (RF-44).
- [ ] Un fallo de envío se reintenta sin intervención de un usuario (RF-45).

### 7.8 Auditoría e historial

- [ ] Cada cambio de estado registra estado anterior, estado nuevo, autor y momento (RF-46).
- [ ] La creación de un turno registra quién lo creó y cuándo (RF-47).
- [ ] Solo los turnos terminales cuya franja ya transcurrió aparecen en el historial (RF-48).
- [ ] Recepción ve fecha, médico y estado final de cada turno del historial; ningún otro rol puede
      consultarlo (RF-49).

### 7.9 Salida

- [ ] Ningún punto de la sección 4 está implementado.
- [ ] No existe funcionalidad sin un `RF` numerado asociado, ni ningún `RF` sin verificación.
- [ ] Las ocho reglas de la sección 6 se pueden comprobar una por una sobre el sistema.
- [ ] Los cuatro pendientes de la sección 5.1 están resueltos y documentados.
