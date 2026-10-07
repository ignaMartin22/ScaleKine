# CLAUDE.md

Sistema de turnos para un consultorio de kinesiología, desarrollado con SDD (Spec-Driven
Development). Este archivo guía el trabajo de implementación.

## Fuentes de verdad

En orden de precedencia:

1. `docs/constitucion.md`: principios y no negociables.
2. `docs/spec.md`: qué se construye (RF-01 … RF-47), fuera de alcance (§4) y criterios (§7).
3. `docs/plan.md`: cómo se construye (módulos, modelo, decisiones, estructura del repo).
4. `docs/tasks.md`: qué tarea sigue y cuándo está hecha.

## Reglas de trabajo

- **Nada sin RF.** Toda funcionalidad y toda prueba apuntan a un RF. Si algo no tiene RF, no se
  implementa; si hace falta, primero se agrega a la spec.
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
