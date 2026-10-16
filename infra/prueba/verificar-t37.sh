#!/usr/bin/env bash
# Verificaciones de T-37 en local, con datos ficticios y un S3 compatible con Object Lock (MinIO) en un
# contenedor. Nada contra Backblaze ni healthchecks.io. RNF-05, RNF-06, RNF-07, RNF-12.
#
# Uso:  infra/prueba/verificar-t37.sh <etapa>...      etapas: preparar copia lock pitr latido mutaciones limpiar
#       infra/prueba/verificar-t37.sh todo             (todas, en orden, y limpia al final)
# Entorno:
#   T37_ENV       directorio de los .env.* y las claves de prueba (se crea si falta; fuera del repo)
#   T37_PROYECTO  proyecto de compose (por defecto scalekine-t37-a)
# Requiere las imágenes construidas: docker compose -f docker-compose.prod.yml -f infra/prueba/docker-compose.s3.yml
#   --profile base-local --profile tareas --profile migraciones build respaldo db s3 migraciones
# No publica puertos salvo 127.0.0.1:18999 para el receptor del latido. Imprime OK/FALLA por comprobación.
set -uo pipefail
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/../.."

T37_ENV="${T37_ENV:-$(cd "${TMPDIR:-/tmp}" && pwd)/t37-entorno}"
export DIR_ENV="$T37_ENV" COMPOSE_PROJECT_NAME="${T37_PROYECTO:-scalekine-t37-a}" COMPOSE_PROFILES=base-local
export COMPOSE_PATH_SEPARATOR=":" COMPOSE_FILE="docker-compose.prod.yml:infra/prueba/docker-compose.s3.yml"
RECEPTOR="scalekine-t37-receptor"
PUERTO_RECEPTOR=18999

dc() { docker compose "$@"; }
fallas=0
ok() { echo "OK     $1"; }
falla() { echo "FALLA  $1"; fallas=$((fallas + 1)); }
# Comprobación que debe cumplirse / comprobación que debe NO cumplirse.
debe() { local d="$1"; shift; if "$@" >/dev/null 2>&1; then ok "$d"; else falla "$d"; fi; }
no_debe() { local d="$1"; shift; if "$@" >/dev/null 2>&1; then falla "$d"; else ok "$d"; fi; }
cargar_claves() { set -a; . "$T37_ENV/.env.claves"; set +a; }

# Ejecuta algo dentro del contenedor s3 como administrador del S3 local.
en_s3() { # comando...
  cargar_claves
  dc exec -T -e AWS_ACCESS_KEY_ID="$ADMIN_U" -e AWS_SECRET_ACCESS_KEY="$ADMIN_P" -e AWS_ENDPOINT_URL=https://localhost \
    -e AWS_REGION=us-east-1 -e AWS_CA_BUNDLE=/certs/public.crt s3 "$@"
}
psql_db() { dc exec -T db sh -c 'psql -X -qAt -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "$1"' _ "$1"; }

