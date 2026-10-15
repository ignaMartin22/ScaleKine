# Imagen `respaldo`: pg_dump | age | rclone (docs/despliegue.md §8.2). Contexto: la raíz del repo.
# Paquetes de Alpine: postgresql-client (licencia PostgreSQL), age (BSD-3), rclone (MIT), curl.
# El cliente de PostgreSQL debe ser de la versión mayor del servidor o superior (§8.2, §13).
FROM alpine:3.23.6
RUN apk add --no-cache postgresql18-client age rclone curl \
    && addgroup -S -g 10002 respaldo && adduser -S -u 10002 -G respaldo respaldo
COPY --chmod=0555 infra/respaldo/respaldo.sh /usr/local/bin/respaldo.sh
ENV HOME=/tmp
USER respaldo
ENTRYPOINT ["/usr/local/bin/respaldo.sh"]
