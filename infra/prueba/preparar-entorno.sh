#!/bin/sh
# Genera en <directorio> los .env.* ficticios de una prueba local (T-35) y un par de claves age de
# prueba. Contraseñas aleatorias de un solo uso; nada real. El directorio debe quedar fuera del repo.
# Uso: infra/prueba/preparar-entorno.sh <economico|administrado> <directorio> [puerto-https]
set -eu
perfil="${1:?perfil: economico|administrado}"
dir="${2:?directorio de salida}"
puerto="${3:-18443}"
case "$perfil" in
  economico) host=db ;;
  administrado) host=db-externa ;;
  *) echo "Perfil desconocido: $perfil" >&2; exit 2 ;;
esac
mkdir -p "$dir"
clave() { head -c 18 /dev/urandom | od -An -tx1 | tr -d ' \n'; }
cm=$(clave); ca=$(clave); cr=$(clave); cs=$(clave); cc=$(head -c 32 /dev/urandom | base64)
base=scalekine

cat > "$dir/.env.web" <<E
DOMINIO=localhost
ACME_EMAIL=prueba@example.invalid
E
cat > "$dir/.env.api" <<E
DATABASE_URL=postgresql://scalekine_app:$ca@$host:5432/$base
ZONA_HORARIA=America/Argentina/Buenos_Aires
PORT=3000
FRONTEND_ORIGIN=https://localhost:$puerto
COOKIE_SECURE=true
CLAVE_CIFRADO=$cc
NODE_ENV=production
LOG_LEVEL=info
E
cat > "$dir/.env.migraciones" <<E
DATABASE_URL_MIGRACIONES=postgresql://scalekine_migraciones:$cm@$host:5432/$base
E
cat > "$dir/.env.db" <<E
POSTGRES_USER=scalekine
POSTGRES_PASSWORD=$cs
POSTGRES_DB=$base
SCALEKINE_CLAVE_MIGRACIONES=$cm
SCALEKINE_CLAVE_APP=$ca
SCALEKINE_CLAVE_RESPALDO=$cr
SCALEKINE_BASES=$base
SCALEKINE_MIGRACIONES_CREATEDB=false
E
# Claves age de prueba, generadas con la propia imagen `respaldo`.
docker run --rm --entrypoint age-keygen "${IMAGEN_RESPALDO:-scalekine-respaldo:local}" 2> "$dir/age-publica.txt" > "$dir/age-privada.txt"
destinatario=$(sed -n 's/^Public key: //p' "$dir/age-publica.txt")
cat > "$dir/.env.respaldo" <<E
DATABASE_URL_RESPALDO=postgresql://scalekine_respaldo:$cr@$host:5432/$base
AGE_DESTINATARIO=$destinatario
BUCKET=/respaldos
RCLONE_CONFIG_B2_TYPE=local
OMITIR_LATIDO=true
E
echo "Entorno de prueba ($perfil) escrito en $dir"
