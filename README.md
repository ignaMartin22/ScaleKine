# Sistema de Turnos — Kinesiología

Sistema web para gestionar la agenda de turnos de un consultorio de kinesiología. La secretaría asigna, reprograma y marca los turnos; los kinesiólogos monitorean su agenda en tiempo real para saber quién sigue y quién está esperando.

Proyecto single-tenant (un despliegue = un consultorio), pensado para vender a una clínica.

## Estado del proyecto

Desarrollado con metodología **SDD (Spec-Driven Development)**. Documentos del proceso, en orden:

1. [`docs/constitucion.md`](./docs/constitucion.md) — principios rectores, alcance del MVP, stack y no-negociables.
2. [`docs/spec.md`](./docs/spec.md) — qué se construye y por qué: requisitos EARS numerados, fuera de alcance y criterios de finalización.
3. [`docs/plan.md`](./docs/plan.md) — plan técnico: módulos, modelo de datos, decisiones y tests.
4. `docs/tasks.md` — desglose en tareas (pendiente).

## Stack técnico

- **Frontend:** Angular
- **Backend:** Node.js + Express
- **Base de datos:** PostgreSQL (Prisma ORM)
- **Tiempo real:** Socket.io

## Turnos

Turnos de 45 minutos sobre una grilla fija:

| Bloque | Franjas |
|---|---|
| Mañana | 08:00 · 08:45 · 09:30 · 10:15 · 11:00 · 11:45 |
| Tarde | 16:00 · 16:45 · 17:30 · 18:15 |

Se atiende de lunes a viernes. Cada kinesiólogo atiende en un bloque; a la mañana hay dos en paralelo. Cada turno asignado genera un ticket PDF descargable con QR y los datos del consultorio (nombre, dirección y teléfono, editables por la secretaría).

## Flujo principal

```
reservado → en_espera → asistio
reservado → no_asistio
reservado → anulado
reservado → (reprogramar: mismo turno, otra fecha/franja)
```

- **Administrador:** control total: todo lo de la secretaría, más crear cuentas (con contraseña temporal), restablecerlas y desactivarlas, y dar de alta a los kinesiólogos.
- **Secretaría:** asigna el turno eligiendo fecha, bloque (mañana/tarde) y kinesiólogo de ese bloque (con el DNI recupera al paciente), lo marca en espera cuando llega y asistido cuando termina, marca inasistencias y anula o reprograma. Puede corregir cualquier estado. Todo queda registrado.
- **Kinesiólogo:** solo lectura. Ve sus próximos pacientes y los que están en espera, en tiempo real, con los datos de cada paciente. Solo ve su propia agenda y sus turnos asignados.

Ver `docs/spec.md` para los requisitos EARS numerados, las reglas de negocio y los criterios de finalización.

## Alcance del MVP

Incluye login con roles (administrador, secretaría, kinesiólogo) con cambio de contraseña obligatorio en el primer ingreso, múltiples kinesiólogos, sección Pacientes con búsqueda y ficha (DNI, nombre y apellido, teléfono, obra social) con próximos turnos e historial, coseguros por turno, agenda en tiempo real, ticket con QR, reprogramación, corrección de estados y aviso de turnos sin marcar.

No incluye (por ahora): recordatorios al paciente, cobros o facturación, portal de autogestión para pacientes, ficha clínica, multi-tenant. La lista completa de "fuera de alcance" está en `docs/spec.md`.

## Setup

_Pendiente — se completa una vez desglosado `tasks.md`, con la estructura del repo, variables de entorno y comandos de instalación/ejecución._

## Estructura del repo

```
/
├── docs/
│   ├── constitucion.md
│   ├── spec.md
│   ├── plan.md
│   └── tasks.md     (pendiente)
├── README.md
├── backend/         (pendiente)
└── frontend/        (pendiente)
```
