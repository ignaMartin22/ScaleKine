#!/bin/sh
# Primera vez del perfil económico (docs/despliegue.md §8.1): crea el stanza de pgBackRest, verifica
# que el archivo del registro de transacciones llega al bucket y toma la primera copia base completa.
# Es idempotente. Se ejecuta dentro de `db`, como postgres:
#   docker compose exec -T -u postgres db iniciar-archivo.sh
set -eu
pgbackrest stanza-create
pgbackrest check
if ! pgbackrest info --output=json | grep -q '"backup":\[{'; then
  pgbackrest --type=full --start-fast backup
else
  echo "iniciar-archivo: ya hay una copia base; no se toma otra."
fi
