# Despliegue y operación — Producción

Deriva de [`plan.md`](./plan.md) §4.16 y cumple los requisitos de seguridad y operación de
[`spec.md`](./spec.md) §3.9 (RNF-01 … RNF-14). Describe **dónde** corre el sistema, **cómo** se
protege y **cómo** se opera. Cada sección indica los RNF que satisface.

> **Marco legal.** El sistema trata datos de salud, que la Ley 25.326 considera sensibles. La
> clínica es la **responsable** de la base de datos; quien provee y opera el sistema es **encargado
> del tratamiento** (art. 25). Este documento cubre las medidas técnicas y organizativas
> recomendadas por la Res. AAIP 47/2018. No reemplaza el asesoramiento legal de la clínica.

---

## 1. Proveedor, región e inventario de servicios — RNF-05

**Producción:** DigitalOcean, región **FRA1 (Frankfurt, Alemania)**. La Unión Europea figura entre
los destinos con nivel adecuado de la Disposición 60-E/2016, así que alojar ahí no requiere
cláusulas contractuales adicionales para la transferencia internacional.

Inventario de servicios: todo servicio nuevo se agrega a esta tabla antes de usarse.

| Servicio | Uso | Ubicación | ¿Recibe datos personales? |
|---|---|---|---|
| DigitalOcean Droplet | Caddy, backend, frontend, tarea de respaldo | FRA1 (UE) | Sí, en tránsito y en memoria |
| DigitalOcean Managed PostgreSQL (perfil administrado) | Base de datos | FRA1 (UE) | Sí |
| DigitalOcean Block Storage (perfil económico) | Datos de la base en el contenedor `db` | FRA1 (UE) | Sí, cifrados en reposo por la plataforma |
| Backblaze B2, región EU Central (Ámsterdam, Países Bajos) | Copia externa diaria | UE | Sí, **cifrados antes de salir del servidor** |
| GitHub (repositorio, Actions, Container Registry privado) | Código, CI/CD, imágenes | EE. UU. | **No.** Nunca se usan datos de producción en CI ni en imágenes |
| Better Stack, plan gratuito | Chequeo de `/api/salud` y del certificado TLS | Cualquiera | **No.** Solo consulta un endpoint sin datos |
| healthchecks.io, plan gratuito | Latido de la copia diaria y, en el perfil económico, del registro de transacciones | Cualquiera | **No.** Solo recibe una petición vacía |
| Registrador del dominio y DNS | Dominio y registros DNS | Cualquiera | No |
| Gestor de contraseñas del administrador | Secretos y claves de recuperación | Cualquiera | No (solo secretos técnicos) |

**Regla:** ningún servicio que reciba datos personales puede estar fuera de Argentina o de un país
adecuado. Los servicios de la tabla marcados con **No** quedan fuera de esa restricción porque nunca
reciben datos de pacientes. No se usa Cloudflare ni otro proxy que descifre el tráfico, ni un
servicio SaaS de errores en el MVP.

**Notas de contratación:**
- La región de B2 se elige al crear la cuenta y no se puede cambiar después. Hay que elegir EU
  Central.
- Los servicios gratuitos se usan solo si sus términos permiten el uso comercial. Por eso no se usa
  el plan gratuito de UptimeRobot: está limitado a uso personal y no incluye latidos ni control del
  certificado.
- Better Stack: confirmar al contratar el intervalo de chequeo y que el plan gratuito incluya el
  control del certificado **[verificar al contratar]**.

---

## 2. Arquitectura

```
                    Internet
                        │  HTTPS (443) · HTTP (80) solo para redirigir
                        ▼
         ┌─────────── DigitalOcean Cloud Firewall ───────────┐
         │  Entrada: 80, 443 públicos · 22 solo IP admin     │
         ▼                                                   │
  ┌──────────────────── Droplet (FRA1) ─────────────────────┐ │
  │  Docker Compose                                          │ │
  │  ┌──────────────┐   /api, /socket.io   ┌──────────────┐  │ │
  │  │ web: Caddy + │ ───────────────────► │ api: Node    │  │ │
  │  │ Angular      │                      │ Express      │  │ │
  │  └──────────────┘                      └──────┬───────┘  │ │
  │  ┌──────────────┐                             │          │ │
  │  │ respaldo     │── pg_dump | age | B2 ──┐    │          │ │
  │  └──────────────┘                        │    │          │ │
  └──────────────────────────────────────────┼────┼──────────┘ │
                     red privada (VPC) + TLS │    │            │
                                             │    ▼            │
                              ┌──────────────┴─────────────┐   │
                              │ Managed PostgreSQL (FRA1)  │   │
                              │ fuentes de confianza: solo │   │
                              │ el Droplet                 │   │
                              └────────────────────────────┘   │
                                             │                 │
                                             ▼                 │
                                  Backblaze B2 EU (copia       │
                                  cifrada, 30 días)            │
```

