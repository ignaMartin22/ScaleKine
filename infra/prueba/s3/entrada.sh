#!/bin/sh
# Genera un certificado autofirmado para el nombre `s3` (pgBackRest exige TLS) y arranca MinIO.
set -eu
mkdir -p /certs /datos
if [ ! -f /certs/public.crt ]; then
  openssl req -x509 -newkey rsa:2048 -nodes -days 3 -subj "/CN=s3" \
    -addext "subjectAltName=DNS:s3,DNS:localhost" \
    -keyout /certs/private.key -out /certs/public.crt 2>/dev/null
  chmod 644 /certs/public.crt /certs/private.key
fi
exec minio server /datos --certs-dir /certs --address ":443" --console-address ":9001"
