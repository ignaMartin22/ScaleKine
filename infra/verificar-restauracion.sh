#!/usr/bin/env bash
# Verificación de una copia restaurada (docs/despliegue.md §8.3, paso 3; RNF-07). Sobre un PostgreSQL
# temporal en Docker: restaura la copia, aplica las migraciones pendientes (a la copia temporal, nunca a
# producción), cuenta pacientes, turnos y eventos y verifica que el último evento sea de las últimas 24 h.
#
# Uso:   infra/verificar-restauracion.sh <copia.dump>      (ya descifrada con age; formato custom de pg_dump)
# Entorno (opcionales):
#   IMAGEN_PG           imagen del PostgreSQL temporal (por defecto postgres:18.6-alpine, la de producción)
#   IMAGEN_MIGRACIONES  imagen con las migraciones del código a desplegar (por defecto scalekine-migraciones:local)
#   MAX_HORAS           antigüedad máxima del último evento (por defecto 24)
#   PROYECTO            prefijo de los recursos temporales (por defecto scalekine-verif-<pid>)
#
# SOLO IMPRIME CONTEOS, FECHAS Y OK/FALLA: nunca el contenido de ninguna fila. Por eso los errores de
# pg_restore y de Prisma (que pueden citar filas) se descartan y solo se informa si fallaron.
# Sale con 0 si todo está bien y con 1 si algo falla. Borra todo lo temporal al terminar.
set -uo pipefail
export MSYS_NO_PATHCONV=1

copia="${1:-}"
[ -n "$copia" ] && [ -f "$copia" ] || { echo "Uso: $0 <copia.dump>" >&2; exit 2; }
IMAGEN_PG="${IMAGEN_PG:-postgres:18.6-alpine}"
IMAGEN_MIGRACIONES="${IMAGEN_MIGRACIONES:-scalekine-migraciones:local}"
MAX_HORAS="${MAX_HORAS:-24}"
P="${PROYECTO:-scalekine-verif-$$}"
red="$P-red"; pg="$P-pg"
clave="$(head -c 18 /dev/urandom | od -An -tx1 | tr -d ' \n')"

limpiar() { docker rm -f "$pg" >/dev/null 2>&1; docker network rm "$red" >/dev/null 2>&1; }
trap limpiar EXIT

fallas=0
ok() { echo "OK     $1"; }
falla() { echo "FALLA  $1"; fallas=$((fallas + 1)); }
sql() { docker exec -e PGPASSWORD="$clave" "$pg" psql -X -qAt -U postgres -d scalekine -c "$1" 2>/dev/null; }

echo "== Base temporal ($IMAGEN_PG), sin puertos publicados"
docker network create --internal "$red" >/dev/null || { echo "FALLA  no se pudo crear la red temporal"; exit 1; }
docker run -d --name "$pg" --network "$red" --tmpfs /var/lib/postgresql \
  -e POSTGRES_PASSWORD="$clave" -e POSTGRES_DB=scalekine "$IMAGEN_PG" >/dev/null || { echo "FALLA  no arrancó la base temporal"; exit 1; }
for _ in $(seq 1 60); do
  docker exec "$pg" pg_isready -U postgres -d scalekine >/dev/null 2>&1 && break; sleep 1
done
# La imagen oficial reinicia el servidor una vez al inicializar: se confirma con una consulta real.
for _ in $(seq 1 30); do [ "$(sql 'SELECT 1')" = 1 ] && break; sleep 1; done
[ "$(sql 'SELECT 1')" = 1 ] && ok "base temporal lista" || { falla "la base temporal no respondió"; exit 1; }

echo "== Restauración de la copia"
if docker exec -i -e PGPASSWORD="$clave" "$pg" pg_restore -U postgres -d scalekine --no-owner --no-privileges --exit-on-error < "$copia" >/dev/null 2>&1; then
  ok "pg_restore terminó sin errores"
else
  falla "pg_restore falló (el detalle se omite a propósito: puede citar filas)"; exit 1
fi

echo "== Migraciones pendientes, aplicadas a la copia temporal"
antes="$(sql 'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL')"
salida="$(docker run --rm --network "$red" \
  -e DATABASE_URL_MIGRACIONES="postgresql://postgres:$clave@$pg:5432/scalekine" \
  "$IMAGEN_MIGRACIONES" npx prisma migrate deploy 2>&1)"
estado=$?
despues="$(sql 'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL')"
if [ "$estado" -eq 0 ]; then ok "migrate deploy: $antes aplicadas en la copia, $despues después (pendientes aplicadas: $((despues - antes)))"
else falla "migrate deploy falló"; fi
unset salida

echo "== Conteos"
pac="$(sql 'SELECT count(*) FROM "Paciente"')"
tur="$(sql 'SELECT count(*) FROM "Turno"')"
eve="$(sql 'SELECT count(*) FROM "TurnoEvento"')"
echo "pacientes: ${pac:-?}"; echo "turnos:    ${tur:-?}"; echo "eventos:   ${eve:-?}"
[[ "$pac" =~ ^[0-9]+$ ]] && [[ "$tur" =~ ^[0-9]+$ ]] && [[ "$eve" =~ ^[0-9]+$ ]] && ok "las tres tablas se pudieron contar" || falla "no se pudieron contar las tablas"
[ "${eve:-0}" -gt 0 ] 2>/dev/null && ok "hay eventos" || falla "no hay eventos"

echo "== Último evento"
ultimo="$(sql "SELECT to_char(max(\"ocurridoEn\") AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC' FROM \"TurnoEvento\"")"
horas="$(sql 'SELECT floor(extract(epoch FROM now() - max("ocurridoEn")) / 3600)::int FROM "TurnoEvento"')"
echo "último evento: ${ultimo:-ninguno} (hace ${horas:-?} h)"
if [[ "$horas" =~ ^-?[0-9]+$ ]] && [ "$horas" -lt "$MAX_HORAS" ]; then ok "el último evento tiene menos de $MAX_HORAS horas"
else falla "el último evento es más viejo que $MAX_HORAS horas o no existe"; fi

echo "== Resultado"
if [ "$fallas" -eq 0 ]; then echo "RESULTADO: OK"; exit 0; else echo "RESULTADO: FALLA ($fallas comprobaciones)"; exit 1; fi
