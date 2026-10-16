#!/bin/sh
# Latido horario del archivo continuo (docs/despliegue.md §11), perfil económico. Lo lanza el temporizador
# de systemd en el host: comprueba dentro de `db` que el último archivo subido al bucket tiene menos de
# 1 hora y recién entonces avisa a healthchecks.io. Si el archivo está atrasado sale con error y NO envía
# nada. `db` no tiene salida a internet por la red de la aplicación, por eso el aviso sale desde el host.
# Entorno: LATIDO_ARCHIVO_URL (obligatorio); COMPOSE_FILE (opcional, para pruebas).
set -eu
cd "$(dirname "$0")/.."
: "${LATIDO_ARCHIVO_URL:?Falta LATIDO_ARCHIVO_URL}"
[ -n "${COMPOSE_FILE:-}" ] || export COMPOSE_FILE=docker-compose.prod.yml

docker compose exec -T -u postgres -e ESPERA="${ESPERA:-60}" db archivo-reciente.sh
curl -fsS --max-time 20 "$LATIDO_ARCHIVO_URL" >/dev/null
echo "latido-archivo: latido enviado."
