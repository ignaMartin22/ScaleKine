# Especificación — Sistema de Turnos para Kinesiología

**Documento de alcance funcional.** Describe *qué* debe hacer el sistema y *por qué*.
No contiene decisiones de implementación: esas van en `plan.md`.

Cada requisito está expresado en notación EARS y numerado como `RF-nn` (funcionales) o `RNF-nn`
(seguridad y operación, sección 3.9). La sección 7 traduce cada uno a un criterio de finalización
verificable.

> **Revisión 2026-10-07.** Reescrita a partir del relevamiento con el consultorio: turnos de 45
> minutos, tres kinesiólogos en dos bloques, kinesiólogo de solo lectura, reprogramación,
> corrección de estados, marcado manual de inasistencias, datos de obra social y coseguro, y
> eliminación del recordatorio por email. Se agregó el rol administrador para la gestión de
> cuentas y contraseñas, con control total, y el ticket con QR para cada turno. Se agregaron los
> requisitos de seguridad y operación (§3.9) y el vencimiento de sesión a las 12 horas.

---

## 1. Problema y objetivo

La coordinación entre la secretaría y los kinesiólogos se hace hoy de forma manual: la secretaría
no tiene una forma fiable de avisar que el paciente llegó, y el kinesiólogo no tiene visibilidad
de quién lo espera sin que alguien interrumpa la sesión en curso.

El sistema debe:

- **Dar visibilidad al kinesiólogo** de sus próximos pacientes y de quién está esperando, en
  tiempo real y sin interrupciones.
- **Dar a la secretaría una herramienta única** para asignar, mover y cerrar los turnos del día.
- **Dejar registro** de cada turno y de cada cambio, con autor y momento.

---

## 2. Actores, definiciones y convenciones

| Actor | Acceso | Responsabilidad |
|---|---|---|
| Administrador | Login propio | Control total: todo lo que hace la secretaría, más crear, restablecer y desactivar cuentas, y dar de alta kinesiólogos y definir su bloque |
| Secretaría | Login propio | Carga de pacientes; asignación, reprogramación y cambio de estado de turnos |
| Kinesiólogo | Login propio, **solo lectura** | Monitorea únicamente su propia agenda: próximos pacientes y en espera, con los datos de cada paciente |
| Paciente | Sin acceso | — |

**Convención:** toda acción que esta spec atribuye a la secretaría también la puede ejecutar el
administrador (D-18). Las acciones sobre cuentas y kinesiólogos son exclusivas del administrador.

**Definiciones:**

- **Franja:** bloque de **45 minutos** de la grilla fija del consultorio. Un turno ocupa
  exactamente una franja.
- **Bloque:** mañana o tarde. Cada bloque tiene su grilla de franjas:

  | Bloque | Inicio de cada franja | Fin del bloque |
  |---|---|---|
  | Mañana | 08:00 · 08:45 · 09:30 · 10:15 · 11:00 · 11:45 | 12:30 |
  | Tarde | 16:00 · 16:45 · 17:30 · 18:15 | 19:00 |

  La última franja de la mañana (11:45) termina a las 12:30, después del horario nominal de 12:00.
  Es intencional (D-1).
- **Kinesiólogo de un bloque:** cada kinesiólogo atiende en un único bloque. Hoy hay dos
  kinesiólogos a la mañana y uno a la tarde, así que en la mañana dos turnos pueden compartir
  franja, con pacientes distintos y kinesiólogos distintos.
- **Turno activo:** turno en estado `reservado` o `en_espera`. Solo los turnos activos ocupan su
  franja.
- **Turno cerrado:** turno en estado `asistio`, `no_asistio` o `anulado`. No ocupa franja.
- **Turno pendiente de marcar:** turno activo cuya franja ya terminó. Es la señal de que la
  secretaría tiene que cerrarlo.
- **Días de atención:** lunes a viernes, para todos los kinesiólogos. Sábados y domingos no tienen
  franjas.
- **Zona horaria:** única, configurable al instalar. Todas las fechas, franjas y horas del sistema
  se interpretan en esa zona.

---

## 3. Requisitos funcionales (EARS)

### 3.1 Acceso y cuentas

- **RF-01** — *Evento:* Cuando un usuario se autentica con credenciales válidas, entonces el
  sistema lo redirige a la pantalla de su rol.
  *Por qué:* Cada rol tiene un alcance distinto sobre la agenda.

- **RF-02** — *Evento:* Cuando un usuario intenta autenticarse con credenciales inválidas, entonces
  el sistema rechaza el acceso e informa que las credenciales no son válidas, sin revelar cuál
  parte fue incorrecta.
  *Por qué:* Evitar que un tercero enumere los usuarios del consultorio.

- **RF-03** — *Comportamiento no deseado:* Si un usuario intenta una acción que su rol no permite
  —en particular, si un kinesiólogo intenta cualquier modificación, o si la secretaría intenta
  gestionar cuentas o kinesiólogos—, entonces el sistema la rechaza e informa que no está
  autorizado, sin alterar ningún dato.
  *Por qué:* La separación de roles es una regla de negocio, no una comodidad de interfaz.

- **RF-04** — *Evento:* Cuando el administrador crea una cuenta de secretaría o de kinesiólogo con
  una contraseña temporal, entonces el sistema la registra activa y marcada para cambio de
  contraseña.
  *Por qué:* Cada persona con su propia cuenta es lo que hace auditable quién hizo cada cambio, y
  la contraseña que eligió el administrador no debe seguir en uso. La cuenta de un kinesiólogo se
  crea con su alta (RF-14).

- **RF-05** — *Evento:* Al instalarse el sistema, entonces existe una cuenta de administrador
  activa, marcada para cambio de contraseña.
  *Por qué:* Sin una cuenta inicial nadie podría crear las demás. La crea quien instala, con una
  contraseña temporal que el administrador reemplaza en su primer ingreso.

