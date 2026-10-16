# Imagen `db` del perfil económico (docs/despliegue.md §3.1 y §8.1): PostgreSQL oficial + pgBackRest.
# pgBackRest 2.58.0 (licencia MIT) viene del repositorio `community` de Alpine 3.24, la misma base de
# la imagen oficial. La versión queda fijada: se actualiza junto con la etiqueta de postgres, en un PR.
# Contexto: la raíz del repo.
FROM postgres:18.6-alpine
RUN apk add --no-cache pgbackrest=2.58.0-r0
COPY --chmod=0555 infra/db/archivo-reciente.sh infra/db/iniciar-archivo.sh /usr/local/bin/
