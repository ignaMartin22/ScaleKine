#!/usr/bin/env bash
# Verificación del stack de producción levantado (T-35; la reutiliza T-36). RNF-01, RNF-09, RNF-10, RNF-14.
# Las cabeceras esperadas están escritas acá a propósito, independientes del Caddyfile: así un cambio
# accidental del Caddyfile no pasa inadvertido (despliegue.md §6.2).
#
# Entorno:
#   PROYECTO        proyecto de compose (obligatorio)
#   PERFIL          economico | administrado (obligatorio)
#   COMPOSE_FILES   archivos -f separados por espacio (por defecto: docker-compose.prod.yml)
#   HOST_URL        dominio con el que se consulta (por defecto: localhost)
#   PUERTO_HTTP / PUERTO_HTTPS   puertos del host (por defecto 18080 y 18443)
#   DIR_ENV         directorio de los .env.* (lo usa compose)
#   PRUEBA_RESPALDO=1  aplica las migraciones y ejecuta un respaldo contra un destino local con claves
#                      age de prueba (necesita DIR_ENV con age-privada.txt y los archivos de infra/prueba)
# Sale con código distinto de 0 si algo falla; imprime una línea OK/FALLA por comprobación.
set -u
cd "$(dirname "$0")/.."

: "${PROYECTO:?Falta PROYECTO}"
: "${PERFIL:?Falta PERFIL (economico|administrado)}"
COMPOSE_FILES="${COMPOSE_FILES:-docker-compose.prod.yml}"
HOST_URL="${HOST_URL:-localhost}"
PUERTO_HTTP="${PUERTO_HTTP:-18080}"
PUERTO_HTTPS="${PUERTO_HTTPS:-18443}"
export MSYS_NO_PATHCONV=1

args=()
for f in $COMPOSE_FILES; do args+=(-f "$f"); done
dc() { docker compose -p "$PROYECTO" "${args[@]}" "$@"; }
cid() { dc ps -q "$1" 2>/dev/null | head -n1; }

fallas=0
ok() { echo "OK     $1"; }
falla() { echo "FALLA  $1"; fallas=$((fallas + 1)); }
chequear() { # descripción, comando...
  local d="$1"; shift
  if "$@" >/dev/null 2>&1; then ok "$d"; else falla "$d"; fi
}

URL="https://$HOST_URL:$PUERTO_HTTPS"
cabeceras=$(curl -ksI "$URL/")
salud=$(curl -ksi "$URL/api/salud")

echo "== 0. El Caddyfile de prueba solo agrega 'tls internal'"
if diff <(grep -v '^#' infra/web/Caddyfile) <(grep -v '^#' infra/prueba/Caddyfile.prueba | grep -v 'tls internal') >/dev/null; then
  ok "Caddyfile.prueba == Caddyfile + tls internal"
else falla "Caddyfile.prueba difiere del Caddyfile"; fi
if grep -Eq '^[[:space:]]*log([[:space:]{]|$)' infra/web/Caddyfile; then falla "el Caddyfile declara la directiva log"; else ok "sin directiva log"; fi

echo "== 1. La interfaz carga y /api/salud responde ok"
chequear "GET / devuelve 200 con <app-root>" bash -c "curl -ksf '$URL/' | grep -q '<app-root'"
chequear "GET /agenda devuelve el index (try_files)" bash -c "curl -ksf '$URL/agenda' | grep -q '<app-root'"
if [ "$(printf '%s' "$salud" | tail -n1 | tr -d '\r')" = "ok" ]; then ok "/api/salud responde ok"; else falla "/api/salud no responde ok"; fi

echo "== 2. HTTP redirige a HTTPS"
cod=$(curl -ks -o /dev/null -w '%{http_code}' "http://$HOST_URL:$PUERTO_HTTP/")
loc=$(curl -ksI "http://$HOST_URL:$PUERTO_HTTP/" | tr -d '\r' | sed -n 's/^[Ll]ocation: //p')
case "$cod:$loc" in
  30[1278]:https://*) ok "HTTP $cod -> $loc" ;;
  *) falla "HTTP no redirige a HTTPS (código $cod, Location '$loc')" ;;
esac

echo "== 3. Cabeceras y CSP exactas (§6.2)"
esperadas=(
  "strict-transport-security: max-age=31536000; includeSubDomains"
  "x-content-type-options: nosniff"
  "referrer-policy: no-referrer"
  "permissions-policy: camera=(), microphone=(), geolocation=()"
  "content-security-policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' wss://$HOST_URL; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'"
)
for e in "${esperadas[@]}"; do
  nombre="${e%%:*}"
  real=$(printf '%s\n' "$cabeceras" | tr -d '\r' | grep -i "^$nombre:" | head -n1)
  if [ -n "$real" ] && [ "${real#*: }" = "${e#*: }" ]; then ok "$nombre"; else falla "$nombre (real: '${real:-ausente}')"; fi
done