- **RF-06** — *Evento:* Cuando un usuario ingresa con una cuenta marcada para cambio de contraseña,
  entonces el sistema le exige elegir una nueva antes de mostrarle cualquier otra pantalla.
  *Por qué:* La contraseña temporal la conoce el administrador; solo la que elige cada persona
  garantiza que las acciones registradas a su nombre fueron suyas.

- **RF-07** — *Evento:* Cuando un usuario autenticado cambia su contraseña indicando la actual,
  entonces el sistema la reemplaza y cierra las demás sesiones abiertas de la cuenta; la sesión
  desde la que hizo el cambio sigue abierta. La nueva contraseña no puede ser igual a la actual.
  *Por qué:* Si alguien conoció la contraseña de otro, el dueño tiene que poder cambiarla sin
  depender del administrador, y quien la usó no debe conservar una sesión abierta. En el primer
  ingreso (RF-06), esto cierra también las sesiones abiertas con la contraseña temporal.

- **RF-08** — *Evento:* Cuando el administrador restablece la contraseña de una cuenta, entonces el
  sistema le asigna una contraseña temporal, cierra sus sesiones abiertas y la marca para cambio de
  contraseña.
  *Por qué:* Es la forma de recuperar el acceso de quien olvidó su contraseña, sin email ni
  recuperación automática.

- **RF-09** — *Evento:* Cuando el administrador desactiva una cuenta, entonces el sistema impide
  nuevos ingresos con ella y cierra sus sesiones abiertas, conservando todo lo registrado a su
  nombre.
  *Por qué:* Una persona que deja el consultorio no debe seguir accediendo, pero lo que hizo tiene
  que seguir siendo auditable. Por eso las cuentas se desactivan y no se eliminan.

- **RF-10** — *Evento:* Cuando un usuario cierra sesión, entonces el sistema invalida su sesión y la
  pantalla deja de mostrar los datos de la agenda.
  *Por qué:* La agenda contiene datos personales de pacientes y no debe quedar expuesta en un
  equipo compartido.

- **RF-11** — *Restricción:* Una sesión no expira por inactividad, pero vence a las **12 horas**
  de iniciada. Al vencer, la pantalla deja de mostrar datos y pide volver a ingresar.
  *Por qué:* El kinesiólogo deja la pantalla abierta como monitor durante todo su bloque, así que
  cerrarla por inactividad lo saca del sistema justo cuando la necesita. Pero una sesión eterna en
  una PC compartida expone datos de salud indefinidamente; 12 horas cubren la jornada completa
  (08:00 a 19:00) y obligan a ingresar de nuevo cada día (D-14).

- **RF-12** — *Restricción:* El sistema interpreta todas las fechas, franjas y horas en una única
  zona horaria, configurada al instalarse.
  *Por qué:* Un consultorio opera en un solo huso.

### 3.2 Consultorio, kinesiólogos y grilla

- **RF-13** — *Evento:* Cuando la secretaría modifica el nombre, la dirección o el teléfono del
  consultorio, entonces el sistema guarda los nuevos datos y los usa en todos los tickets que se
  generen a partir de ese momento.
  *Por qué:* Son los datos que el paciente usa para llegar o llamar (RF-28), y la secretaría es
  quien se entera cuando cambian. Se cargan por primera vez al instalar el sistema.

- **RF-14** — *Evento:* Cuando el administrador registra un kinesiólogo con nombre, bloque, usuario
  y contraseña temporal, entonces el sistema crea en un mismo paso su perfil, su agenda y su
  cuenta de solo lectura.
  *Por qué:* Un kinesiólogo sin cuenta no puede monitorear su agenda, y una cuenta de kinesiólogo
  sin perfil no tiene agenda que mostrar. Separarlos solo permite dejar uno de los dos a medias.

- **RF-15** — *Restricción:* Las únicas franjas agendables de un kinesiólogo son las de la grilla
  de su bloque, de lunes a viernes (sección 2).
  *Por qué:* La grilla es el horario real del consultorio; ofrecer otra franja sería ofrecer un
  turno que nadie atiende.

- **RF-16** — *Evento:* Cuando el administrador cambia el bloque de un kinesiólogo, entonces el cambio
  rige para la disponibilidad de fechas futuras y no altera los turnos ya asignados.
  *Por qué:* Mover a un kinesiólogo de bloque no debe desarmar la agenda ya asignada; los turnos
  afectados se reprograman a mano (RF-36).

### 3.3 Pacientes

- **RF-17** — *Evento:* Cuando la secretaría registra un paciente nuevo con DNI, nombre y apellido,
  teléfono y obra social, entonces el sistema lo guarda y lo deja disponible para asignarle turnos.
  *Por qué:* Son los datos fijos del paciente. Se cargan una sola vez, la primera vez que se
  acerca al consultorio. Un paciente sin obra social se registra como "Particular".

- **RF-18** — *Comportamiento no deseado:* Si el DNI no tiene un formato válido, o ya está
  registrado en otro paciente, o falta alguno de los datos de RF-17, entonces el sistema impide el
  alta o la edición e informa el motivo.
  *Por qué:* El DNI es la clave con la que se recupera al paciente en cada turno siguiente (RF-19);
  un DNI duplicado o mal tipeado rompe esa recuperación.

- **RF-19** — *Evento:* Cuando la secretaría ingresa un DNI al asignar un turno, entonces el sistema
  recupera los datos del paciente si ya existe; si no existe, ofrece registrarlo en el mismo paso.
  *Por qué:* A partir del segundo turno, el DNI tiene que alcanzar para asignar.

- **RF-20** — *Evento:* Cuando la secretaría edita los datos de un paciente, entonces el sistema
  guarda los cambios y revalida el DNI.
  *Por qué:* El teléfono o la obra social cambian, y un alta equivocada tiene que poder corregirse
  sin perder la garantía de unicidad.

