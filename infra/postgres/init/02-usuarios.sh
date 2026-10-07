#!/bin/sh
# Crea en el PostgreSQL de desarrollo los mismos tres usuarios que producción (despliegue.md §7).
# Las tablas y los permisos sobre ellas los crean las migraciones de backend/prisma/migrations.
#
# Diferencia con producción: acá scalekine_migraciones puede crear bases, porque
# `prisma migrate dev` necesita una base temporal (shadow database). En producción solo se usa
# `prisma migrate deploy`, que no la necesita.
set -eu

: "${SCALEKINE_CLAVE_MIGRACIONES:?Falta SCALEKINE_CLAVE_MIGRACIONES en .env}"
: "${SCALEKINE_CLAVE_APP:?Falta SCALEKINE_CLAVE_APP en .env}"
: "${SCALEKINE_CLAVE_RESPALDO:?Falta SCALEKINE_CLAVE_RESPALDO en .env}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v clave_migraciones="$SCALEKINE_CLAVE_MIGRACIONES" \
  -v clave_app="$SCALEKINE_CLAVE_APP" \
  -v clave_respaldo="$SCALEKINE_CLAVE_RESPALDO" <<'SQL'
CREATE ROLE scalekine_migraciones LOGIN CREATEDB PASSWORD :'clave_migraciones';
CREATE ROLE scalekine_app LOGIN PASSWORD :'clave_app';
CREATE ROLE scalekine_respaldo LOGIN PASSWORD :'clave_respaldo';
SQL

for base in scalekine_desarrollo scalekine_pruebas; do
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$base" -v base="$base" <<'SQL'
REVOKE ALL ON DATABASE :"base" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"base" TO scalekine_migraciones, scalekine_app, scalekine_respaldo;
-- El usuario de migraciones es el dueño del esquema: es el único que crea y altera tablas.
ALTER SCHEMA public OWNER TO scalekine_migraciones;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
SQL
done
