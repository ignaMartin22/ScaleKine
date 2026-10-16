#!/bin/sh
# Copia externa diaria (docs/despliegue.md §8.2): pg_dump | age | rclone, y latido al terminar.
# Variables: DATABASE_URL_RESPALDO, AGE_DESTINATARIO, BUCKET, LATIDO_URL y la configuración de rclone
# (RCLONE_CONFIG_B2_*). Nunca se imprimen sus valores.
set -eu
# Si falla pg_dump, falla todo y no se envía el latido.
set -o pipefail

: "${DATABASE_URL_RESPALDO:?Falta DATABASE_URL_RESPALDO}"
: "${AGE_DESTINATARIO:?Falta AGE_DESTINATARIO}"
: "${BUCKET:?Falta BUCKET}"

pg_dump --format=custom "$DATABASE_URL_RESPALDO" \
  | age -r "$AGE_DESTINATARIO" \
  | rclone rcat "b2:$BUCKET/scalekine-$(date -u +%Y-%m-%dT%H%M).dump.age"

# El latido avisa que la copia terminó bien. Solo se omite si se pide explícitamente (pruebas).
if [ "${OMITIR_LATIDO:-false}" = "true" ]; then
  echo "respaldo: copia subida; latido omitido por OMITIR_LATIDO."
else
  : "${LATIDO_URL:?Falta LATIDO_URL (o OMITIR_LATIDO=true en pruebas)}"
  curl -fsS -o /dev/null "$LATIDO_URL"
  echo "respaldo: copia subida y latido enviado."
fi
