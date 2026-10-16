# Infraestructura de producción

Imágenes y configuración de `docs/despliegue.md` §6 (T-35). Los dos perfiles de §3.1 usan las mismas
imágenes; cambia el `.env` del host.

| Pieza | Dónde |
|---|---|
| `web` (Caddy + Angular) | `infra/web/Dockerfile`, `infra/web/Caddyfile` |
| `api` y `migraciones` (Node 24, sin root) | `infra/api/Dockerfile` (targets `api` y `migraciones`) |
| `respaldo` (`pg_dump` + `age` + `rclone`) | `infra/respaldo/Dockerfile`, `respaldo.sh`, `crear-bucket.sh` |
| `db` (PostgreSQL 18 + pgBackRest, perfil económico) | `infra/db/` |
| Temporizadores de systemd | `infra/systemd/`, `infra/latido-archivo.sh` |
| Verificación de restauraciones | `infra/verificar-restauracion.sh`, `docs/operacion/` |
| Stack | `docker-compose.prod.yml` |
| Plantillas | `.env.web.example`, `.env.api.example`, `.env.migraciones.example`, `.env.respaldo.example`, `.env.db.example` |
| Pruebas locales | `infra/prueba/`, `infra/verificar-stack.sh`, `infra/prueba/verificar-t37.sh` |

Las imágenes se construyen con la raíz del repositorio como contexto (`docker compose -f
docker-compose.prod.yml build`) y llevan las bases fijadas por versión.

## Configuración

Copiar cada plantilla a su `.env.*` (sin `.example`), completar y dejar permisos `600`. Cada servicio
recibe solo su archivo. Nada de esto se versiona.

## Perfil administrado (por defecto)

`DATABASE_URL`, `DATABASE_URL_MIGRACIONES` y `DATABASE_URL_RESPALDO` apuntan al PostgreSQL de
DigitalOcean (con `?sslmode=require`). No hay `.env.db` ni servicio `db`.

```sh
docker compose -f docker-compose.prod.yml run --rm migraciones   # una vez por versión, antes de arrancar
docker compose -f docker-compose.prod.yml up -d                  # web + api
```

## Perfil económico

En el `.env` del host (junto al compose): `COMPOSE_PROFILES=base-local` y, con el Block Storage
montado, `DB_DATOS=/mnt/scalekine-db`. Las URL apuntan al host `db`. El script
`infra/postgres/init/02-usuarios.sh` crea los tres usuarios la primera vez que se inicializa el volumen.

```sh
docker compose -f docker-compose.prod.yml up -d db               # primera vez: crea usuarios
docker compose -f docker-compose.prod.yml run --rm migraciones
docker compose -f docker-compose.prod.yml up -d
```

`db` no publica puertos y vive en la red interna `base`, compartida solo con `api`, `migraciones` y
`respaldo`; `web` no pertenece a ella. Además está en la red `salida`, solo para que pgBackRest llegue al bucket.

Archivo continuo del registro de transacciones (`despliegue.md` §8.1): la imagen `db`
(`infra/db/Dockerfile`) es la oficial de PostgreSQL más pgBackRest 2.58.0 (licencia MIT). Las variables
`PGBACKREST_*` no secretas están en el compose; las claves del bucket y la de cifrado, en `.env.db`
(`.env.db.example`). Después del primer arranque (y de crear el bucket, ver más abajo), una sola vez:

```sh
docker compose -f docker-compose.prod.yml exec -T -u postgres db iniciar-archivo.sh
```

Crea el stanza, verifica que el archivo llega al bucket y toma la primera copia base. Después, la copia
base semanal y el latido horario los lanzan los temporizadores de systemd (ver abajo).

## Tareas de una sola ejecución

- Migraciones (con `scalekine_migraciones`; **no** corren al arrancar la API):
  `docker compose -f docker-compose.prod.yml run --rm migraciones`
- Respaldo externo (lo lanza el temporizador de systemd, §8.2):
  `docker compose -f docker-compose.prod.yml run --rm respaldo`

## Temporizadores de systemd (host)

Los instala el administrador (o `infra/provision.sh`, T-36) en el Droplet. Supuestos: el repositorio y los
`.env.*` están en `/opt/scalekine`, propiedad del usuario `deploy`, que pertenece al grupo `docker`.

```sh
sudo cp infra/systemd/scalekine-*.service infra/systemd/scalekine-*.timer /etc/systemd/system/
sudo systemctl daemon-reload
# En los dos perfiles: copia externa diaria, 03:30 hora argentina (§8.2)
sudo systemctl enable --now scalekine-respaldo.timer
# Solo perfil económico: copia base semanal (domingos 04:00) y latido horario del archivo (§8.1, §11)
sudo systemctl enable --now scalekine-copia-base.timer scalekine-latido-archivo.timer
```

El latido horario necesita `/opt/scalekine/.env.latido` (permisos `600`, propiedad de `deploy`) con
`LATIDO_ARCHIVO_URL=https://hc-ping.com/<uuid>`, el check de healthchecks.io de periodo 1 hora y gracia
1 hora (alerta a las 2 horas sin latido, §11). El latido de la copia diaria, `LATIDO_URL`, va en `.env.respaldo`.

Comprobar: `systemctl list-timers 'scalekine-*'` muestra la próxima ejecución de cada uno;
`journalctl -u scalekine-respaldo.service` el resultado de la última. Probar a mano:
`sudo systemctl start scalekine-respaldo.service`.

## Buckets de B2 (una vez, T-36/T-40)

`infra/respaldo/crear-bucket.sh` crea los dos buckets de B2 EU Central por la API S3. Necesita AWS CLI v2 y
una clave de aplicación **temporal** con permisos de buckets (se borra al terminar). Cada nombre de bucket
es único en todo B2.