- **RF-21** — *Evento:* Cuando la secretaría busca un paciente por DNI o por nombre en la sección
  **Pacientes**, entonces el sistema muestra las coincidencias, y al elegir una abre la ficha del
  paciente: sus datos (editables, RF-20), sus próximos turnos y su historial (RF-47).
  *Por qué:* Es el lugar único para responder "¿quién es este paciente y qué turnos tiene?". La
  búsqueda por nombre además evita registrar dos veces a quien no trae el DNI.

### 3.4 Asignación de turnos

- **RF-22** — *Evento:* Cuando la secretaría elige una fecha y un bloque (mañana o tarde) para
  asignar un turno, entonces el sistema muestra los kinesiólogos de ese bloque y, para cada uno,
  las franjas que no tienen turno activo de ese kinesiólogo ni del paciente elegido.
  *Por qué:* El turno se asigna a un kinesiólogo concreto, y a la mañana hay más de uno. Ver de un
  vistazo quién tiene lugar evita ofrecer una franja que la asignación vaya a rechazar.

- **RF-23** — *Evento:* Cuando la secretaría asigna un turno con paciente, kinesiólogo, fecha y
  franja válidos —la franja dentro del bloque de ese kinesiólogo—, y la franja está libre para el kinesiólogo y para el paciente, entonces el sistema
  registra el turno en estado `reservado` junto con el coseguro según obra social y el coseguro
  adicional.
  *Por qué:* La reserva es el punto de partida del ciclo de vida. Los coseguros son del turno, no
  del paciente, porque cambian de una vez a otra (D-5). Se admiten fechas ya vencidas para permitir
  carga retroactiva (D-13).

- **RF-24** — *Comportamiento no deseado:* Si la franja ya tiene un turno activo de ese
  kinesiólogo, entonces el sistema impide asignar el turno e informa que la franja está ocupada.
  *Por qué:* Un kinesiólogo no atiende a dos pacientes en la misma franja. Otro kinesiólogo sí
  puede tener un turno en esa misma franja.

- **RF-25** — *Comportamiento no deseado:* Si el paciente ya tiene un turno activo en esa misma
  franja, con cualquier kinesiólogo, entonces el sistema impide asignar el turno e informa del
  conflicto.
  *Por qué:* Con dos kinesiólogos a la mañana, es posible asignarle por error al mismo paciente
  dos turnos simultáneos.

- **RF-26** — *Comportamiento no deseado:* Si el turno se asigna sin paciente, kinesiólogo, fecha o
  franja válidos, entonces el sistema impide la asignación e informa qué dato falta.
  *Por qué:* Un turno incompleto no es agendable.

- **RF-27** — *Evento:* Cuando la secretaría modifica los coseguros de un turno, entonces el sistema
  guarda los nuevos montos sin alterar su estado ni su franja.
  *Por qué:* El monto puede no conocerse al asignar o cambiar antes de la sesión. Los coseguros son
  informativos: el sistema no registra si se cobraron (sección 4).

- **RF-28** — *Evento:* Cuando se asigna un turno, entonces el sistema genera un ticket descargable
  en PDF con un código QR que contiene la información del turno —número de turno, paciente,
  kinesiólogo, fecha y hora— y la misma información en texto legible, junto con el nombre, la
  dirección y el teléfono del consultorio. El ticket se puede volver a descargar desde el turno en
  cualquier momento, y siempre refleja sus datos vigentes.
  *Por qué:* El paciente se lleva un comprobante de su turno, impreso o enviado por la secretaría,
  con los datos para llegar o llamar al consultorio. Tras una reprogramación (RF-36), el ticket
  descargado de nuevo muestra la nueva fecha y hora. No incluye DNI ni coseguros.

### 3.5 Ciclo de vida del turno

El sistema reconoce exactamente cinco estados: `reservado`, `en_espera`, `asistio`, `no_asistio`
y `anulado`. Todas las acciones sobre un turno las ejecuta la secretaría.

**Flujo normal.** Estas son las acciones que la pantalla ofrece en el día a día:

| Desde | Hacia | Acción | Significado |
|---|---|---|---|
| `reservado` | `en_espera` | Llegó | El paciente está en la sala de espera |
| `en_espera` | `asistio` | Asistió | La sesión terminó |
| `reservado` | `no_asistio` | No asistió | El paciente no vino |
| `reservado` | `anulado` | Anular | El turno no se va a dar |

**Corrección.** Fuera del flujo normal, la secretaría puede llevar un turno de cualquier estado a
cualquier otro (RF-35), como acción explícita y registrada.

- **RF-29** — *Restricción:* El sistema reconoce únicamente los cinco estados de esta sección.
  *Por qué:* Un conjunto cerrado de estados es lo que permite que la agenda y el historial se lean
  sin ambigüedad.

- **RF-30** — *Evento:* Cuando la secretaría marca un turno `reservado` como `en_espera`, entonces
  el sistema cambia su estado y registra la hora de llegada.
  *Por qué:* Es la señal de que el paciente llegó, que es el hecho que el kinesiólogo necesita
  ver. La hora de llegada ordena la espera (RF-40).

- **RF-31** — *Evento:* Cuando la secretaría marca un turno `en_espera` como `asistio`, entonces el
  sistema cambia su estado y lo retira de la espera.
  *Por qué:* El kinesiólogo no puede modificar nada, así que la secretaría cierra el turno cuando
  la sesión termina. "En espera" y "asistió" son estados distintos porque el kinesiólogo necesita
  ver quién sigue esperando, no quién ya pasó.

- **RF-32** — *Evento:* Cuando la secretaría marca un turno `reservado` como `no_asistio`, entonces
  el sistema cambia su estado y libera la franja. El sistema nunca marca una inasistencia por su
  cuenta.
  *Por qué:* Solo la secretaría sabe si el paciente avisó, llegó tarde o no vino.

- **RF-33** — *Evento:* Cuando la secretaría anula un turno `reservado`, entonces el sistema cambia
  su estado a `anulado` y libera la franja.
  *Por qué:* El paciente avisa que no viene o el turno se cargó por error. Anular deja la franja
  reutilizable.

