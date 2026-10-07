# CLAUDE.md

Sistema de turnos para un consultorio de kinesiología, desarrollado con SDD (Spec-Driven
Development). Este archivo guía el trabajo de implementación.

## Fuentes de verdad

En orden de precedencia:

1. `docs/constitucion.md`: principios y no negociables.
2. `docs/spec.md`: qué se construye (RF-01 … RF-47 y RNF-01 … RNF-13), fuera de alcance (§4) y
   criterios (§7).
3. `docs/plan.md`: cómo se construye (módulos, modelo, decisiones, estructura del repo).
4. `docs/despliegue.md`: dónde corre, cómo se protege y cómo se opera en producción.
5. `docs/tasks.md`: qué tarea sigue y cuándo está hecha.

## Reglas de trabajo

- **Nada sin requisito.** Toda funcionalidad y toda prueba apuntan a un RF o RNF. Si algo no tiene
  requisito, no se implementa; si hace falta, primero se agrega a la spec.
- **Contradicción → spec primero.** Si una tarea choca con la spec o el plan, se frena, se corrige
  el documento y recién después el código.
- **Fuera de alcance es fuera de alcance.** No implementar nada de `spec.md` §4.
- **Una tarea por vez**, en el orden de `tasks.md`, con su criterio de "hecho" cumplido.
- Documentos, mensajes de la interfaz, nombres de dominio y commits en castellano. Los nombres de
  dominio en código siguen los de la spec (`reservado`, `en_espera`, `asistio`, `no_asistio`,
  `anulado`; roles `administrador`, `secretaria`, `kinesiologo`).

## Invariantes que el código no puede romper

- Solo `m3-turnos` escribe turnos, y cada escritura registra su `TurnoEvento` en la misma
  transacción.
- La tabla de transiciones existe en un solo lugar del backend; el frontend recibe las acciones
  disponibles desde la API.
- El rol sale de la sesión, nunca de la petición. El kinesiólogo no escribe nada y solo lee sus
  propios turnos.
- No hay borrado de turnos ni de cuentas.
- El sistema nunca cambia el estado de un turno por su cuenta.
- Toda lógica que depende de la hora usa el reloj inyectable y la zona horaria configurada.
- Las pruebas de integración corren contra PostgreSQL real, nunca contra un doble.

## Seguridad (datos sensibles de salud)

- Nunca registrar en logs DNI, nombres, teléfonos, obra social, coseguros, contraseñas ni tokens.
  Todo log pasa por el logger con redacción.
- Toda entrada a la API se valida con `zod`; ningún error devuelve trazas al cliente.
- No agregar servicios externos que reciban datos personales fuera de Argentina o de un país adecuado
  (`despliegue.md` §1). Ante la duda, no se agrega.
- Nunca usar datos reales de pacientes en desarrollo, pruebas, CI, issues ni commits.
- Ningún secreto en el repositorio: solo `.env.example` con valores ficticios.
- La aplicación se conecta a la base con `scalekine_app`, que no tiene permisos de estructura ni de
  borrado; no "arreglar" un error de permisos ampliándolos.
