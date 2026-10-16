#!/usr/bin/env bash
# Crea los buckets de B2 EU de docs/despliegue.md §8 por la API S3 de Backblaze (T-37). Se ejecuta UNA vez,
# a mano, por el administrador, con una clave de aplicación temporal con permiso para crear buckets
# (listBuckets, writeBuckets, writeBucketRetentions, readBucketRetentions) que se borra al terminar.
# Necesita AWS CLI v2. Es idempotente en la configuración: se puede repetir sin romper nada.
#
# Variables:
#   TIPO           copias (por defecto) | registro
#                    copias:   Object Lock en modo compliance por RETENCION_DIAS (30) y regla de ciclo de
#                              vida que borra las copias cuando vence su bloqueo (§8.2).
#                    registro: bucket del archivo continuo (§8.1), SIN Object Lock (pgBackRest borra solo lo
#                              que vence por su retención de 7 días); solo limpia versiones viejas.
#   BUCKET         nombre del bucket (obligatorio, único en todo B2)
#   AWS_ENDPOINT_URL, AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY   (obligatorios)
#   RETENCION_DIAS por defecto 30
#   AWS_CA_BUNDLE  solo pruebas locales (certificado autofirmado)
# El Object Lock solo se puede habilitar al crear el bucket: si el bucket ya existe sin él, hay que
# crear otro. Después se crea la clave de la tarea con el mínimo permiso: ver infra/README.md.
set -euo pipefail
: "${BUCKET:?Falta BUCKET}" "${AWS_ENDPOINT_URL:?Falta AWS_ENDPOINT_URL}" "${AWS_REGION:?Falta AWS_REGION}"
: "${AWS_ACCESS_KEY_ID:?Falta AWS_ACCESS_KEY_ID}" "${AWS_SECRET_ACCESS_KEY:?Falta AWS_SECRET_ACCESS_KEY}"
TIPO="${TIPO:-copias}"
DIAS="${RETENCION_DIAS:-30}"
s3api() { aws s3api "$@"; }

case "$TIPO" in
  copias)
    s3api create-bucket --bucket "$BUCKET" --object-lock-enabled-for-bucket >/dev/null \
      || echo "crear-bucket: el bucket ya existía; se revisa su configuración."
    s3api put-object-lock-configuration --bucket "$BUCKET" --object-lock-configuration \
      "{\"ObjectLockEnabled\":\"Enabled\",\"Rule\":{\"DefaultRetention\":{\"Mode\":\"COMPLIANCE\",\"Days\":$DIAS}}}"
    # La copia deja de estar bloqueada a los DIAS días. A esa edad se oculta y, un día después, su versión
    # se borra (el bloqueo ya venció). Ninguna clave puede adelantar ese borrado.
    s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --lifecycle-configuration "{\"Rules\":[{
      \"ID\":\"retencion-$DIAS-dias\",\"Status\":\"Enabled\",\"Filter\":{\"Prefix\":\"\"},
      \"Expiration\":{\"Days\":$DIAS},
      \"NoncurrentVersionExpiration\":{\"NoncurrentDays\":1},
      \"AbortIncompleteMultipartUpload\":{\"DaysAfterInitiation\":1}}]}"
    ;;
  registro)
    s3api create-bucket --bucket "$BUCKET" >/dev/null || echo "crear-bucket: el bucket ya existía; se revisa su configuración."
    s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --lifecycle-configuration '{"Rules":[{
      "ID":"limpiar-versiones","Status":"Enabled","Filter":{"Prefix":""},
      "NoncurrentVersionExpiration":{"NoncurrentDays":1},
      "AbortIncompleteMultipartUpload":{"DaysAfterInitiation":1}}]}'
    ;;
  *) echo "TIPO desconocido: $TIPO (copias|registro)" >&2; exit 2 ;;
esac

echo "== Configuración resultante de $BUCKET"
if [ "$TIPO" = copias ]; then
  s3api get-object-lock-configuration --bucket "$BUCKET"
  modo="$(s3api get-object-lock-configuration --bucket "$BUCKET" --query 'ObjectLockConfiguration.Rule.DefaultRetention.Mode' --output text)"
  dias="$(s3api get-object-lock-configuration --bucket "$BUCKET" --query 'ObjectLockConfiguration.Rule.DefaultRetention.Days' --output text)"
  [ "$modo" = COMPLIANCE ] && [ "$dias" = "$DIAS" ] || { echo "FALLA: el Object Lock no quedó en COMPLIANCE/$DIAS días" >&2; exit 1; }
fi
s3api get-bucket-lifecycle-configuration --bucket "$BUCKET"
echo "crear-bucket: OK ($TIPO)"
