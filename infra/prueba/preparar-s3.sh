#!/bin/sh
# Prepara las credenciales ficticias del S3 local de T-37 y apunta a él los .env.respaldo y .env.db que dejó
# infra/prueba/preparar-entorno.sh economico <directorio>. Escribe .env.s3 (administrador del S3 local) y
# .env.claves (claves de las dos tareas). Todo con valores aleatorios de un solo uso, fuera del repo.
# Uso: infra/prueba/preparar-s3.sh <directorio>
set -eu
dir="${1:?directorio del entorno de prueba}"
aleatorio() { head -c 18 /dev/urandom | od -An -tx1 | tr -d ' \n'; }
admin_u="admin$(aleatorio | head -c 6)"; admin_p="$(aleatorio)"
resp_u="respaldo$(aleatorio | head -c 6)"; resp_p="$(aleatorio)"
wal_u="registro$(aleatorio | head -c 6)"; wal_p="$(aleatorio)"
cifrado="$(head -c 36 /dev/urandom | base64)"
cat > "$dir/.env.s3" <<E2
MINIO_ROOT_USER=$admin_u
MINIO_ROOT_PASSWORD=$admin_p
E2
cat > "$dir/.env.claves" <<E2
ADMIN_U=$admin_u
ADMIN_P=$admin_p
RESP_U=$resp_u
RESP_P=$resp_p
WAL_U=$wal_u
WAL_P=$wal_p
E2
# respaldo: rclone con el backend S3 (en producción es el backend b2; el remoto se llama igual). El backend
# S3 crea el bucket y consulta el objeto subido; se desactiva (no_check_bucket, no_head) para ensayar una clave
# que solo escribe, como la de B2 (el backend b2 no hace ninguna de las dos cosas con una clave de un bucket).
sed -i '/^BUCKET=/d;/^RCLONE_CONFIG_B2_/d' "$dir/.env.respaldo"
cat >> "$dir/.env.respaldo" <<E2
BUCKET=scalekine-copias
RCLONE_CONFIG_B2_TYPE=s3
RCLONE_CONFIG_B2_PROVIDER=Minio
RCLONE_CONFIG_B2_ENDPOINT=https://s3
RCLONE_CONFIG_B2_ACCESS_KEY_ID=$resp_u
RCLONE_CONFIG_B2_SECRET_ACCESS_KEY=$resp_p
RCLONE_CA_CERT=/certs/public.crt
RCLONE_CONFIG_B2_NO_CHECK_BUCKET=true
RCLONE_CONFIG_B2_NO_HEAD=true
E2
# db: pgBackRest hacia el bucket del registro de transacciones.
cat >> "$dir/.env.db" <<E2
PGBACKREST_REPO1_S3_ENDPOINT=s3
PGBACKREST_REPO1_S3_REGION=us-east-1
PGBACKREST_REPO1_S3_BUCKET=scalekine-registro
PGBACKREST_REPO1_S3_KEY=$wal_u
PGBACKREST_REPO1_S3_KEY_SECRET=$wal_p
PGBACKREST_REPO1_S3_URI_STYLE=path
PGBACKREST_REPO1_STORAGE_CA_FILE=/certs/public.crt
PGBACKREST_REPO1_CIPHER_PASS=$cifrado
E2
echo "Credenciales del S3 local escritas en $dir"
