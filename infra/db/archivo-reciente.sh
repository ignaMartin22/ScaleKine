#!/bin/sh
# Latido del archivo continuo (docs/despliegue.md §11): sale con 0 solo si el último archivo del registro
# de transacciones subido al bucket tiene menos de 1 hora. Se ejecuta dentro del contenedor `db`:
#   docker compose exec -T -u postgres db archivo-reciente.sh
# Para que una base sin actividad no parezca atrasada, fuerza un segmento nuevo (punto de restauración y
# cambio de segmento) y exige que ese segmento llegue al bucket en ESPERA segundos: comprueba el camino
# completo, no solo la edad del último archivo. Imprime solo estados y segundos, nunca datos.
set -eu
ESPERA="${ESPERA:-60}"      # segundos que se espera al segmento forzado
MAX_EDAD="${MAX_EDAD:-3600}" # segundos: 1 hora
q() { psql -X -qAt -U "${POSTGRES_USER:?}" -d "${POSTGRES_DB:?}" -c "$1"; }

inicio="$(q "SELECT clock_timestamp()")"
q "SELECT pg_create_restore_point('latido')" >/dev/null
q "SELECT pg_switch_wal()" >/dev/null

i=0
while [ "$i" -lt "$ESPERA" ]; do
  [ "$(q "SELECT count(*) FROM pg_stat_archiver WHERE last_archived_time >= '$inicio'")" = "1" ] && break
  sleep 2; i=$((i + 2))
done

edad="$(q "SELECT floor(extract(epoch FROM now() - last_archived_time))::int FROM pg_stat_archiver WHERE last_archived_time IS NOT NULL")"
fresco="$(q "SELECT count(*) FROM pg_stat_archiver WHERE last_archived_time >= '$inicio'")"
if [ "$fresco" = "1" ] && [ -n "$edad" ] && [ "$edad" -lt "$MAX_EDAD" ]; then
  echo "archivo: segmento nuevo archivado, ultimo archivo hace ${edad} s (limite ${MAX_EDAD} s): OK"
else
  echo "archivo: el segmento nuevo no llego al bucket en ${ESPERA} s (ultimo archivo hace ${edad:-?} s): FALLA" >&2
  exit 1
fi