```sh
export AWS_ENDPOINT_URL=https://s3.eu-central-003.backblazeb2.com AWS_REGION=eu-central-003
export AWS_ACCESS_KEY_ID=<id de la clave temporal> AWS_SECRET_ACCESS_KEY=<clave temporal>
# Copias diarias: Object Lock en modo compliance por 30 días + regla de ciclo de vida (§8.2)
BUCKET=<bucket-de-copias> TIPO=copias infra/respaldo/crear-bucket.sh
# Perfil económico: bucket del registro de transacciones, sin Object Lock (§8.1)
BUCKET=<bucket-del-registro> TIPO=registro infra/respaldo/crear-bucket.sh
```

El script termina con error si el bucket de copias no quedó en `COMPLIANCE` y 30 días. El Object Lock solo
se habilita al crear el bucket. Después se crean las claves de mínimo permiso con la CLI nativa de B2
(`b2`, instalada en la máquina del administrador); la clave es de aplicación, limitada a un bucket:

```sh
# Clave de la tarea diaria: SOLO escribir en el bucket de copias. Sin borrar, sin leer, sin listar.
b2 key create --bucket <bucket-de-copias> scalekine-respaldo writeFiles
# Clave de lectura del administrador, para la prueba mensual y la recuperación (no va al servidor)
b2 key create --bucket <bucket-de-copias> scalekine-restaurar listFiles,readFiles
# Perfil económico: clave de pgBackRest, limitada al bucket del registro (necesita leer, escribir, listar y borrar)
b2 key create --bucket <bucket-del-registro> scalekine-registro listFiles,readFiles,writeFiles,deleteFiles
```

**¿`rclone` necesita permiso de listar?** No. Resuelto en T-37 (`despliegue.md` §8.2). Con una clave
limitada a un bucket, `rclone rcat` solo llama a `b2_get_upload_url` y `b2_upload_file`/`b2_*_large_file`
(permiso `writeFiles`): el identificador del bucket sale de la propia clave y no hay consultas de existencia
ni listados. La prueba local (`infra/prueba/verificar-t37.sh lock`) confirma el mismo principio contra un S3
compatible: una clave que solo puede `PutObject` sube la copia. Confirmar contra B2 real al crear la clave
(`sudo systemctl start scalekine-respaldo.service`); si fallara con un error de permisos, agregar
`listFiles` y nada más, y dejarlo anotado en `despliegue.md` §8.2.

Cada vez que se crea o rota una clave: guardarla en el gestor de contraseñas (§9) y escribirla en el
`.env.respaldo` o `.env.db` del servidor.

## Prueba local de los dos perfiles

Certificado interno de Caddy (nunca Let's Encrypt), puertos 18080 y 18443, proyecto propio. Todo con
valores ficticios en un directorio fuera del repo (`$ENV`).

```sh
docker compose -f docker-compose.prod.yml build
ENV=$(mktemp -d)
export DIR_ENV=$ENV PUERTO_HTTP=18080 PUERTO_HTTPS=18443

# Perfil económico (con db)
infra/prueba/preparar-entorno.sh economico "$ENV"
F="-f docker-compose.prod.yml -f infra/prueba/docker-compose.prueba.yml"
COMPOSE_PROFILES=base-local docker compose -p scalekine-prod-b $F up -d --wait
PROYECTO=scalekine-prod-b PERFIL=economico COMPOSE_FILES="docker-compose.prod.yml infra/prueba/docker-compose.prueba.yml" PRUEBA_RESPALDO=1 infra/verificar-stack.sh
COMPOSE_PROFILES=base-local docker compose -p scalekine-prod-b $F down -v

# Perfil administrado (base externa temporal, sin puertos publicados)
infra/prueba/preparar-entorno.sh administrado "$ENV"
docker compose -p scalekine-prod-b-ext -f infra/prueba/docker-compose.base-externa.yml up -d --wait
F="$F -f infra/prueba/docker-compose.externa.yml"
docker compose -p scalekine-prod-b $F up -d --wait
PROYECTO=scalekine-prod-b PERFIL=administrado COMPOSE_FILES="docker-compose.prod.yml infra/prueba/docker-compose.prueba.yml infra/prueba/docker-compose.externa.yml" PRUEBA_RESPALDO=1 infra/verificar-stack.sh
docker compose -p scalekine-prod-b $F down -v
docker compose -p scalekine-prod-b-ext -f infra/prueba/docker-compose.base-externa.yml down -v
```

## Prueba local de T-37 (copias externas y restauración)

`infra/prueba/verificar-t37.sh` levanta, en un proyecto propio y sin puertos publicados (salvo
`127.0.0.1:18999` para el receptor del latido), el perfil económico con un S3 compatible con Object Lock
(MinIO, instalado desde Alpine en `infra/prueba/s3/`; solo herramienta de prueba, nunca parte del stack de
producción) y ejecuta las verificaciones de la tarea con datos ficticios: copia diaria, descarga,
descifrado con `age`, restauración y `verificar-restauracion.sh`; Object Lock; restauración a un punto en el
tiempo; latido atrasado; y las tres mutaciones.

```sh
export DIR_ENV=/tmp/t37-entorno COMPOSE_PATH_SEPARATOR=: COMPOSE_FILE=docker-compose.prod.yml:infra/prueba/docker-compose.s3.yml
mkdir -p "$DIR_ENV" && echo "MINIO_ROOT_USER=x" > "$DIR_ENV/.env.s3"   # solo para que compose interpole el build
docker compose --profile base-local --profile tareas --profile migraciones build respaldo db s3 migraciones
infra/prueba/verificar-t37.sh todo      # o etapas sueltas: preparar copia lock pitr latido mutaciones limpiar
```

`todo` termina con `down -v` de todo lo que creó.
