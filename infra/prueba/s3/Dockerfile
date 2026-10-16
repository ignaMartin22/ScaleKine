# SOLO PRUEBAS LOCALES (T-37): S3 compatible con Object Lock para ensayar copias y archivo continuo sin
# cuentas reales. MinIO viene del repositorio community de Alpine. Nunca forma parte del stack de
# producción. Las herramientas `mc` y `aws` sirven para los scripts de prueba y para crear-bucket.sh.
# Contexto: infra/prueba/s3/
FROM alpine:3.23.6
RUN apk add --no-cache minio minio-client aws-cli openssl bash curl
COPY --chmod=0555 entrada.sh /usr/local/bin/entrada.sh
ENTRYPOINT ["/usr/local/bin/entrada.sh"]