- **RF-34** — *Restricción:* Mientras un turno esté en un estado del flujo normal, entonces la
  pantalla de la secretaría muestra únicamente las acciones de la tabla que salen de ese estado,
  más la opción de corrección. La pantalla del kinesiólogo no muestra ninguna acción.
  *Por qué:* El flujo normal tiene que ser evidente; la corrección existe para errores y no debe
  confundirse con él.

- **RF-35** — *Evento:* Cuando la secretaría corrige el estado de un turno hacia cualquier otro de
  los cinco estados, entonces el sistema aplica el cambio y lo registra como corrección.
  *Por qué:* Un "no asistió" marcado por error, o un paciente que llegó tarde después de marcado,
  tiene que poder corregirse sin anular y reasignar.

- **RF-36** — *Evento:* Cuando la secretaría reprograma un turno `reservado` a otra fecha, franja o
  kinesiólogo, entonces el sistema mueve el mismo turno, que conserva su estado `reservado`, su
  paciente y sus coseguros. No se guarda la fecha y franja anteriores.
  *Por qué:* Reprogramar es mover el turno, no crear uno nuevo. El consultorio no necesita saber
  dónde estaba antes (D-9).

- **RF-37** — *Comportamiento no deseado:* Si un turno pasa a un estado activo —por corrección o
  por reprogramación— sobre una franja que ya tiene un turno activo del mismo kinesiólogo o del
  mismo paciente, o se reprograma un turno que no está `reservado`, entonces el sistema rechaza la
  acción sin modificar el turno e informa el motivo.
  *Por qué:* Las reglas de RF-24 y RF-25 valen para cualquier forma de ocupar una franja, no solo
  para la asignación.

- **RF-38** — *Restricción:* Un turno ocupa su franja mientras está activo y la libera en cuanto
  pasa a un estado cerrado.
  *Por qué:* La franja de un turno anulado o al que el paciente no vino debe poder ofrecerse a otro.

- **RF-39** — *Restricción:* El sistema no permite eliminar un turno, en ningún estado.
  *Por qué:* Borrar destruiría evidencia. Un turno cargado por error se anula.

### 3.6 Agenda

- **RF-40** — *Restricción:* Mientras un usuario esté autenticado como kinesiólogo, entonces el
  sistema le muestra únicamente sus propios turnos de la fecha elegida —por defecto, hoy—
  separados en **en espera**, ordenados por hora de llegada, y **próximos** (`reservado`), ordenados
  por franja. De cada turno ve nombre y apellido del paciente, franja, estado y, si está en espera,
  la hora de llegada, además de todos los datos del paciente y los coseguros del turno. No puede
  ver turnos de otros kinesiólogos, ni consultar pacientes por fuera de sus propios turnos.
  *Por qué:* Es el monitor de agenda del kinesiólogo: a quién atiende ahora y a quién después.
  Dentro de sus turnos ve la misma información del paciente que la secretaría (D-15); fuera de su
  agenda no tiene nada que ver (D-16).

- **RF-41** — *Evento:* Cuando la secretaría solicita la agenda, entonces el sistema le muestra los
  turnos de todos los kinesiólogos, filtrables por fecha y por kinesiólogo, con paciente (nombre y
  apellido, DNI, teléfono, obra social), kinesiólogo, fecha, franja, estado, hora de llegada si
  corresponde, y coseguros.
  *Por qué:* La secretaría coordina el día completo y es quien llama o cobra.

- **RF-42** — *Evento:* Cuando la secretaría abre la agenda y existen turnos pendientes de marcar,
  de cualquier fecha, entonces el sistema muestra un aviso con su cantidad y permite ir a cada uno.
  *Por qué:* La inasistencia y el cierre son manuales (RF-31, RF-32). Sin un aviso, un turno sin
  marcar queda activo para siempre sin que nadie lo note.

### 3.7 Visibilidad en tiempo real

- **RF-43** — *Evento:* Cuando un turno cambia a `en_espera`, entonces la agenda del kinesiólogo
  correspondiente lo refleja sin que recargue la página.
  *Por qué:* Es el objetivo central del producto.

- **RF-44** — *Evento:* Cuando un turno se asigna, cambia de estado, se corrige o se reprograma,
  entonces todas las agendas abiertas que lo muestran reflejan el cambio sin recarga manual.
  *Por qué:* El kinesiólogo deja la agenda abierta todo el bloque; una vista desactualizada le
  hace llamar a un paciente que ya no está o perderse uno que llegó.

- **RF-45** — *Restricción:* Mientras la conexión con el sistema esté interrumpida, entonces el
  sistema advierte que la agenda puede estar desactualizada; una vez restablecida, sincroniza la
  pantalla con el estado actual de los turnos.
  *Por qué:* Un kinesiólogo que ve una agenda congelada puede tomar decisiones sobre datos viejos.

### 3.8 Auditoría e historial

- **RF-46** — *Evento:* Cuando un turno se asigna, cambia de estado, se corrige o se reprograma,
  entonces el sistema registra qué tipo de cambio fue, quién lo hizo y cuándo; en los cambios de
  estado registra además el estado anterior y el nuevo.
  *Por qué:* Ante un reclamo, el consultorio tiene que poder reconstruir quién hizo qué. En la
  reprogramación no se guarda la ubicación anterior (D-9), pero sí el hecho.

- **RF-47** — *Evento:* Cuando la secretaría abre la ficha de un paciente, entonces el sistema
  muestra todos sus turnos, con fecha, franja, kinesiólogo, estado y coseguros, en dos listas:
  **próximos** (franja todavía no transcurrida), del más cercano al más lejano, e **historial**
  (franja ya transcurrida), del más reciente al más antiguo. El kinesiólogo no puede consultarla.
  *Por qué:* La ficha responde tanto "¿cuándo le toca?" como "¿qué turnos tuvo?". Incluye turnos
  con otros kinesiólogos, y cada kinesiólogo solo ve su propia agenda (D-16).

### 3.9 Requisitos no funcionales de seguridad y operación

