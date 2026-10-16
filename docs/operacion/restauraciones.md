# Registro de pruebas de restauración

Registro de `docs/despliegue.md` §8.3 (RNF-07). **Solo fecha, copia usada, conteos y resultado.**
Nunca se anotan nombres, DNI, teléfonos, obras sociales ni ningún dato de pacientes, ni pegado de
salidas de herramientas que puedan contenerlos. Los conteos salen de `infra/verificar-restauracion.sh`,
que no imprime otra cosa.

Cómo se hace la prueba: [`restaurar.md`](./restaurar.md), parte A (copia diaria) y, en el perfil
económico, parte B (punto en el tiempo).

## Plantilla

Copiar el bloque, completarlo y agregarlo **arriba** de la lista de registros.

```
### AAAA-MM-DD · <copia diaria | punto en el tiempo>
- Quién: <iniciales de quien hizo la prueba>
- Copia usada: <nombre del archivo, p. ej. scalekine-2026-11-02T0330.dump.age>  /  <instante T elegido, en UTC>
- Pacientes: <n> · Turnos: <n> · Eventos: <n>
- Último evento: <AAAA-MM-DD HH:MM UTC> (hace <n> h)
- Migraciones pendientes aplicadas a la copia temporal: <n>
- Resultado: <OK | FALLA>
- Notas: <solo si falló: qué comprobación y qué se hizo (incidente de §12)>
```

Una prueba cuyo resultado es FALLA se trata como incidente (`despliegue.md` §12) y se repite hasta que
dé OK.

## Registros

### 2026-10-16 · punto en el tiempo (perfil económico) · **PRUEBA LOCAL, datos ficticios**
- Quién: Claude (T-37), contra un S3 compatible en un contenedor; no es una prueba de producción.
- Copia usada: copia base completa más registro de transacciones archivado, repositorio cifrado
  (`aes-256-cbc`) · instante T: 2026-10-16 04:17:37 UTC
- Registros ficticios anteriores a T que quedaron: 4 de 4 · posteriores a T que quedaron: 0 de 5
- Migraciones pendientes aplicadas a la copia temporal: no corresponde (restauración en el mismo servidor)
- Resultado: OK
- Notas: ejemplo del formato; se hizo con `infra/prueba/verificar-t37.sh pitr`.

### 2026-10-16 · copia diaria · **PRUEBA LOCAL, datos ficticios**
- Quién: Claude (T-37), contra un S3 compatible en un contenedor; no es una prueba de producción.
- Copia usada: `scalekine-2026-10-16T04xx.dump.age`, la única del bucket local, descifrada con una clave `age` de prueba
- Pacientes: 3 · Turnos: 3 · Eventos: 3
- Último evento: 2026-10-16 04:07 UTC (hace 0 h)
- Migraciones pendientes aplicadas a la copia temporal: 0 (6 ya aplicadas)
- Resultado: OK
- Notas: ejemplo del formato; se hizo con `infra/prueba/verificar-t37.sh copia`. La primera prueba real se anota
  arriba cuando exista la cuenta de B2 (T-36/T-40).
