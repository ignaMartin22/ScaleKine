# Sistema de Turnos — Kinesiología

Sistema web para gestionar la agenda de turnos de un consultorio de kinesiología. Permite a recepción reservar turnos y marcarlos como "en espera" cuando el paciente llega, y a los médicos ver su agenda en tiempo real para saber quién está esperando.

Proyecto single-tenant (un despliegue = un consultorio), pensado para vender a una clínica.

## Estado del proyecto

Desarrollado con metodología **SDD (Spec-Driven Development)**. Documentos del proceso, en orden:

1. [`docs/constitucion.md`](./docs/constitucion.md) — principios rectores, alcance del MVP, stack y no-negociables.
2. [`docs/especificacion.md`](./docs/especificacion.md) — qué se construye y por qué, actores, entidades, flujo y criterios de aceptación.
3. `docs/plan.md` — plan técnico (pendiente).
4. `docs/tasks.md` — desglose en tareas (pendiente).

## Stack técnico

- **Frontend:** Angular
- **Backend:** Node.js + Express
- **Base de datos:** PostgreSQL (Prisma ORM)
- **Tiempo real:** Socket.io
- **Notificaciones:** email/SMS (proveedor a definir en `plan.md`)

## Flujo principal

```
reservado → en_espera → finalizado
```

- **Recepcionista:** crea el turno, lo pasa a `en_espera` cuando el paciente llega.
- **Médico:** ve su agenda en tiempo real, marca el turno como `finalizado` al terminar la consulta (la recepcionista también puede hacerlo).

Ver `docs/especificacion.md` para el detalle de reglas de negocio y criterios de aceptación.

## Alcance del MVP

Incluye login con roles (recepcionista, médico), múltiples médicos, ficha básica de paciente con historial de turnos, agenda en tiempo real y recordatorio de turno.

No incluye (por ahora): cancelación de turnos, portal de autogestión para pacientes, ficha clínica, multi-tenant, facturación. Detalle completo en `docs/constitucion.md`.

## Setup

_Pendiente — se completa una vez definido `plan.md` con la estructura del repo, variables de entorno y comandos de instalación/ejecución._

## Estructura del repo

```
/
├── docs/
│   ├── constitucion.md
│   ├── especificacion.md
│   ├── plan.md      (pendiente)
│   └── tasks.md     (pendiente)
├── README.md
├── backend/         (pendiente)
└── frontend/        (pendiente)
```