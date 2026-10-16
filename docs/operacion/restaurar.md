# Cómo restaurar

Procedimientos de `docs/despliegue.md` §8 (RNF-06, RNF-07). Los ensaya el administrador en la prueba
mensual (§8.3) y se anotan en [`restauraciones.md`](./restauraciones.md). Quien restaura necesita, del
gestor de contraseñas (§9): la clave privada de `age`, una clave de B2 **de lectura** del administrador
(distinta de la del servidor, que solo escribe) y, en el perfil económico, la `PGBACKREST_REPO1_CIPHER_PASS`.

> **Datos personales.** Toda restauración trabaja con datos reales de pacientes. Se hace en una máquina de
> confianza, con el disco cifrado, y los archivos descargados se borran al terminar. Nunca se pegan
> salidas con datos en el registro, en issues ni en chats.

Los comandos de `docker compose` se ejecutan en `/opt/scalekine` del servidor, salvo donde se indica.

## A. Copia diaria (`pg_dump` + `age`): prueba mensual y recuperación ante desastre

Sirve en los dos perfiles. Es la que cubre la pérdida de la cuenta o de la región de DigitalOcean (§8.4).

### A.1 Prueba mensual (primer lunes de cada mes, §8.3)

En la máquina de trabajo del administrador, con Docker y el repositorio en la versión desplegada.

1. **Descargar la copia más reciente.** Con un remoto de `rclone` configurado con la clave de lectura:
   ```sh
   rclone lsf b2:scalekine-copias | sort | tail -n 3        # nombres: scalekine-AAAA-MM-DDTHHMM.dump.age
   rclone copyto b2:scalekine-copias/<archivo> ./copia.dump.age
   ```
2. **Descifrar** con la clave privada (guardada en el gestor; no la dejes en disco más de lo necesario):
   ```sh
   age -d -i clave-privada-age.txt -o copia.dump copia.dump.age
   ```
3. **Verificar.** El script levanta un PostgreSQL temporal en Docker (sin puertos publicados), restaura la
   copia, aplica a esa copia las migraciones pendientes del código desplegado, cuenta y comprueba la
   fecha del último evento:
   ```sh
   docker build -f infra/api/Dockerfile --target migraciones -t scalekine-migraciones:local .   # una vez
   infra/verificar-restauracion.sh copia.dump
   ```
   La salida es solo conteos, fechas y `RESULTADO: OK` o `RESULTADO: FALLA`. Si da FALLA es un incidente
   (§12): no se descarta hasta entender la causa.
4. **Destruir lo temporal.** El script ya borra el contenedor y la red. Borrar los archivos descargados:
   ```sh
   shred -u copia.dump copia.dump.age 2>/dev/null || rm -f copia.dump copia.dump.age
   ```
5. **Anotar** fecha, copia usada, conteos y resultado en `restauraciones.md` (sin datos personales).

### A.2 Recuperación real (desastre o corrupción)

1. Detener la aplicación para que nadie escriba: `docker compose stop api web`.
2. Preparar la base destino **vacía**: perfil administrado, un clúster nuevo con los tres usuarios de §7;
   perfil económico, `docker compose up -d db` con un volumen nuevo (crea los usuarios).
3. Descargar y descifrar la copia como en A.1 (pasos 1 y 2).
4. Restaurar con el dueño del esquema, sin `--clean`:
   ```sh
   pg_restore --no-owner -d "$DATABASE_URL_MIGRACIONES" copia.dump
   ```
   Las tablas quedan a nombre de `scalekine_migraciones` (el que conecta) y los permisos de §7 vuelven
   con la copia, porque los tres usuarios ya existen en la base destino.
5. Aplicar las migraciones que falten, si el código desplegado es más nuevo que la copia:
   `docker compose run --rm migraciones`. Comprobar con la prueba de permisos de §7 que `scalekine_app` no
   puede borrar turnos.
6. Levantar: `docker compose up -d`. Comprobar `/api/salud` e ingresar con el administrador.
7. Borrar los archivos descargados y anotar la recuperación como incidente (§12).

La pérdida máxima de esta vía es la de la copia: hasta 24 horas.

## B. Perfil económico: restaurar a un punto en el tiempo (pgBackRest)

Cubre errores humanos y corrupción de los últimos 7 días (RNF-07) con pérdida de minutos.
Necesita el bucket del registro de transacciones y la `PGBACKREST_REPO1_CIPHER_PASS` en `.env.db`.

### B.1 Antes de empezar

- Elegir el instante `T` **en UTC**, con el formato `AAAA-MM-DD HH:MM:SS+00` (la hora argentina es UTC−3).
  La restauración deja la base como estaba en `T`: todo lo posterior se pierde.
- Ver qué hay disponible: `docker compose exec -u postgres db pgbackrest info`. Debe decir
  `cipher: aes-256-cbc` y mostrar el rango de registro de transacciones (`wal archive min/max`); `T` debe
  caer dentro de él y ser posterior a la fecha de la copia base más vieja.
- Si la base todavía responde, tomar antes una copia lógica del estado actual por si hubo que elegir otro
  `T`: `docker compose run --rm respaldo`.

### B.2 Restaurar

```sh
docker compose stop api web db
docker compose run --rm --no-deps --entrypoint "" -u postgres db \
  pgbackrest --delta --type=time "--target=AAAA-MM-DD HH:MM:SS+00" --target-action=promote restore
docker compose up -d --wait db
```

`--delta` reemplaza el contenido del directorio de datos; `--target-action=promote` deja la base
disponible al llegar a `T`. Al arrancar, PostgreSQL recorre el registro hasta `T` y abre una línea de
tiempo nueva.

### B.3 Comprobar y volver a poner en marcha

1. `docker compose exec -T db psql -U scalekine -d scalekine -c 'SELECT count(*) FROM "TurnoEvento"'`
   y revisar con el administrador del consultorio que los últimos turnos coinciden con lo esperado.
2. `docker compose run --rm migraciones` (por si el código desplegado es más nuevo que `T`).
3. `docker compose up -d` (levanta `api` y `web`).
4. **Tomar una copia base nueva** de la línea de tiempo nueva:
   `docker compose exec -T -u postgres db pgbackrest --type=full backup`.
5. Confirmar que el archivo continuo sigue: `docker compose exec -T -u postgres db archivo-reciente.sh`
   debe terminar con `OK`.
6. Anotar la restauración en `restauraciones.md` (instante `T`, conteos, resultado) y, si no fue una
   prueba, como incidente (§12).

### B.4 Servidor nuevo (perfil económico, §8.4)

En un servidor limpio, con el `.env.db` original (mismo bucket y misma clave de cifrado) y el directorio de
datos vacío y de propiedad del usuario 70 (`postgres` de la imagen):

```sh
docker compose run --rm --no-deps --entrypoint "" -u postgres db pgbackrest --type=time "--target=<T>" --target-action=promote restore
# o, para el último momento disponible, sin --type ni --target
docker compose up -d --wait db
```

Después, igual que en B.3.

## C. Perfil administrado: restaurar a un punto en el tiempo

Lo provee DigitalOcean (§8.1): en el panel, restaurar el clúster a un momento de los últimos 7 días **a un
clúster nuevo**, actualizar `DATABASE_URL`, `DATABASE_URL_MIGRACIONES` y `DATABASE_URL_RESPALDO` y
redesplegar. Se anota igual en `restauraciones.md`.