- **Un solo origen.** Frontend, API y WebSocket se sirven desde el mismo dominio. Así la cookie
  puede ser `SameSite=Strict` y no hace falta CORS entre dominios.
- **El servidor no guarda estado.** Todo el estado vive en la base. El Droplet se puede reconstruir
  desde el repositorio y el archivo `.env`; por eso no se contratan backups del Droplet.
- El diagrama muestra el **perfil administrado**, el de por defecto. En el perfil económico (§3.1)
  la base corre en el mismo Droplet, como el contenedor `db`, con sus datos en un volumen de Block
  Storage; el resto no cambia.

---

## 3. Recursos y costos

Precios de lista a octubre de 2026, en USD por mes y sin impuestos.

| Recurso | Plan | Costo |
|---|---|---|
| Droplet Basic | 1 vCPU, 1 GB RAM, 25 GB SSD, 1 TB de transferencia | 6,00 |
| Managed PostgreSQL | 1 vCPU, 1 GB RAM, 10 GB, 1 nodo | 15,15 |
| Backblaze B2 | 30 copias cifradas; los primeros 10 GB son gratis | 0 |
| Dominio `.com.ar` | NIC Argentina | Anual, bajo |
| Better Stack y healthchecks.io | Planes gratuitos | 0 |
| **Subtotal** | | **21,15** |
| IVA sobre servicios digitales del exterior | 21 % | 4,44 |
| **Total aproximado** | | **≈ 26** |

El banco o la tarjeta pueden aplicar además percepciones sobre los pagos al exterior. Confirmarlo
con el contador de la clínica.

**Por qué alcanza 1 GB de RAM.** Las imágenes se construyen en CI, no en el servidor. Angular se
sirve como archivos estáticos y la base corre fuera del Droplet. La tarea de respaldo no queda
corriendo: se lanza una vez por día (§8.2). En el servidor solo viven Caddy, la API y Docker, con
1 GB de swap como margen (§5).

**Crecimiento:**
- **Droplet:** si la memoria supera el 80 % de forma sostenida (alerta de §11) o el swap se usa de
  manera continua, se pasa al plan de 2 GB (12 USD).
  - El cambio se hace eligiendo **solo CPU y RAM**, sin ampliar el disco. Así se puede volver al
    plan anterior.
  - Requiere apagar el Droplet unos minutos: se hace fuera del horario de atención.
- **Base:** si supera el 70 % de su memoria o de su disco de forma sostenida, se pasa al plan de
  2 GB (30,45 USD).
