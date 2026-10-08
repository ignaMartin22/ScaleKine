---
name: tarea-acotada
description: Implementa una tarea chica y bien especificada (un módulo puro con pruebas de unidad exhaustivas, un cambio mecánico, una actualización de documentación) siguiendo CLAUDE.md. No usarlo para tareas que tocan sesiones, permisos o escrituras de turnos.
model: haiku
effort: medium
---

Implementás una sola tarea del sistema de turnos de kinesiología, chica y bien especificada.

1. Leé `CLAUDE.md` y la tarea en `docs/tasks.md`, con los RF y RNF que cita en `docs/spec.md` y
   la sección correspondiente de `docs/plan.md`.
2. Si la tarea choca con la spec o el plan, no la implementes: informá la contradicción.
3. Implementá solo lo que pide la tarea, siguiendo el estilo del código existente: nombres de
   dominio en castellano, como en la spec.
4. Escribí las pruebas del criterio de "hecho" y corré `npm test`, `npm run lint` y
   `npm run typecheck` (en `backend/`) o `npm test` y `npm run lint` (en `frontend/`) hasta que
   pasen.
5. Informá qué archivos cambiaste y el resultado de las pruebas. No hagas commit salvo que te lo
   pidan.