El sistema maneja datos de salud, que la Ley 25.326 considera **datos sensibles** (art. 2) y que
exigen medidas de seguridad y confidencialidad (arts. 9 y 10). Estos requisitos fijan el resultado
exigido; el cómo está en `plan.md` y `despliegue.md`.

- **RNF-01** — *Restricción:* El sistema solo se sirve por HTTPS, con TLS 1.2 o superior; una
  petición por HTTP se redirige, y el navegador recibe la instrucción de no volver a usar HTTP. La
  cookie de sesión solo viaja por HTTPS, no es legible desde JavaScript y no se envía desde otros
  sitios.
  *Por qué:* Datos de salud en texto plano por la red de la clínica o de un proveedor de internet
  son una filtración.

- **RNF-02** — *Comportamiento no deseado:* Si una cuenta acumula 5 intentos fallidos seguidos
  —ingresos fallidos, intentos fallidos de la contraseña actual al cambiarla (RF-07) y códigos
  fallidos del segundo factor (RNF-04)—, entonces se bloquea 15 minutos, y cada bloqueo siguiente
  dura el doble; si una misma dirección acumula 20 de esos intentos fallidos en 15 minutos, entonces
  se bloquea esa dirección 15 minutos. Mientras la cuenta está bloqueada, el rechazo es el mismo que
  el de una contraseña incorrecta (en el ingreso, credenciales inválidas; en el cambio de
  contraseña, el 403 `contrasena_actual_incorrecta`; en la verificación del segundo factor, el 403
  `segundo_factor_invalido`), y el mensaje sigue sin revelar si la cuenta existe (RF-02). Los
  códigos fallidos del segundo factor reciben el mismo rechazo sea el código inválido, ya usado o
  con la cuenta bloqueada. Para el administrador con el segundo factor activo, el ingreso cuenta
  como correcto para el límite por cuenta recién cuando verifica el código: acertar solo la
  contraseña no reinicia los fallos seguidos. Con la dirección bloqueada, la respuesta es 429 sin
  verificar la contraseña; solo cuentan los intentos fallidos, y un intento correcto no consume cupo
  de la dirección. Un restablecimiento de contraseña (RF-08) levanta el bloqueo de la cuenta.
  *Por qué:* Sin límite, una contraseña se puede adivinar por fuerza bruta. El cambio de contraseña
  también exige la actual: sin el mismo límite, quien robe una sesión abierta podría probar
  contraseñas sin límite desde ahí. Con el segundo factor, una contraseña robada no debe permitir
  probar códigos sin límite.

- **RNF-03** — *Restricción:* Las contraseñas tienen al menos 12 caracteres, no pueden figurar en
  una lista de contraseñas comunes, y nunca se almacenan ni se registran en texto legible.
  *Por qué:* La longitud es la defensa más efectiva contra el adivinado; las contraseñas comunes son
  lo primero que se prueba.

- **RNF-04** — *Evento:* Cuando el administrador ingresa, entonces el sistema le exige, además de la
  contraseña, un código de un solo uso de una aplicación autenticadora (TOTP). En su primer ingreso,
  después de elegir la contraseña (RF-06), debe activarlo, y recibe códigos de recuperación de un
  solo uso. Si pierde la aplicación y los códigos, el segundo factor solo se restablece desde el
  servidor.
  *Por qué:* El administrador tiene control total (D-18); una contraseña robada no debe alcanzar
  para tomar el sistema.

- **RNF-05** — *Restricción:* La base de datos, sus copias de seguridad y cualquier registro que
  contenga datos personales se almacenan únicamente en Argentina o en países que la autoridad de
  aplicación reconoce con nivel de protección adecuado (Disposición 60-E/2016). Ningún servicio de
  terceros que procese datos personales opera fuera de esos países.
  *Por qué:* El art. 12 de la Ley 25.326 restringe la transferencia internacional de datos
  personales (D-28).

- **RNF-06** — *Restricción:* La base de datos y sus copias de seguridad están cifradas en reposo.
  *Por qué:* Un disco o un archivo de copia extraviado no debe exponer datos legibles.

- **RNF-07** — *Restricción:* La base se puede restaurar a cualquier momento de los últimos 7 días.
  Además existe una copia diaria cifrada en un proveedor distinto del principal, con 30 días de
  retención. Ante la pérdida total del proveedor principal se pierden, como máximo, las últimas 24
  horas, y el servicio se restablece en 4 horas o menos. La restauración se prueba una vez por mes.
  *Por qué:* Perder la agenda de un consultorio es el incidente más probable y el más costoso, y un
  backup que nunca se restauró no es una garantía.

- **RNF-08** — *Restricción:* Los registros técnicos del sistema (logs, errores, monitoreo) no
  contienen DNI, nombres, teléfonos, obra social ni coseguros. La única traza de quién hizo qué es
  la auditoría (RF-46), que vive en la base.
  *Por qué:* Los logs se copian, se envían a terceros y se conservan con menos cuidado que la base.

- **RNF-09** — *Restricción:* La base no acepta conexiones desde internet; la aplicación la usa con
  un usuario que no puede modificar su estructura; el servidor solo expone HTTPS al público.
  *Por qué:* Cada puerto abierto y cada permiso de más es una vía de ataque.

- **RNF-10** — *Restricción:* Toda entrada a la API se valida antes de procesarse; los errores no
  muestran detalles internos; la aplicación no puede incrustarse en otros sitios ni ejecutar scripts
  de orígenes no declarados.
  *Por qué:* Son las defensas básicas contra inyección, robo de sesión y suplantación de la
  interfaz.

- **RNF-11** — *Restricción:* No se despliega una versión cuyas dependencias tengan vulnerabilidades
  conocidas de severidad alta o crítica.
  *Por qué:* La mayoría de los ataques a aplicaciones chicas explotan dependencias desactualizadas.

- **RNF-12** — *Evento:* Cuando el sistema deja de responder, o cuando falla una copia de seguridad
  o su prueba de restauración, entonces el administrador recibe una alerta.
  *Por qué:* Una caída o un backup roto que nadie nota se descubren el día que se necesitan.