- Los nodos de base de respaldo (*standby*) están fuera del alcance (spec §4, "Alta
  disponibilidad").

### 3.1 Perfiles de despliegue

El sistema se despliega en uno de dos perfiles. Los dos cumplen los mismos RNF y usan las mismas
imágenes; cambian la configuración de Compose y el aprovisionamiento. **Por defecto se usa el perfil
administrado**, el de la tabla anterior. El económico se ofrece cuando la clínica pide un presupuesto
más ajustado.

| | Perfil administrado (por defecto) | Perfil económico |
|---|---|---|
| Base de datos | Managed PostgreSQL de DigitalOcean, fuera del Droplet | Contenedor `db` (PostgreSQL oficial) en el mismo Droplet |
| Droplet | 1 GB de RAM (6 USD) | 2 GB de RAM (12 USD): la base necesita memoria propia |
| Datos de la base | En el clúster administrado | Volumen de Block Storage de 10 GB (≈ 1 USD), cifrado en reposo por la plataforma (RNF-06) |
| Restaurar a un punto en el tiempo (RNF-07) | Lo provee la plataforma (7 días) | Archivo continuo del registro de transacciones, cifrado, en un bucket de B2 EU propio, con 7 días de retención |
| Copia externa diaria | `respaldo` → B2 (§8.2) | Igual |
| Costo aproximado con IVA | **≈ 26 USD/mes** | **≈ 16 USD/mes** |

**Perfil administrado. A favor:**
- Copias, recuperación a un punto en el tiempo, parches menores y cifrado en reposo los resuelve la
  plataforma.
- La base y la aplicación están en máquinas separadas: un problema de memoria o de disco en el
  Droplet no afecta a la base.
- Menos operación para quien mantiene el sistema; es la opción con menos riesgo.

**Perfil administrado. En contra:**
- La base es el 70 % del costo.
- Depende de un producto propio de DigitalOcean. Mudarse sigue siendo simple (copia diaria +
  `DATABASE_URL`), pero requiere que el proveedor nuevo ofrezca una base administrada equivalente o
  pasar al perfil económico.

**Perfil económico. A favor:**
- Cuesta alrededor de un 40 % menos.
- Es el más portable: corre igual en cualquier servidor Linux con Docker de un proveedor de la UE.
  Es también el que se usa en la recuperación ante desastre en otro proveedor (§8.4).
- Al estar la base en la misma máquina, no hay red entre la API y la base.

**Perfil económico. En contra:**
- La recuperación a un punto en el tiempo, las actualizaciones de PostgreSQL y el control del disco
  quedan a cargo del operador. Si el archivo del registro de transacciones deja de funcionar, se
  pierde RNF-07 hasta que se detecta: por eso tiene su propia alerta (§11).
- La base y la aplicación comparten memoria y disco: un problema del Droplet afecta a las dos.
- Restaurar a un punto en el tiempo es un procedimiento manual (§8.1), más lento que en el panel
  del proveedor.
- La clave que cifra el archivo del registro de transacciones vive en el servidor (la herramienta
  la necesita para restaurar). La garantía contra un servidor comprometido sigue siendo la copia
  diaria con Object Lock (§8.2), cifrada con `age`.

**Qué cambia entre perfiles:**
- `docker-compose.prod.yml`: el servicio `db` está en el perfil de Compose `base-local`. Solo el
  perfil económico lo levanta (`COMPOSE_PROFILES=base-local` en el `.env` del host).
- `DATABASE_URL`, `DATABASE_URL_MIGRACIONES` y `DATABASE_URL_RESPALDO` apuntan al clúster o a `db`.
- `infra/provision.sh` recibe el perfil y crea el clúster (§5, paso 3) o el volumen (§5, paso 3b).
- El código de la aplicación no cambia.

Cambiar de perfil después de la puesta en producción es una migración planificada: copia con
`pg_dump`, restauración en la base nueva, cambio de las URL y redespliegue, fuera del horario de
atención.

---

## 4. Red y acceso — RNF-09, RNF-13

**DigitalOcean Cloud Firewall** (se aplica fuera del servidor, así que no lo puede saltear Docker):

| Dirección | Puerto | Origen o destino |
|---|---|---|
| Entrada | 443/TCP | Cualquiera |
| Entrada | 80/TCP | Cualquiera (Caddy solo redirige a HTTPS) |
| Entrada | 22/TCP | Solo la IP del administrador, o ninguno si se usa Tailscale |
| Salida | Todo | Cualquiera (actualizaciones, Let's Encrypt, B2) |

> Docker publica puertos por encima de `ufw`. Por eso la regla que manda es la del Cloud Firewall,
> no la del sistema operativo. `ufw` se activa igual, como segunda capa.

**Base de datos, perfil administrado:**
- **Fuentes de confianza** (*trusted sources*): solo el Droplet. La base rechaza cualquier otra
  conexión, incluidas las de internet.
- Conexión por la red privada (VPC) de FRA1 y siempre con TLS (`sslmode=require`).

**Base de datos, perfil económico:**
- El contenedor `db` **no publica puertos** al host: solo lo alcanzan `api` y `respaldo` por una red
  interna de Compose propia de la base, a la que `web` no pertenece.
- El tráfico entre contenedores no sale de la máquina, así que no se usa TLS hacia la base.
- En otro proveedor sin firewall externo, las reglas van en la cadena `DOCKER-USER` de `iptables`
  (Docker se saltea `ufw`).

**SSH:**
- Solo con clave (`PasswordAuthentication no`) y sin ingreso como root (`PermitRootLogin no`).
- Usuario `deploy` con `sudo`.
- `fail2ban` activo sobre `sshd`.
- Opcional, y recomendado: Tailscale, para cerrar el puerto 22 al público por completo.

**Actualizaciones del sistema operativo:** `unattended-upgrades` con parches de seguridad
automáticos y reinicio automático, si hace falta, a las 03:00 hora argentina.

---

## 5. Aprovisionamiento del servidor

Pasos en orden. Cada paso queda documentado en un script `infra/provision.sh` (idempotente), para
que reconstruir el servidor no dependa de la memoria de nadie.

1. Crear el proyecto en DigitalOcean con **2FA activado en la cuenta** del proveedor.
2. Crear la VPC de FRA1, el Droplet (Ubuntu LTS, clave SSH, en la VPC) y el Cloud Firewall de §4.
3. **Perfil administrado:** crear el clúster PostgreSQL en FRA1, dentro de la VPC. Configurar las
   fuentes de confianza (solo el Droplet) y la ventana de mantenimiento (domingo 03:00 hora
   argentina).

   3b. **Perfil económico:** crear un volumen de Block Storage de 10 GB en FRA1, conectarlo al
   Droplet y montarlo como directorio de datos del contenedor `db`. Crear el bucket del registro de
   transacciones (§8.1) y su clave con permiso solo sobre ese bucket.
4. En el Droplet: crear el usuario `deploy`, endurecer `sshd`, instalar `unattended-upgrades`,
   `fail2ban`, `ufw` y Docker Engine con el plugin Compose.
5. Configurar la rotación de logs de Docker (`max-size: 10m`, `max-file: 5`).
6. Crear un archivo de swap de 1 GB con `vm.swappiness=10`, para que solo se use como margen.
7. Instalar el temporizador de systemd de la copia diaria (§8.2).
8. Apuntar el registro DNS `A` del dominio al Droplet.
9. Crear los usuarios de la base (§7) y el archivo `.env` (§9).
10. Primer despliegue (§10) y comando de instalación (administrador y consultorio).

---

## 6. Contenedores y proxy — RNF-01, RNF-10

### 6.1 Servicios

```yaml
# docker-compose.prod.yml (esquema)
services:
  web:        # Caddy + Angular compilado
    image: ghcr.io/<org>/scalekine-web:${VERSION}
    ports: ["80:80", "443:443"]
    volumes: [caddy_data:/data, caddy_config:/config]
    env_file: .env.web
    restart: unless-stopped
  api:        # Node + Express + Socket.io
    image: ghcr.io/<org>/scalekine-api:${VERSION}
    env_file: .env.api
    expose: ["3000"]
    read_only: true
    user: "node"
    restart: unless-stopped
  respaldo:   # copia externa diaria (§8.2); la lanza un temporizador de systemd
    image: ghcr.io/<org>/scalekine-respaldo:${VERSION}
    env_file: .env.respaldo
    profiles: ["tareas"]
  db:         # solo en el perfil económico (§3.1)
    image: postgres:<versión mayor fija>
    env_file: .env.db
    volumes: ["/mnt/scalekine-db:/var/lib/postgresql/data"]   # volumen de Block Storage
    profiles: ["base-local"]
    restart: unless-stopped
volumes: { caddy_data: {}, caddy_config: {} }
```

- `respaldo` está en el perfil `tareas`, así que `docker compose up -d` no lo levanta. Corre solo
  cuando el temporizador lo lanza y termina al subir la copia. No ocupa memoria el resto del día.
- `api` no publica puertos al host: solo `web` la alcanza por la red interna de Compose.
- Los contenedores corren sin root y, el de la API, con sistema de archivos de solo lectura.
- Cada servicio recibe solo las variables que necesita (`.env.web`, `.env.api`, `.env.respaldo` y,
  en el perfil económico, `.env.db`).
- `db` no publica puertos y solo comparte una red interna con `api` y `respaldo` (§4). Lleva el
  archivo continuo del registro de transacciones de §8.1.

### 6.2 Caddy

```caddyfile
{
	email {$ACME_EMAIL}
}

{$DOMINIO} {
	encode zstd gzip

	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "no-referrer"
		Permissions-Policy "camera=(), microphone=(), geolocation=()"
		Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' wss://{$DOMINIO}; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'"
		-Server
	}

	handle /api/* {
		reverse_proxy api:3000
	}
	handle /socket.io/* {
		reverse_proxy api:3000
	}
	handle {
		root * /srv/frontend
		try_files {path} /index.html
		file_server
	}
}
```

- **TLS:** Caddy obtiene y renueva los certificados de Let's Encrypt, usa TLS 1.2 como mínimo y
  redirige HTTP a HTTPS sin configuración extra (RNF-01).
- **Sin logs de acceso en Caddy.** No se declara la directiva `log`. Las peticiones las registra el
  backend, que redacta los datos personales y omite los parámetros de consulta (RNF-08).
- **CSP y Angular.** Los scripts quedan restringidos a `'self'`. Para que el build de producción
  respete esa política hay que desactivar la incrustación de CSS crítico
  (`optimization.styles.inlineCritical: false`), porque usa un manejador `onload` en línea. Los
  estilos de componentes que Angular inyecta en tiempo de ejecución requieren `'unsafe-inline'` en
  `style-src`. Es un riesgo aceptado: afecta estilos, no ejecución de código.
- La API agrega sus propias cabeceras con `helmet` (plan §4.15), así que las respuestas JSON quedan
  protegidas aunque se acceda sin pasar por las reglas estáticas. Entre ellas, `Cache-Control:
  no-store` en toda respuesta de `/api`, errores incluidos (RNF-14); Caddy no la modifica, y los
  archivos estáticos del frontend conservan su caché normal.

---

## 7. Base de datos — RNF-06, RNF-07, RNF-09

**Perfil administrado (por defecto):** PostgreSQL administrado en FRA1, en la versión estable más
reciente que ofrezca el proveedor.
- Cifrado en reposo (LUKS) y en tránsito (TLS), provistos por la plataforma.
- Copia completa diaria y registro continuo de transacciones, que permiten **restaurar a cualquier
  momento de los últimos 7 días**.

**Perfil económico:** imagen oficial de PostgreSQL con la versión mayor fijada en el compose, en el
contenedor `db` (§3.1).
- Cifrado en reposo: el volumen de Block Storage, cifrado por la plataforma.
- Restauración a un punto en el tiempo: archivo continuo del registro de transacciones (§8.1).
- Las versiones menores se actualizan cambiando la etiqueta de la imagen en un PR, que pasa por el
  CI como cualquier otro cambio. La versión mayor, en la revisión anual (§13).
- Usuarios, permisos y `timezone=UTC`: iguales que en el perfil administrado.

**Usuarios, con mínimo privilegio:**

| Usuario | Permisos | Lo usa |
|---|---|---|
| `scalekine_migraciones` | Dueño del esquema: crea y altera tablas | Solo el pipeline de despliegue, al migrar |
| `scalekine_app` | `SELECT`, `INSERT` y `UPDATE` sobre las tablas de la aplicación, salvo `TurnoEvento`, donde solo tiene `SELECT` e `INSERT`. `DELETE` **solo** sobre `Sesion` y la tabla de límite de intentos | El backend |
| `scalekine_respaldo` | Solo `SELECT` | La tarea de copia externa |

Sin `DELETE` sobre `Turno`, `TurnoEvento`, `Usuario` ni `Paciente`, la regla "no se borra" (RF-39 y
RF-09) queda garantizada también por la base, no solo por el código.
Sin `UPDATE` sobre `TurnoEvento`, la auditoría es de solo agregado (RF-46): ni un error del código puede
reescribir un evento.

Los permisos se otorgan en una migración y una prueba de integración los verifica. La conexión de la
aplicación fija `timezone=UTC` en la sesión, sin depender de la configuración del servidor ni de
`DATABASE_URL` (RF-12).

---

## 8. Copias de seguridad y recuperación — RNF-06, RNF-07, RNF-12

### 8.1 Nivel 1 · Recuperación del proveedor

Cubre errores humanos y fallas de la base, con restauración a cualquier momento de los últimos 7
días (RNF-07).

- **Perfil administrado:** la recuperación a un punto en el tiempo de DigitalOcean. Se restaura a un
  clúster nuevo y se actualizan las URL de la base.
- **Perfil económico:** **pgBackRest 2.58.0** (licencia MIT; confirmado en T-37) archiva de forma continua
  el registro de transacciones en un bucket de B2 EU **propio**, distinto del de las copias diarias, y sube
  una copia base semanal. Todo sale **cifrado** (`aes-256-cbc`) desde el servidor, y la retención es de 7
  días (`repo1-retention-full-type=time`, `repo1-retention-full=7`: siempre queda una copia base que cubre
  todo el período, de modo que se puede restaurar a cualquier instante de los últimos 7 días).
  - El contenedor `db` usa una imagen propia (`infra/db/Dockerfile`): la oficial `postgres:18.6-alpine` más
    `pgbackrest`, con la versión fijada. `archive_command` llama a `pgbackrest archive-push` y
    `archive_timeout=300` limita la pérdida a minutos aun con poca actividad.
  - La copia base semanal la lanza un temporizador de systemd (domingos 04:00 hora argentina). El stanza se
    crea una vez con `iniciar-archivo.sh`.
  - Para llegar al bucket, `db` pertenece también a la red `salida`; sigue sin publicar puertos.
  - La clave del bucket permite leer, escribir, listar y borrar solo en **ese** bucket (pgBackRest borra lo
    que vence por retención). No hay Object Lock en este bucket: la garantía contra un servidor comprometido
    es la copia diaria del nivel 2.
  - Restaurar es el procedimiento B de `docs/operacion/restaurar.md`, que se ensaya en la prueba mensual
    (§8.3).

### 8.2 Nivel 2 · Copia externa diaria

Cubre la pérdida de la cuenta o de la región de DigitalOcean.

**Ejecución:** un temporizador de systemd en el host ejecuta `docker compose run --rm respaldo`
todos los días a las 03:30 hora argentina
(`OnCalendar=*-*-* 03:30 America/Argentina/Buenos_Aires`, con `Persistent=true` para que corra al
encender si el servidor estaba apagado a esa hora). El contenedor ejecuta:

```sh
# script del contenedor `respaldo` (esquema)
set -eu -o pipefail   # si falla pg_dump, falla todo y no se envía el latido
pg_dump --format=custom "$DATABASE_URL_RESPALDO" \
  | age -r "$AGE_DESTINATARIO" \
  | rclone rcat "b2:$BUCKET/scalekine-$(date -u +%Y-%m-%dT%H%M).dump.age"
curl -fsS "$LATIDO_URL"
```

- **Cifrado antes de salir del servidor** con `age`. La clave pública vive en el servidor; la clave
  **privada solo la tiene el administrador**, en su gestor de contraseñas y en una copia impresa
  guardada en la clínica. Quien robe el bucket o el servidor no puede leer las copias (RNF-06).
- **Versión de `pg_dump`.** La imagen `respaldo` usa un cliente de PostgreSQL de la misma versión
  mayor que el clúster, o superior. Se actualiza junto con la versión mayor anual (§13).
- **Bucket con Object Lock de 30 días**, en modo de cumplimiento (*compliance*) y habilitado al
  crear el bucket. Ninguna clave puede borrar ni sobrescribir una copia antes de que venza, ni
  siquiera la del administrador. Esa es la garantía de que un servidor comprometido no destruye las
  copias. (En un bucket con versiones, "sobrescribir" crea una versión nueva; la original queda intacta y
  bloqueada, y es la que se restaura.)
- **Retención de 30 días**, aplicada por una regla de ciclo de vida del bucket que elimina las copias
  cuando vence su bloqueo.
- **Clave de B2 del servidor con mínimo permiso:** escribir en ese bucket y nada más.
  - `rclone` **no necesita permiso de listar** para subir: con una clave limitada a un bucket usa solo
    `writeFiles` (resuelto en T-37; se reconfirma con la clave real en T-36, y si hiciera falta se agrega
    únicamente `listFiles`).
  - Nunca recibe permiso de borrado.
  - Los buckets y las claves se crean con `infra/respaldo/crear-bucket.sh` y los comandos de
    `infra/README.md`.
- **Latido:** si la tarea falla, no se envía el aviso a healthchecks.io y el administrador recibe
  una alerta (RNF-12).
- **Temporizadores:** las unidades de systemd están en `infra/systemd/` y su instalación en `infra/README.md`.

### 8.3 Prueba de restauración mensual

El primer lunes de cada mes:

1. Descargar la copia más reciente del bucket a una máquina de trabajo.
2. Descifrarla con la clave privada y restaurarla en un PostgreSQL local temporal (Docker).
3. Ejecutar `infra/verificar-restauracion.sh`: aplica las migraciones pendientes en seco, cuenta
   pacientes, turnos y eventos, y verifica que el último evento sea de las últimas 24 horas.
4. Destruir la base temporal y borrar el archivo descargado.
5. Anotar la fecha, la copia usada y el resultado en `docs/operacion/restauraciones.md`, que solo
   registra fechas, conteos y resultado, nunca datos personales.

Si el paso 3 falla, se trata como incidente (§12).

En el perfil económico, la prueba mensual suma una restauración a un punto en el tiempo desde el
bucket del registro de transacciones, con el mismo registro en `restauraciones.md`.

### 8.4 Recuperación ante desastre (objetivo: 4 horas)

| Escenario | Procedimiento | Pérdida máxima |
|---|---|---|
| Error humano o corrupción | Restaurar la base a un punto anterior (§8.1), según el perfil | Minutos |
| Falla del Droplet | Crear un Droplet nuevo con `infra/provision.sh`, recuperar `.env` del gestor de contraseñas y redesplegar | Ninguna (el estado está en la base) |
| Pérdida de la cuenta o de la región de DigitalOcean | Levantar un servidor en otro proveedor de la UE (p. ej., Scaleway, en Francia) con el perfil económico (§3.1), restaurar la última copia de B2, redesplegar con Compose y actualizar el DNS | Hasta 24 h (minutos, en el perfil económico, si el bucket del registro de transacciones está disponible) |

El proveedor alternativo se confirma en la revisión anual (§13): hay que verificar que tenga planes
disponibles para contratar en el momento. En octubre de 2026, por ejemplo, Hetzner no ofrecía sus
planes económicos por falta de hardware.

---

## 9. Secretos

- **Fuente de verdad:** el gestor de contraseñas del administrador. Guarda los archivos `.env`, la
  `CLAVE_CIFRADO` (plan §5.2), la clave privada de `age`, las credenciales de B2 y los códigos de
  recuperación de la cuenta de DigitalOcean.
- **En el servidor:** archivos `.env.*` con permisos `600`, propiedad de `deploy`, fuera del
  repositorio.
- **En CI:** solo la clave SSH de despliegue y la contraseña de `scalekine_migraciones`, como
  secretos de GitHub Actions.
- **Rotación:**
  - Contraseñas de la base y claves de B2 una vez al año, y de inmediato si alguien con acceso deja
    de trabajar en el proyecto o ante un incidente.
  - La `CLAVE_CIFRADO` no rota en el MVP: cambiarla obliga al administrador a reactivar su segundo
    factor.

---

## 10. Integración y despliegue continuos — RNF-11

**En cada pull request** (GitHub Actions):
1. Lint y compilación de backend y frontend.
2. Pruebas de unidad e integración contra un PostgreSQL de servicio en el propio runner, con datos
   ficticios.
3. `npm audit --audit-level=high` en backend y frontend. **Falla el pipeline** si hay
   vulnerabilidades altas o críticas.
4. Dependabot abre los PR de actualización una vez por semana.

**Al etiquetar una versión** (`vX.Y.Z`):
1. Construcción de las imágenes `web`, `api` y `respaldo`, y publicación en el registro privado de
   GitHub.
2. Por SSH al Droplet:
   1. `docker compose pull`.
   2. Migraciones con `scalekine_migraciones`.
   3. `docker compose up -d`.
   4. Prueba de humo contra `/api/salud`.
3. Si la prueba de humo falla, se vuelve a la etiqueta anterior. Las migraciones se escriben
   siempre compatibles con la versión previa para que esa vuelta atrás sea posible.

---

## 11. Monitoreo, logs y alertas — RNF-08, RNF-12

| Señal | Herramienta | Alerta al administrador |
|---|---|---|
| Disponibilidad | Better Stack, cada 3 minutos o menos, sobre `/api/salud` (responde `ok`, sin datos) | 2 fallas seguidas |
| Copia diaria | Latido en healthchecks.io | Si no llega el latido en 26 horas |
| CPU, memoria y disco del Droplet y de la base | Alertas nativas de DigitalOcean | Más del 80 % sostenido 10 minutos; en la memoria del Droplet, es el criterio para ampliarlo (§3) |
| Certificado TLS | Better Stack | Menos de 14 días para vencer |
| Registro de transacciones (perfil económico) | Latido en healthchecks.io: un temporizador horario lo envía solo si el último archivo subido tiene menos de 1 hora | Si no llega el latido en 2 horas |

**Logs de la aplicación:**
- JSON de `pino`, con redacción de datos personales (plan §4.15), en la salida estándar de Docker.
- Rotación local según §5, lo que equivale a unos 30 días de historia.
- No se envían a ningún servicio externo en el MVP.

---

## 12. Respuesta a incidentes

Un incidente es cualquier sospecha de acceso no autorizado, pérdida de datos o copia fallida.

1. **Contener.** Revocar todas las sesiones con el subcomando de instalación correspondiente. Rotar
   las credenciales comprometidas. Si hace falta, apagar el servicio `api`.
2. **Evaluar.** Revisar la auditoría (`TurnoEvento`), los logs y el panel del proveedor. Determinar
   qué datos y qué período quedaron afectados.
3. **Comunicar a la clínica** dentro de las 24 horas, por escrito, con lo que se sabe. La clínica,
   como responsable, decide si informa a los pacientes y a la AAIP. Los proyectos de reforma de la
   Ley 25.326 prevén un plazo de 72 horas; se adopta ese estándar como buena práctica.
4. **Recuperar** con los procedimientos de §8.
5. **Registrar** el incidente: cronología, causa, alcance y medidas tomadas. El registro se entrega a
   la clínica.

---

## 13. Mantenimiento periódico

| Frecuencia | Tarea |
|---|---|
| Diaria (automática) | Copia externa, parches del sistema operativo, monitoreo |
| Semanal (automática) | PR de Dependabot; ventana de mantenimiento de la base |
| Mensual | Prueba de restauración (§8.3); revisión de alertas y de los PR de dependencias; revisión de cuentas activas con la clínica |
| Anual | Rotación de credenciales (§9); actualización de versión mayor de PostgreSQL (con el cliente de la imagen `respaldo`) y de Node LTS; revisión de este documento, del inventario de §1, de los precios de §3 y del proveedor alternativo de §8.4 |

---

## 14. Medidas organizativas y legales

Son de la clínica, como responsable, con el apoyo del encargado. Las técnicas no alcanzan sin
ellas (Res. AAIP 47/2018).

- [ ] **Contrato de encargado del tratamiento** (art. 25, Ley 25.326) entre la clínica y quien opera
      el sistema. Debe fijar finalidad, medidas de seguridad, confidencialidad, devolución o
      destrucción de los datos al terminar el servicio y aviso de incidentes.
- [ ] **Acuerdos de procesamiento de datos** de DigitalOcean y de Backblaze, aceptados y archivados.
- [ ] **Inscripción de la base** en el Registro Nacional de Bases de Datos de la AAIP. La realiza la
      clínica; confirmar con su asesor legal.
- [ ] **Aviso de privacidad** para pacientes (art. 6): quién trata los datos, para qué, dónde se
      alojan y cómo ejercer sus derechos. Se entrega o exhibe en la recepción.
- [ ] **Acuerdos de confidencialidad** firmados por el personal con cuenta en el sistema.
- [ ] **Altas y bajas de personal:** la cuenta de quien deja la clínica se desactiva el mismo día
      (RF-09).
- [ ] **Puestos de trabajo:** bloqueo automático de pantalla en las PCs de recepción, y el monitor
      del kinesiólogo ubicado fuera de la vista de otros pacientes.
- [ ] **Pedidos de los pacientes** sobre sus datos (acceso, rectificación, supresión): se canalizan
      por la clínica. El acceso se responde con la ficha del paciente y la rectificación con la
      edición de datos. La supresión se evalúa caso por caso con la clínica: el sistema no la
      implementa (spec §4).

---

## 15. Lista de verificación de puesta en producción

- [ ] Inventario de §1 completo, con todos los servicios con datos personales en la UE (RNF-05).
- [ ] Cloud Firewall aplicado: un escaneo externo solo encuentra los puertos 80 y 443, más el 22 si
      se restringió por IP (RNF-09).
- [ ] La base rechaza conexiones desde fuera del Droplet (RNF-09). En el perfil económico, `db` no
      publica puertos y `web` no la alcanza.
- [ ] Perfil económico: el archivo del registro de transacciones llega al bucket, cifrado, y una
      restauración a un punto en el tiempo funciona (RNF-06, RNF-07).
- [ ] `scalekine_app` no puede ejecutar `DROP`, `ALTER` ni `DELETE` sobre `Turno` (RNF-09, RF-39).
- [ ] `ssh` con contraseña rechazado; `unattended-upgrades` activo (RNF-13).
- [ ] HTTPS con certificado válido, redirección desde HTTP, HSTS y CSP presentes (RNF-01, RNF-10), y las respuestas de `/api` con `Cache-Control: no-store` (RNF-14).
- [ ] Primera copia externa subida y **restaurada con éxito** (RNF-07).
- [ ] Object Lock activo: un intento de borrar una copia, incluso con la clave del administrador,
      falla (RNF-07).
- [ ] Alertas probadas: con la API detenida y con el latido de copia omitido (RNF-12).
- [ ] Comando de instalación ejecutado; el administrador cambió la contraseña y activó el segundo
      factor (RF-05, RNF-04).
- [ ] Los secretos de §9 están en el gestor de contraseñas, incluida la clave privada de `age`.
- [ ] Medidas de §14 firmadas o en curso con la clínica.
- [ ] Criterios de `spec.md` §7 verificados.
