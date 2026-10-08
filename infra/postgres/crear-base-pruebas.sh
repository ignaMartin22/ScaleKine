#!/bin/sh
# Crea la base de pruebas de integración de un carril de trabajo en paralelo (docs/tasks.md,
# "Trabajo en paralelo"), con los mismos permisos que scalekine_pruebas. Es idempotente.
#
# Uso, desde cualquier worktree del repositorio, con la base de Docker levantada:
#   infra/postgres/crear-base-pruebas.sh <carril>      # por ejemplo: a, b
set -eu

carril="${1:-}"
case "$carril" in
  '' | *[!a-z0-9]*)
    echo "Uso: $0 <carril>   (solo minúsculas y números, por ejemplo: a, b)" >&2
    exit 1
    ;;
esac
base="scalekine_${carril}_pruebas"

cd "$(dirname "$0")/../.."

docker compose exec -T postgres sh -c 'psql -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres -v base="$1"' sh "$base" <<'SQL'
SELECT format('CREATE DATABASE %I', :'base')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'base') \gexec
SQL

docker compose exec -T postgres sh -c 'psql -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$1" -v base="$1"' sh "$base" <<'SQL'
REVOKE ALL ON DATABASE :"base" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"base" TO scalekine_migraciones, scalekine_app, scalekine_respaldo;
-- El usuario de migraciones es el dueño del esquema, como en las demás bases.
ALTER SCHEMA public OWNER TO scalekine_migraciones;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
SQL

echo "Base $base lista. En el .env del worktree, cambiar scalekine_pruebas por $base en"
echo "DATABASE_URL_PRUEBAS y DATABASE_URL_MIGRACIONES_PRUEBAS."