- **RNF-13** — *Restricción:* El servidor aplica automáticamente las actualizaciones de seguridad
  del sistema operativo, y solo admite acceso administrativo con clave criptográfica, nunca con
  contraseña.
  *Por qué:* Un servidor sin parches o con acceso por contraseña es el blanco más fácil.

---

## 4. Fuera de alcance

**Esta lista es la fuente de verdad del alcance.** La constitución la referencia y no la duplica.
No se implementa nada de lo que sigue sin una decisión nueva, conforme al no negociable de la
constitución.

- **Borrado de turnos.** Un turno mal cargado se anula (RF-39).
- **Acciones del kinesiólogo.** Su rol es de solo lectura.
- **Recordatorios o avisos al paciente** por cualquier canal: email, SMS, WhatsApp o push. El
  contacto es telefónico y lo maneja la secretaría.
- **Cobro, facturación y liquidación a obras sociales.** Los coseguros se registran a título
  informativo; el sistema no sabe si se cobraron.
- **Catálogo de obras sociales o validación de cobertura.** La obra social es un dato de texto.
- **Historia clínica, evolución del paciente o notas de la sesión.**
- **Historial de ubicaciones de un turno reprogramado.**
- **Lectura del QR por el sistema** (por ejemplo, escanear el ticket para marcar la llegada). El QR
  es un comprobante para el paciente.
- **Envío del ticket al paciente** por el sistema. La secretaría lo descarga y lo entrega.
- **Sobreturnos, duraciones variables o franjas fuera de la grilla.**
- **Licencias, feriados o vacaciones**, y atención en fin de semana.
- **Reportes, métricas, estadísticas o exportación de datos.**
- **Self-service del paciente** (pedir, reprogramar o cancelar turno).
- **Trabajo simultáneo de varias secretarias** más allá de lo que garantiza RF-37 (D-12).
- **Multi-tenant.** Un despliegue es un consultorio.
- **App móvil nativa.** El alcance es web.
- **Auditoría de navegación** (quién consultó qué).
- **Recuperación de contraseña por email** o autogestionada. La resuelve el administrador (RF-08).
- **Eliminación de cuentas.** Las cuentas se desactivan (RF-09).
- **Segundo factor para secretaría y kinesiólogo.** Solo el administrador lo usa (RNF-04).
- **Alta disponibilidad** (servidores o nodos de base redundantes). Hay un solo servidor y un solo
  nodo de base; la continuidad se garantiza con las copias de RNF-07.

---

## 5. Decisiones de alcance y su motivo

| # | Decisión | Motivo |
|---|---|---|
| D-1 | Turnos de 45 minutos sobre una grilla fija: seis franjas a la mañana (la última, 11:45–12:30) y cuatro a la tarde. | Es la forma en que el consultorio trabaja. La franja de las 11:45 se habilitó a pedido aunque exceda las 12:00. |
| D-2 | Cada kinesiólogo atiende en un único bloque; varios kinesiólogos pueden compartir franja. | Hoy hay dos a la mañana y uno a la tarde. |
| D-3 | El kinesiólogo es de solo lectura. | Todas las acciones las registra la secretaría, que es quien está en contacto con el paciente. |
| D-4 | Los datos fijos del paciente se cargan una vez; los turnos siguientes se asignan con el DNI. | Evita recargar datos y duplicar pacientes. |
| D-5 | Coseguro según obra social y coseguro adicional son datos del turno, informativos. | Cambian de un turno a otro. Registrar cobros sería facturación. |
| D-6 | El contacto del paciente es solo telefónico y no hay recordatorio automático. | Sin email no hay canal automatizable dentro del alcance. |
| D-7 | `en_espera` y `asistio` son estados distintos; la secretaría cierra el turno al terminar la sesión. | El kinesiólogo necesita distinguir quién espera de quién ya pasó, y no puede cerrar turnos él mismo. |
| D-8 | La inasistencia la marca la secretaría a mano, con un aviso de turnos pendientes de marcar. | Solo la secretaría sabe si el paciente avisó o llegó tarde. El aviso evita turnos activos olvidados. |
| D-9 | Reprogramar mueve el mismo turno y no guarda dónde estaba; sí queda registrado quién y cuándo reprogramó. | El consultorio no usa la ubicación anterior; quién lo hizo sí importa ante un reclamo. |
| D-10 | La secretaría puede corregir un turno de cualquier estado a cualquier otro, y la corrección queda registrada. | Los errores de carga tienen que poder corregirse sin anular y reasignar. |
| D-11 | Ningún turno se elimina. | Preserva la evidencia; un error se anula o se corrige. |
| D-12 | No hay manejo de concurrencia entre secretarias más allá de la unicidad de franja. | Son tres, pero nunca trabajan en simultáneo. |
| D-13 | Se admiten turnos con fecha ya vencida. | La secretaría necesita registrar turnos que no se cargaron a tiempo. |
| D-14 | Las sesiones no expiran por inactividad, pero vencen a las 12 horas de iniciadas. | El kinesiólogo usa la agenda como monitor durante todo el bloque, y una sesión eterna en una PC compartida expone datos de salud. |
| D-15 | En sus propios turnos, el kinesiólogo ve toda la información del paciente, en solo lectura. | Decisión del consultorio. |
| D-16 | Cada kinesiólogo ve solo su agenda y sus turnos asignados: ni agendas ajenas, ni búsqueda de pacientes, ni historial. | Decisión del consultorio. El historial y la búsqueda mostrarían turnos de otros kinesiólogos. |
| D-17 | `spec.md` es la fuente de verdad del alcance; la constitución lo referencia. | Dos listas divergentes permiten reintroducir sin querer lo excluido. |
| D-18 | Existe un rol administrador con control total: todo lo de la secretaría, más cuentas y kinesiólogos. La primera cuenta es la del administrador. | El dueño del sistema controla quién accede y puede operar cualquier funcionalidad. |
| D-19 | Las cuentas nacen con contraseña temporal y cambio obligatorio en el primer ingreso; el administrador restablece contraseñas olvidadas. | Nadie trabaja con una contraseña que otro conoce, y la recuperación no depende de un canal de email. |
| D-20 | Las cuentas se desactivan, nunca se eliminan. | La auditoría referencia a sus autores. |
| D-21 | Se atiende de lunes a viernes, igual para todos los kinesiólogos. | Es el horario del consultorio. |
| D-22 | Solo se reprograman turnos `reservado`. Un paciente que no vino se marca `no_asistio` y se le asigna un turno nuevo. | Reprogramar un turno cerrado borraría lo que pasó, porque no se guarda la ubicación anterior (D-9). |
| D-23 | Cada turno asignado genera un ticket PDF descargable con un QR que contiene sus datos y con nombre, dirección y teléfono del consultorio. El QR no se lee desde el sistema. | El paciente necesita un comprobante. Que el QR lleve los datos en texto, y no un enlace, evita exponer el sistema a los pacientes. |
| D-24 | La asignación parte de la fecha y el bloque, y muestra los kinesiólogos de ese bloque con sus franjas libres. | Con dos kinesiólogos a la mañana, la secretaría elige a quién asignar viendo la disponibilidad de ambos. |
| D-25 | Existe una sección **Pacientes** con búsqueda y una ficha que reúne datos, próximos turnos e historial. Solo para secretaría y administrador. | Concentra en un lugar las consultas sobre un paciente. El kinesiólogo no accede (D-16). |
| D-26 | Los datos del consultorio (nombre, dirección y teléfono) se cargan al instalar y la secretaría los puede editar. | Cambian rara vez, pero cuando cambian no debe hacer falta tocar el servidor. |
| D-27 | Se adoptan los requisitos de seguridad y operación de la sección 3.9 como parte del MVP. | El sistema maneja datos sensibles de salud (Ley 25.326, arts. 2, 9 y 10; Res. AAIP 47/2018). |
| D-28 | Los datos solo se alojan en Argentina o en países adecuados. Producción va en la Unión Europea (ver `despliegue.md`). | Evita la transferencia internacional a países no adecuados (art. 12; Disp. 60-E/2016), como Estados Unidos. |
| D-29 | Segundo factor obligatorio solo para el administrador. | Es la cuenta con control total; para los demás roles, el costo operativo diario supera el beneficio. |