echo "== 4. /api/salud lleva Cache-Control: no-store"
if printf '%s\n' "$salud" | tr -d '\r' | grep -qi '^cache-control:.*no-store'; then ok "Cache-Control: no-store"; else falla "falta Cache-Control: no-store en /api/salud"; fi

echo "== 5. Sin cabecera Server"
if { printf '%s\n' "$cabeceras"; printf '%s\n' "$salud"; } | grep -qi '^server:'; then falla "hay cabecera Server"; else ok "sin cabecera Server (/ y /api/salud)"; fi

echo "== 6. Aislamiento de la base"
if [ "$PERFIL" = economico ]; then
  db=$(cid db); web=$(cid web)
  if [ -z "$db" ]; then falla "no hay contenedor db en el perfil económico"; else
    pub=$(docker inspect -f '{{json .HostConfig.PortBindings}} {{json .NetworkSettings.Ports}}' "$db")
    if printf '%s' "$pub" | grep -q 'HostPort'; then falla "db publica puertos al host: $pub"; else ok "db no publica puertos"; fi
    if (exec 3<>/dev/tcp/127.0.0.1/5432) 2>/dev/null; then
      echo "AVISO  algo escucha en 127.0.0.1:5432 del host (no es db: db no publica puertos)"
    else ok "127.0.0.1:5432 del host no responde"; fi
    chequear "web no resuelve el nombre db" bash -c "! docker exec '$web' getent hosts db"
    chequear "web no conecta a db:5432" bash -c "! docker exec '$web' nc -z -w 2 db 5432"
    redes=$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$web")
    if printf '%s' "$redes" | grep -q '_base'; then falla "web pertenece a la red de la base ($redes)"; else ok "web no pertenece a la red de la base ($redes)"; fi
    chequear "api alcanza db:5432" docker exec "$(cid api)" node -e "require('net').connect(5432,'db').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))"
  fi
else
  if [ -n "$(cid db)" ]; then falla "hay un contenedor db en el perfil administrado"; else ok "el perfil administrado no levanta db"; fi
fi

echo "== 7. api sin root y con sistema de archivos de solo lectura"
api=$(cid api)
uid=$(docker exec "$api" id -u 2>/dev/null)
if [ -n "$uid" ] && [ "$uid" != 0 ]; then ok "api corre con uid $uid"; else falla "api corre como root (uid '$uid')"; fi
if [ "$(docker inspect -f '{{.HostConfig.ReadonlyRootfs}}' "$api")" = true ]; then ok "ReadonlyRootfs = true"; else falla "ReadonlyRootfs = false"; fi
chequear "no se puede escribir en /backend" bash -c "! docker exec '$api' sh -c 'touch /backend/x'"
chequear "no se puede escribir en /" bash -c "! docker exec '$api' sh -c 'touch /x'"
chequear "ningún puerto de api publicado al host" bash -c "[ -z \"\$(docker port '$api')\" ]"
chequear "api healthy" bash -c "[ \"\$(docker inspect -f '{{.State.Health.Status}}' '$api')\" = healthy ]"

if [ "${PRUEBA_RESPALDO:-0}" = 1 ]; then
  echo "== 8. Respaldo cifrado con age"
  : "${DIR_ENV:?Falta DIR_ENV}"
  vol="${PROYECTO}_respaldos_prueba"
  if dc run --rm migraciones >/dev/null 2>&1; then ok "migraciones aplicadas"; else falla "no se pudieron aplicar las migraciones"; fi
  img=$(dc config --images | grep respaldo | head -n1)
  docker run --rm -u 0 -v "$vol:/respaldos" --entrypoint chown "$img" 10002 /respaldos 2>/dev/null
  if dc run --rm respaldo >/dev/null 2>&1; then ok "respaldo terminó con éxito"; else falla "respaldo falló"; fi
  archivo=$(docker run --rm -v "$vol:/respaldos" --entrypoint sh "$img" -c 'ls /respaldos | head -n1')
  case "$archivo" in
    scalekine-*.dump.age) ok "archivo producido: $archivo" ;;
    *) falla "no hay archivo .dump.age ($archivo)" ;;
  esac
  cab=$(docker run --rm -v "$vol:/respaldos" --entrypoint sh "$img" -c "head -c 21 /respaldos/$archivo")
  if [ "$cab" = "age-encryption.org/v1" ]; then ok "cabecera age-encryption.org/v1 (cifrado)"; else falla "el archivo no parece cifrado con age ($cab)"; fi
  if docker run --rm -v "$vol:/respaldos:ro" -v "$DIR_ENV/age-privada.txt:/clave.txt:ro" --entrypoint sh "$img" \
     -c "age -d -i /clave.txt /respaldos/$archivo | pg_restore -l | grep -q Turno"; then ok "descifra con la clave privada y contiene la tabla Turno"; else falla "no se pudo descifrar o no contiene Turno"; fi
fi

echo
if [ "$fallas" -eq 0 ]; then echo "TODO EN VERDE"; else echo "$fallas COMPROBACIONES FALLARON"; exit 1; fi