# ---------------------------------------------------------------------------------------------- preparar
sembrar() { # etiqueta cantidad : pacientes ficticios, cada uno con un turno y su evento
  psql_db "
INSERT INTO \"Usuario\"(\"nombreUsuario\",\"hashContrasena\",rol,\"creadoEn\") VALUES ('zzprueba-admin','x','administrador',now()) ON CONFLICT DO NOTHING;
INSERT INTO \"Kinesiologo\"(\"usuarioId\",nombre,bloque) SELECT id,'ZZPRUEBA-Kine','manana' FROM \"Usuario\" WHERE \"nombreUsuario\"='zzprueba-admin' ON CONFLICT DO NOTHING;
WITH p AS (
  INSERT INTO \"Paciente\"(dni,nombre,telefono,\"obraSocial\")
  SELECT lpad((random()*99999999)::int::text, 8, '9'), 'ZZPRUEBA-$1-' || g, '0000-000000', 'ZZPRUEBA-OS'
  FROM generate_series(1,$2) g RETURNING id),
t AS (
  INSERT INTO \"Turno\"(\"pacienteId\",\"kinesiologoId\",fecha,\"horaInicio\",\"creadoPorId\",\"creadoEn\")
  SELECT p.id,(SELECT id FROM \"Kinesiologo\" LIMIT 1),current_date,'09:00',(SELECT id FROM \"Usuario\" LIMIT 1),now() FROM p RETURNING id)
INSERT INTO \"TurnoEvento\"(\"turnoId\",tipo,\"autorId\",\"ocurridoEn\") SELECT t.id,'asignacion',(SELECT id FROM \"Usuario\" LIMIT 1),now() FROM t;" >/dev/null
}
contar() { psql_db "SELECT count(*) FROM \"Paciente\" WHERE nombre LIKE 'ZZPRUEBA-$1-%'"; }

etapa_preparar() {
  echo "== Preparar: entorno ficticio, S3 local con Object Lock y base con archivo continuo"
  mkdir -p "$T37_ENV"
  infra/prueba/preparar-entorno.sh economico "$T37_ENV" >/dev/null && ok "entorno ficticio escrito" || { falla "preparar-entorno.sh"; return 1; }
  infra/prueba/preparar-s3.sh "$T37_ENV" >/dev/null && ok "credenciales del S3 local escritas" || { falla "preparar-s3.sh"; return 1; }
  dc up -d --wait s3 >/dev/null 2>&1 && ok "S3 local arriba" || { falla "S3 local no arrancó"; return 1; }
  dc cp infra/respaldo/crear-bucket.sh s3:/tmp/crear-bucket.sh >/dev/null 2>&1
  cargar_claves
  if dc exec -T -e ADMIN_U="$ADMIN_U" -e ADMIN_P="$ADMIN_P" -e RESP_U="$RESP_U" -e RESP_P="$RESP_P" -e WAL_U="$WAL_U" -e WAL_P="$WAL_P" \
       s3 bash -s < infra/prueba/provisionar-s3.sh > "$T37_ENV/provision.log" 2>&1; then ok "buckets y claves de mínimo permiso creados (crear-bucket.sh real)"
  else falla "provisionar-s3.sh (ver $T37_ENV/provision.log)"; return 1; fi
  dc up -d --wait db >/dev/null 2>&1 && ok "db arriba (pgBackRest instalado)" || { falla "db no arrancó"; return 1; }
  dc run --rm migraciones >/dev/null 2>&1 && ok "migraciones aplicadas" || { falla "migraciones"; return 1; }
  if dc exec -T -u postgres db iniciar-archivo.sh >"$T37_ENV/iniciar.log" 2>&1; then ok "stanza creado, archivo verificado y primera copia base tomada"
  else falla "iniciar-archivo.sh (ver $T37_ENV/iniciar.log)"; return 1; fi
}

# ------------------------------------------------------------------------------- verificación 1 · copia diaria
etapa_copia() {
  echo "== Verificación 1: copia diaria -> S3 local -> descarga -> age -> PostgreSQL temporal -> verificar-restauracion.sh"
  sembrar COPIA 3
  psql_db "SELECT count(*) FROM \"Paciente\"" >/dev/null
  dc run --rm respaldo >"$T37_ENV/respaldo.log" 2>&1 && ok "respaldo.sh terminó y subió la copia" || { falla "respaldo.sh falló"; return 1; }
  local nombre
  nombre="$(en_s3 mc --insecure ls --recursive local/scalekine-copias 2>/dev/null | awk '{print $NF}' | sort | tail -n1 | tr -d '\r')"
  [ -n "$nombre" ] && ok "la copia está en el bucket" || { falla "no hay copia en el bucket"; return 1; }
  echo "$nombre" > "$T37_ENV/ultima-copia.txt"
  cargar_claves
  en_s3 sh -c "mc --insecure alias set l https://localhost '$ADMIN_U' '$ADMIN_P' >/dev/null && mc --insecure cat l/scalekine-copias/$nombre" > "$T37_ENV/copia.dump.age" 2>/dev/null
  [ -s "$T37_ENV/copia.dump.age" ] && ok "copia descargada ($(wc -c < "$T37_ENV/copia.dump.age") bytes)" || { falla "descarga"; return 1; }
  no_debe "la copia descargada no contiene datos legibles (está cifrada)" grep -qa "ZZPRUEBA" "$T37_ENV/copia.dump.age"
  docker run --rm -i -e K="$(cat "$T37_ENV/age-privada.txt")" --entrypoint sh scalekine-respaldo:local \
    -c 'printf "%s\n" "$K" > /tmp/k && age -d -i /tmp/k' < "$T37_ENV/copia.dump.age" > "$T37_ENV/copia.dump" 2>/dev/null
  [ -s "$T37_ENV/copia.dump" ] && ok "copia descifrada con la clave age de prueba" || { falla "descifrado"; return 1; }
  infra/verificar-restauracion.sh "$T37_ENV/copia.dump" | tee "$T37_ENV/verificacion.txt"
  [ "${PIPESTATUS[0]}" -eq 0 ] && ok "verificar-restauracion.sh dio OK" || falla "verificar-restauracion.sh no dio OK"
  no_debe "la salida de verificar-restauracion.sh no contiene datos ficticios (nombres, obra social)" grep -q "ZZPRUEBA" "$T37_ENV/verificacion.txt"
  rm -f "$T37_ENV/copia.dump"
}

# -------------------------------------------------------------------------------- verificación 2 · Object Lock
# Devuelve 0 si el bucket resiste el borrado y la sobrescritura de una copia, aun con el administrador.
resiste_lock() { # bucket
  local b="$1" k="prueba-lock-$RANDOM.txt" v h1 h2
  en_s3 sh -c "echo contenido-original-ficticio > /tmp/o.txt && aws s3api put-object --bucket $b --key $k --body /tmp/o.txt >/dev/null" || return 2
  v="$(en_s3 aws s3api list-object-versions --bucket "$b" --prefix "$k" --query 'Versions[0].VersionId' --output text | tr -d '\r')"
  h1="$(en_s3 sh -c "aws s3api get-object --bucket $b --key $k --version-id '$v' /tmp/g1 >/dev/null && sha256sum /tmp/g1" | cut -d' ' -f1)"
  # Intentos del administrador: borrar la versión, acortar la retención y sobrescribir la clave.
  if en_s3 aws s3api delete-object --bucket "$b" --key "$k" --version-id "$v" >/dev/null 2>&1; then echo "  borrar la versión: PERMITIDO"; return 1; fi
  echo "  borrar la versión: rechazado"
  if en_s3 aws s3api put-object-retention --bucket "$b" --key "$k" --version-id "$v" --bypass-governance-retention \
       --retention "{\"Mode\":\"GOVERNANCE\",\"RetainUntilDate\":\"2020-01-01T00:00:00Z\"}" >/dev/null 2>&1; then echo "  acortar la retención: PERMITIDO"; return 1; fi
  echo "  acortar la retención: rechazado"
  en_s3 sh -c "echo contenido-sobrescrito > /tmp/s.txt && aws s3api put-object --bucket $b --key $k --body /tmp/s.txt >/dev/null" >/dev/null 2>&1
  h2="$(en_s3 sh -c "aws s3api get-object --bucket $b --key $k --version-id '$v' /tmp/g2 >/dev/null && sha256sum /tmp/g2" 2>/dev/null | cut -d' ' -f1)"
  [ -n "$h1" ] && [ "$h1" = "$h2" ] && { echo "  tras sobrescribir, la versión original sigue intacta"; return 0; }
  echo "  la versión original se perdió o cambió"; return 1
}
etapa_lock() {
  echo "== Verificación 2: Object Lock (compliance, 30 días), aun con la clave de administrador del S3 local"
  local modo dias
  modo="$(en_s3 aws s3api get-object-lock-configuration --bucket scalekine-copias --query 'ObjectLockConfiguration.Rule.DefaultRetention.Mode' --output text | tr -d '\r')"
  dias="$(en_s3 aws s3api get-object-lock-configuration --bucket scalekine-copias --query 'ObjectLockConfiguration.Rule.DefaultRetention.Days' --output text | tr -d '\r')"
  [ "$modo/$dias" = "COMPLIANCE/30" ] && ok "bucket con Object Lock COMPLIANCE por 30 días" || falla "configuración del bucket: $modo/$dias"
  resiste_lock scalekine-copias && ok "no se puede borrar ni sobrescribir una copia (ni con la clave del administrador)" || falla "el bucket de copias NO resiste el borrado o la sobrescritura"
  # La clave de la tarea (mínimo permiso): no lista, no lee, no borra.
  cargar_claves
  local nombre; nombre="$(cat "$T37_ENV/ultima-copia.txt" 2>/dev/null)"
  local rc=(dc exec -T -e AWS_ACCESS_KEY_ID="$RESP_U" -e AWS_SECRET_ACCESS_KEY="$RESP_P" -e AWS_ENDPOINT_URL=https://localhost -e AWS_REGION=us-east-1 -e AWS_CA_BUNDLE=/certs/public.crt s3 aws s3api)
  no_debe "la clave de la tarea no puede borrar" "${rc[@]}" delete-object --bucket scalekine-copias --key "$nombre"
  no_debe "la clave de la tarea no puede listar" "${rc[@]}" list-objects-v2 --bucket scalekine-copias
  no_debe "la clave de la tarea no puede leer" "${rc[@]}" get-object --bucket scalekine-copias --key "$nombre" /tmp/x
  # rclone, con esa clave y sin permiso de listar, sube una copia (resuelve el [verificar en T-37] de §8.2).
  dc run --rm respaldo >"$T37_ENV/respaldo2.log" 2>&1 && ok "rclone sube con una clave que solo puede escribir (sin listar ni leer)" || falla "rclone no pudo subir con la clave de solo escritura"
}

# ---------------------------------------------------------------------------------- verificación 3 · PITR
etapa_pitr() {
  echo "== Verificación 3: perfil económico, restauración a un punto en el tiempo desde el bucket del registro"
  sembrar ANTES 4
  sleep 2
  local T; T="$(psql_db "SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.US') || '+00'" | tr -d '\r')"
  echo "T = $T"
  sleep 3
  sembrar DESPUES 5
  echo "antes de restaurar: ANTES=$(contar ANTES) DESPUES=$(contar DESPUES)"
  # Fuerza y espera el archivo del segmento que contiene lo posterior a T.
  dc exec -T -u postgres db archivo-reciente.sh >/dev/null 2>&1 && ok "el registro posterior a T llegó al bucket" || falla "archivo-reciente.sh"
  dc stop db >/dev/null 2>&1
  dc run --rm --no-deps --entrypoint "" -u postgres db pgbackrest --delta --type=time "--target=$T" --target-action=promote restore >"$T37_ENV/restaurar.log" 2>&1 \
    && ok "pgbackrest restore a T terminó" || { falla "pgbackrest restore (ver $T37_ENV/restaurar.log)"; return 1; }
  dc up -d --wait db >/dev/null 2>&1 && ok "db arrancó tras la restauración" || { falla "db no arrancó"; return 1; }
  local a d; a="$(contar ANTES)"; d="$(contar DESPUES)"
  echo "después de restaurar: ANTES=$a DESPUES=$d"
  [ "$a" = 4 ] && [ "$d" = 0 ] && ok "quedan solo los datos anteriores a T" || falla "la restauración no dejó solo lo anterior a T"
  [ "$(contar COPIA)" = 3 ] && ok "los datos de antes de la copia base también están" || falla "faltan datos anteriores"
  dc exec -T -u postgres db archivo-reciente.sh >/dev/null 2>&1 && ok "tras restaurar, el archivo continuo sigue funcionando (línea de tiempo nueva)" || falla "el archivo no sigue tras restaurar"
  verificar_cifrado
}

# Comprueba que el repositorio del registro de transacciones está cifrado.
verificar_cifrado() {
  local info magia
  info="$(dc exec -T -u postgres db pgbackrest info 2>/dev/null)"
  printf '%s' "$info" | grep -q "cipher: aes-256-cbc" && ok "pgbackrest info: repositorio cifrado (aes-256-cbc)" || falla "pgbackrest info no muestra cifrado aes-256-cbc"
  magia="$(en_s3 sh -c "mc --insecure alias set l https://localhost '$ADMIN_U' '$ADMIN_P' >/dev/null && mc --insecure cat l/scalekine-registro/scalekine/backup/scalekine/backup.info | head -c 8" 2>/dev/null)"
  [ "$magia" = "Salted__" ] && ok "backup.info en el bucket empieza con la marca de cifrado (Salted__)" || falla "backup.info en el bucket NO está cifrado"
}

# ----------------------------------------------------------------------------------------- verificación 4
conteo_receptor() { docker logs "$RECEPTOR" 2>&1 | grep -c "GET /ping" || true; }
etapa_latido() {
  echo "== Verificación 4: el latido horario no se envía si el archivo está atrasado"
  docker rm -f "$RECEPTOR" >/dev/null 2>&1
  docker run -d --name "$RECEPTOR" -p "127.0.0.1:$PUERTO_RECEPTOR:8080" alpine:3.23.6 httpd -f -vv -p 8080 -h /tmp >/dev/null
  sleep 2
  export LATIDO_ARCHIVO_URL="http://127.0.0.1:$PUERTO_RECEPTOR/ping"
  local n0 n1 n2 n3
  n0="$(conteo_receptor)"
  ESPERA=30 infra/latido-archivo.sh >"$T37_ENV/latido1.log" 2>&1 && ok "archivo al día: el script terminó bien" || falla "archivo al día: el script falló"
  n1="$(conteo_receptor)"
  [ "$n1" -eq $((n0 + 1)) ] && ok "archivo al día: el receptor recibió 1 latido" || falla "archivo al día: el receptor recibió $((n1 - n0)) latidos"
  dc stop s3 >/dev/null 2>&1
  ESPERA=10 infra/latido-archivo.sh >"$T37_ENV/latido2.log" 2>&1 && falla "archivo atrasado: el script NO falló" || ok "archivo atrasado (S3 caído): el script falla"
  n2="$(conteo_receptor)"
  [ "$n2" -eq "$n1" ] && ok "archivo atrasado: el receptor NO recibió latido" || falla "archivo atrasado: se envió un latido"
  dc start s3 >/dev/null 2>&1; dc up -d --wait s3 >/dev/null 2>&1
  ESPERA=90 infra/latido-archivo.sh >"$T37_ENV/latido3.log" 2>&1 && ok "S3 de vuelta: el archivo se pone al día y el script termina bien" || falla "S3 de vuelta: el script falló"
  n3="$(conteo_receptor)"
  [ "$n3" -eq $((n2 + 1)) ] && ok "S3 de vuelta: el receptor recibió el latido" || falla "S3 de vuelta: latidos recibidos $((n3 - n2))"
  docker rm -f "$RECEPTOR" >/dev/null 2>&1
}

# -------------------------------------------------------------------------------------------- mutaciones
etapa_mutaciones() {
  echo "== Mutación 1: bucket SIN Object Lock; la verificación 2 tiene que detectarlo"
  en_s3 aws s3api create-bucket --bucket scalekine-sin-lock >/dev/null 2>&1
  if resiste_lock scalekine-sin-lock; then falla "MUTACIÓN 1 NO DETECTADA"; else ok "MUTACIÓN 1 detectada: sin Object Lock la verificación falla"; fi

  echo "== Mutación 2a: repositorio SIN cifrar (cipher none, ruta nueva); la verificación de cifrado tiene que detectarlo"
  local base=(dc exec -T -u postgres -e PGBACKREST_REPO1_PATH=/mutada -e PGBACKREST_REPO1_CIPHER_TYPE=none db)
  "${base[@]}" pgbackrest stanza-create >/dev/null 2>&1
  "${base[@]}" pgbackrest --type=full backup >/dev/null 2>&1
  local magia; cargar_claves
  magia="$(en_s3 sh -c "mc --insecure alias set l https://localhost '$ADMIN_U' '$ADMIN_P' >/dev/null && mc --insecure cat l/scalekine-registro/mutada/backup/scalekine/backup.info | head -c 8" 2>/dev/null)"
  if [ "$magia" = "Salted__" ]; then falla "MUTACIÓN 2a NO DETECTADA"; else ok "MUTACIÓN 2a detectada: el backup.info sin cifrar no empieza con Salted__"; fi
  local sininfo; sininfo="$("${base[@]}" pgbackrest info 2>/dev/null)"
  printf '%s' "$sininfo" | grep -q "cipher: aes-256-cbc" && falla "MUTACIÓN 2a: pgbackrest info sigue mostrando cifrado" || ok "MUTACIÓN 2a detectada: pgbackrest info no muestra cifrado"

  echo "== Mutación 2b: clave de cifrado equivocada; el archivo continuo y el latido tienen que fallar"
  local mala=(dc exec -T -u postgres -e PGBACKREST_REPO1_CIPHER_PASS=clave-equivocada db)
  if "${mala[@]}" pgbackrest check >/dev/null 2>&1; then falla "MUTACIÓN 2b NO DETECTADA"; else ok "MUTACIÓN 2b detectada: pgbackrest check falla con otra clave de cifrado"; fi

  echo "== Mutación 3: verificar-restauracion.sh imprime un nombre; la comprobación de datos personales tiene que detectarlo"
  [ -s "$T37_ENV/copia.dump.age" ] || { falla "falta la copia de la etapa 'copia'"; return 1; }
  docker run --rm -i -e K="$(cat "$T37_ENV/age-privada.txt")" --entrypoint sh scalekine-respaldo:local \
    -c 'printf "%s\n" "$K" > /tmp/k && age -d -i /tmp/k' < "$T37_ENV/copia.dump.age" > "$T37_ENV/copia.dump" 2>/dev/null
  sed 's|^echo "pacientes: .*|&; echo "ejemplo: $(sql '"'"'SELECT nombre FROM "Paciente" LIMIT 1'"'"')"|' infra/verificar-restauracion.sh > "$T37_ENV/verificar-mutado.sh"
  chmod +x "$T37_ENV/verificar-mutado.sh"
  "$T37_ENV/verificar-mutado.sh" "$T37_ENV/copia.dump" > "$T37_ENV/salida-mutada.txt" 2>&1
  if grep -q "ZZPRUEBA" "$T37_ENV/salida-mutada.txt"; then ok "MUTACIÓN 3 detectada: la salida mutada contiene un nombre ficticio y la comprobación grep la rechaza"
  else falla "MUTACIÓN 3 NO DETECTADA (la mutación no imprimió el nombre)"; fi
  rm -f "$T37_ENV/copia.dump"
}

etapa_limpiar() {
  echo "== Limpiar: down -v de todo lo mío"
  docker rm -f "$RECEPTOR" >/dev/null 2>&1
  dc down -v --remove-orphans >/dev/null 2>&1
  docker ps -a --filter "name=scalekine-verif" -q | xargs -r docker rm -f >/dev/null 2>&1
  docker network ls --filter "name=scalekine-verif" -q | xargs -r docker network rm >/dev/null 2>&1
  rm -rf "$T37_ENV"
}

[ "$#" -gt 0 ] || { sed -n 2,13p "$0"; exit 2; }
etapas=("$@")
[ "$1" = todo ] && etapas=(preparar copia lock pitr latido mutaciones limpiar)
for e in "${etapas[@]}"; do "etapa_$e" || { echo "(la etapa $e terminó con errores)"; }; done
echo "== Resumen: $fallas comprobaciones fallidas"
[ "$fallas" -eq 0 ]
