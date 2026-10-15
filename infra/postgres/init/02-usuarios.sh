#!/bin/sh
# Crea los tres usuarios de despliegue.md §7 en el PostgreSQL de desarrollo y en el contenedor `db`
# del perfil económico de producción (docker-compose.prod.yml, T-35).
# Las tablas y los permisos sobre ellas los crean las migraciones de backend/prisma/migrations.
#
# Por defecto es la configuración de desarrollo: dos bases y scalekine_migraciones con CREATEDB, porque
# `prisma migrate dev` necesita una base temporal (shadow database). En producción solo se usa
# `prisma migrate deploy`, que no la necesita; por eso el compose de producción fija
# SCALEKINE_BASES=<base> y SCALEKINE_MIGRACIONES_CREATEDB=false.
set -eu

: "${SCALEKINE_CLAVE_MIGRACIONES:?Falta SCALEKINE_CLAVE_MIGRACIONES en .env}"
: "${SCALEKINE_CLAVE_APP:?Falta SCALEKINE_CLAVE_APP en .env}"
: "${SCALEKINE_CLAVE_RESPALDO:?Falta SCALEKINE_CLAVE_RESPALDO en .env}"
BASES="${SCALEKINE_BASES:-scalekine_desarrollo scalekine_pruebas}"
CREATEDB=CREATEDB
[ "${SCALEKINE_MIGRACIONES_CREATEDB:-true}" = "false" ] && CREATEDB=NOCREATEDB

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v clave_migraciones="$SCALEKINE_CLAVE_MIGRACIONES" \
  -v clave_app="$SCALEKINE_CLAVE_APP" \
  -v clave_respaldo="$SCALEKINE_CLAVE_RESPALDO" \
  -v createdb="$CREATEDB" <<'SQL'
CREATE ROLE scalekine_migraciones LOGIN :createdb PASSWORD :'clave_migraciones';
CREATE ROLE scalekine_app LOGIN PASSWORD :'clave_app';
CREATE ROLE scalekine_respaldo LOGIN PASSWORD :'clave_respaldo';
SQL

for base in $BASES; do
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$base" -v base="$base" <<'SQL'
REVOKE ALL ON DATABASE :"base" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"base" TO scalekine_migraciones, scalekine_app, scalekine_respaldo;
-- El usuario de migraciones es el dueño del esquema: es el único que crea y altera tablas.
ALTER SCHEMA public OWNER TO scalekine_migraciones;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
SQL
done
