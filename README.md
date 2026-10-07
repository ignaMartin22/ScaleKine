# Sistema de Turnos — Kinesiología

Sistema web para gestionar la agenda de turnos de un consultorio de kinesiología. La secretaría asigna, reprograma y marca los turnos; los kinesiólogos monitorean su agenda en tiempo real para saber quién sigue y quién está esperando.

Proyecto single-tenant (un despliegue = un consultorio), pensado para vender a una clínica.

## Estado del proyecto

Desarrollado con metodología **SDD (Spec-Driven Development)**. Documentos del proceso, en orden:

1. [`docs/constitucion.md`](./docs/constitucion.md) — principios rectores, alcance del MVP, stack y no-negociables.
2. [`docs/spec.md`](./docs/spec.md) — qué se construye y por qué: requisitos EARS numerados, fuera de alcance y criterios de finalización.
3. [`docs/plan.md`](./docs/plan.md) — plan técnico: módulos, modelo de datos, decisiones y tests.
4. [`docs/tasks.md`](./docs/tasks.md) — desglose en tareas, por fases, con los RF y RNF que cubre cada una.
5. [`docs/despliegue.md`](./docs/despliegue.md) — producción: infraestructura, seguridad, copias, monitoreo y operación.

Las reglas de trabajo para implementar están en [`CLAUDE.md`](./CLAUDE.md).

## Stack técnico

- **Frontend:** Angular
- **Backend:** Node.js + Express
- **Base de datos:** PostgreSQL (Prisma ORM)
- **Tiempo real:** Socket.io
- **Producción:** DigitalOcean (Frankfurt, UE) con Docker Compose, Caddy y PostgreSQL administrado

## Seguridad

El sistema maneja datos de salud, que la Ley 25.326 considera sensibles. Por eso:

- Se sirve solo por HTTPS.
- El administrador ingresa con segundo factor.
- Hay límite de intentos de login y contraseñas de 12 caracteres como mínimo.
- Las sesiones vencen a las 12 horas.
- Los datos se alojan solo en la UE, cifrados, con copias externas cifradas y probadas cada mes.
- Los logs no contienen datos personales.

Requisitos en `docs/spec.md` §3.9 (RNF-01 … RNF-13); implementación y operación en `docs/despliegue.md`.

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

_Se completa en T-40._ Requisitos previstos: Node.js LTS, Docker (para PostgreSQL) y las variables de entorno de `docs/plan.md` §5.2 (`.env.example`).

Primer arranque previsto:

1. `docker compose up -d` — levanta PostgreSQL.
2. Migraciones de Prisma en `backend/`.
3. Comando de instalación — crea la cuenta de administrador (contraseña temporal, se muestra una sola vez) y los datos del consultorio.
4. Levantar backend y frontend, e ingresar como administrador para elegir la contraseña definitiva.

## Estructura del repo

```
/
├── docs/
│   ├── constitucion.md
│   ├── spec.md
│   ├── plan.md
│   ├── tasks.md
│   └── despliegue.md
├── CLAUDE.md
├── README.md
├── backend/            (T-02) Express + Prisma + Socket.io
├── frontend/           (T-05) Angular
├── e2e/                (T-33) Playwright
├── infra/              (T-36) aprovisionamiento, respaldo y verificación de restauración
└── docker-compose.yml  (T-01) PostgreSQL
```