### 5.1 Pendientes que requieren decisión del negocio

No quedan pendientes. Cualquier decisión nueva se agrega a la tabla anterior.

---

## 6. Reglas de negocio consolidadas

1. Solo existen cinco estados: `reservado`, `en_espera`, `asistio`, `no_asistio`, `anulado`.
2. El administrador puede todo; la secretaría gestiona pacientes y turnos; el kinesiólogo solo
   lee.
3. El flujo normal es el de la tabla de la sección 3.5; cualquier otro cambio es una corrección
   explícita y registrada.
4. Solo los turnos activos (`reservado`, `en_espera`) ocupan una franja.
5. Un kinesiólogo no puede tener dos turnos activos en la misma franja.
6. Un paciente no puede tener dos turnos activos en la misma franja.
7. Las franjas son las de la grilla de 45 minutos del bloque del kinesiólogo.
8. Toda asignación, cambio de estado, corrección y reprogramación queda registrada con autor y
   momento.
9. Ningún turno se elimina, y el sistema nunca cambia un estado por su cuenta.

---

## 7. Criterios de finalización

El MVP se considera terminado cuando **todos** los puntos siguientes son verificables.

### 7.1 Acceso

- [ ] Administrador, secretaría y kinesiólogo se autentican con credenciales propias y ven
      pantallas distintas (RF-01).
- [ ] Un login inválido se rechaza con un mensaje genérico (RF-02).
- [ ] Un kinesiólogo no puede ejecutar ninguna modificación y la secretaría no puede gestionar
      cuentas ni kinesiólogos, ni desde la interfaz ni contra la API; el administrador puede todo
      (RF-03).
- [ ] El administrador crea cuentas de secretaría y de kinesiólogo con contraseña temporal (RF-04).
- [ ] Tras la instalación existe una cuenta de administrador con contraseña temporal (RF-05).
- [ ] Una cuenta con contraseña temporal no accede a ninguna pantalla hasta elegir una nueva
      (RF-06).
- [ ] Un usuario puede cambiar su propia contraseña indicando la actual; el cambio cierra sus demás
      sesiones y rechaza repetir la actual (RF-07).
- [ ] Restablecer una contraseña cierra las sesiones de la cuenta y exige cambiarla al ingresar
      (RF-08).
- [ ] Una cuenta desactivada no puede ingresar, sus sesiones se cierran y sus registros se
      conservan (RF-09).
- [ ] Cerrar sesión deja de exponer los datos de la agenda (RF-10).
- [ ] La sesión no expira por inactividad y vence a las 12 horas de iniciada (RF-11).
- [ ] Fechas, franjas y horas se interpretan en una única zona horaria configurable (RF-12).

### 7.2 Consultorio, kinesiólogos y grilla

- [ ] La secretaría edita nombre, dirección y teléfono del consultorio, y los tickets nuevos los
      reflejan (RF-13).
- [ ] Dar de alta un kinesiólogo crea su perfil, su agenda y su cuenta en un solo paso (RF-14).
- [ ] Solo se ofrecen las franjas de la grilla de su bloque, de lunes a viernes, incluida la de
      11:45 a la mañana (RF-15).
- [ ] Cambiar el bloque de un kinesiólogo no altera sus turnos ya asignados (RF-16).

### 7.3 Pacientes

