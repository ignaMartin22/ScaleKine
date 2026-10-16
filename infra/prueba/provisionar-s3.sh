#!/bin/bash
# SOLO PRUEBAS LOCALES (T-37). Se ejecuta DENTRO del contenedor `s3` (docker compose exec -T s3 bash -s):
# crea los dos buckets con infra/respaldo/crear-bucket.sh y las dos claves de mínimo permiso.
# Recibe ADMIN_U, ADMIN_P, RESP_U, RESP_P, WAL_U y WAL_P por entorno.
set -euo pipefail
export AWS_ENDPOINT_URL=https://localhost AWS_REGION=us-east-1 AWS_CA_BUNDLE=/certs/public.crt
export AWS_ACCESS_KEY_ID="$ADMIN_U" AWS_SECRET_ACCESS_KEY="$ADMIN_P"
mc() { command mc --insecure "$@"; }
mc alias set local https://localhost "$ADMIN_U" "$ADMIN_P" >/dev/null

# El script real de producción, sin cambios, contra el S3 local.
[ -x /tmp/crear-bucket.sh ] || { echo "falta /tmp/crear-bucket.sh" >&2; exit 2; }
BUCKET=scalekine-copias TIPO=copias /tmp/crear-bucket.sh
BUCKET=scalekine-registro TIPO=registro /tmp/crear-bucket.sh

# Clave de la tarea diaria: escribir en el bucket de copias y nada más (§8.2).
cat > /tmp/p-copias.json <<'J'
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["s3:PutObject","s3:AbortMultipartUpload"],"Resource":["arn:aws:s3:::scalekine-copias/*"]}]}
J
# Clave de pgBackRest: leer, escribir, listar y borrar (expira lo vencido) solo en el bucket del registro.
cat > /tmp/p-registro.json <<'J'
{"Version":"2012-10-17","Statement":[
 {"Effect":"Allow","Action":["s3:ListBucket","s3:GetBucketLocation"],"Resource":["arn:aws:s3:::scalekine-registro"]},
 {"Effect":"Allow","Action":["s3:GetObject","s3:PutObject","s3:DeleteObject","s3:AbortMultipartUpload","s3:ListMultipartUploadParts"],"Resource":["arn:aws:s3:::scalekine-registro/*"]}]}
J
mc admin policy create local p-copias /tmp/p-copias.json >/dev/null
mc admin policy create local p-registro /tmp/p-registro.json >/dev/null
mc admin user add local "$RESP_U" "$RESP_P" >/dev/null
mc admin user add local "$WAL_U" "$WAL_P" >/dev/null
mc admin policy attach local p-copias --user "$RESP_U" >/dev/null
mc admin policy attach local p-registro --user "$WAL_U" >/dev/null
echo "provisionar-s3: OK"
