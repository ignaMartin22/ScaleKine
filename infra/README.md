# Infraestructura de producción

Imágenes y configuración de `docs/despliegue.md` §6 (T-35). Los dos perfiles de §3.1 usan las mismas
imágenes; cambia el `.env` del host.

| Pieza | Dónde |
|---|---|
| `web` (Caddy + Angular) | `infra/web/Dockerfile`, `infra/web/Caddyfile` |
| `api` y `migraciones` (Node 24, sin root) | `infra/api/Dockerfile` (targets `api` y `migraciones`) |
| `respaldo` (`pg_dump` + `age` + `rclone`) | `infra/respaldo/Dockerfile`, `respaldo.sh` |
| Stack | `docker-compose.prod.yml` |
| Plantillas | `.env.web.example`, `.env.api.example`, `.env.migraciones.example`, `.env.respaldo.example`, `.env.db.example` |
| Pruebas locales | `infra/prueba/`, `infra/verificar-stack.sh` |

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
`respaldo`; `web` no pertenece a ella. Pendiente en T-37: el archivo continuo del registro de
transacciones (pgBackRest).

## Tareas de una sola ejecución

- Migraciones (con `scalekine_migraciones`; **no** corren al arrancar la API):
  `docker compose -f docker-compose.prod.yml run --rm migraciones`
- Respaldo externo (lo lanza el temporizador de systemd, §8.2):
  `docker compose -f docker-compose.prod.yml run --rm respaldo`

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