- [ ] Un paciente nuevo se registra con DNI, nombre y apellido, teléfono y obra social (RF-17).
- [ ] Un DNI inválido o repetido, o un dato faltante, impide el alta y la edición (RF-18).
- [ ] Al ingresar un DNI existente se recuperan sus datos; uno inexistente ofrece el alta (RF-19).
- [ ] Los datos de un paciente se pueden editar y el DNI se revalida (RF-20).
- [ ] La sección Pacientes busca por DNI o nombre y abre la ficha con datos, próximos turnos e
      historial (RF-21).

### 7.4 Asignación

- [ ] Al elegir fecha y bloque se ven los kinesiólogos de ese bloque con sus franjas libres, que
      excluyen las ocupadas por cada kinesiólogo y por el paciente (RF-22).
- [ ] Un turno se asigna en `reservado` con sus coseguros, y admite fecha vencida (RF-23).
- [ ] No se asigna un turno en una franja ocupada por el mismo kinesiólogo; sí con otro
      kinesiólogo (RF-24).
- [ ] No se asigna un turno a un paciente que ya tiene uno activo en esa franja (RF-25).
- [ ] Un turno con datos faltantes no se asigna, y el mensaje indica cuál falta (RF-26).
- [ ] Los coseguros de un turno se pueden modificar sin alterar estado ni franja (RF-27).
- [ ] Al asignar un turno se puede descargar su ticket PDF con QR y los datos del consultorio, y
      vuelve a descargarse con los datos vigentes tras una reprogramación (RF-28).

### 7.5 Estados

- [ ] El sistema no reconoce ningún estado fuera de los cinco definidos (RF-29).
- [ ] Llegó, Asistió, No asistió y Anular funcionan según la tabla de 3.5 (RF-30 a RF-33).
- [ ] El sistema nunca marca un estado por su cuenta (RF-32).
- [ ] La secretaría ve solo las acciones del flujo que salen del estado actual, más la corrección;
      el kinesiólogo no ve acciones (RF-34).
- [ ] Una corrección lleva un turno de cualquier estado a cualquier otro y queda registrada como
      tal (RF-35).
- [ ] Reprogramar mueve el mismo turno `reservado` a otra fecha, franja o kinesiólogo (RF-36).
- [ ] Una corrección o reprogramación hacia una franja ocupada, o la reprogramación de un turno no
      `reservado`, se rechaza sin modificar el turno (RF-37).
- [ ] La franja de un turno cerrado queda disponible (RF-38).
- [ ] No existe ninguna forma de eliminar un turno (RF-39).

### 7.6 Agenda y tiempo real

- [ ] El kinesiólogo ve solo sus turnos, separados en espera (por llegada) y próximos (por
      franja), con todos los datos del paciente y los coseguros; no puede consultar agendas ajenas,
      buscar pacientes ni ver historiales (RF-40).
- [ ] La secretaría ve todos los turnos filtrables por fecha y kinesiólogo, con todos los datos
      (RF-41).
- [ ] La agenda de la secretaría avisa de los turnos pendientes de marcar (RF-42).
- [ ] El kinesiólogo ve un turno pasar a `en_espera` sin recargar (RF-43).
- [ ] Asignaciones, cambios, correcciones y reprogramaciones se propagan a todas las agendas
      abiertas (RF-44).
- [ ] Una caída de conexión se advierte y al reconectar la agenda se sincroniza (RF-45).

### 7.7 Auditoría e historial

- [ ] Cada asignación, cambio de estado, corrección y reprogramación registra tipo, autor y
      momento, y los cambios de estado registran estado anterior y nuevo (RF-46).
- [ ] La ficha del paciente muestra sus próximos turnos (del más cercano al más lejano) y su
      historial (del más reciente al más antiguo); el kinesiólogo no puede consultarla (RF-47).

### 7.8 Seguridad y operación

- [ ] El sitio solo responde por HTTPS con TLS 1.2+, redirige HTTP, envía HSTS, y la cookie de
      sesión es `Secure`, `HttpOnly` y `SameSite=Strict` (RNF-01).
- [ ] Cinco intentos fallidos, de ingreso, de la contraseña actual al cambiarla o de código del
      segundo factor, bloquean la cuenta 15 minutos, con bloqueos crecientes, y veinte desde una
      dirección la bloquean, también si llegan en paralelo; el mensaje no revela si la cuenta existe,
      un intento correcto no consume cupo de la dirección, y para el administrador con segundo
      factor acertar solo la contraseña no reinicia el contador (RNF-02).
- [ ] Una contraseña de menos de 12 caracteres o común se rechaza (RNF-03).
- [ ] El administrador no puede ingresar sin el código TOTP; los códigos de recuperación funcionan
      una sola vez (RNF-04).
- [ ] Base, copias y registros con datos personales están en países adecuados (RNF-05).
- [ ] Base y copias están cifradas en reposo (RNF-06).
- [ ] Hay restauración a un punto de los últimos 7 días, copia diaria externa con 30 días de
      retención, y una prueba de restauración documentada del último mes (RNF-07).
- [ ] Una búsqueda en los logs de un DNI de prueba no encuentra coincidencias (RNF-08).
- [ ] La base no es alcanzable desde internet, el usuario de la aplicación no puede alterar el
      esquema, y el servidor solo expone el puerto 443 (y 80 para redirigir) (RNF-09).
- [ ] Una entrada inválida se rechaza con un error sin detalles internos, y las cabeceras de
      seguridad impiden incrustar la aplicación (RNF-10).
- [ ] La auditoría de dependencias no informa vulnerabilidades altas ni críticas (RNF-11).
- [ ] Detener la aplicación, o hacer fallar un backup, genera una alerta al administrador
      (RNF-12).
- [ ] El servidor tiene actualizaciones automáticas de seguridad y rechaza el acceso SSH por
      contraseña (RNF-13).

### 7.9 Salida

- [ ] Ningún punto de la sección 4 está implementado.
- [ ] No existe funcionalidad sin un `RF` o `RNF` numerado asociado, ni ningún requisito sin
      verificación.
- [ ] Las nueve reglas de la sección 6 se pueden comprobar una por una sobre el sistema.
- [ ] Los pendientes de la sección 5.1 están resueltos y documentados.
