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

_La guía completa se termina en T-40._

### Requisitos

- Node.js 24 LTS (versión fijada en `.nvmrc`; con nvm: `nvm use`).
- Docker con el plugin Compose.

### Base de datos de desarrollo

1. Copiar `.env.example` a `.env` y cambiar las contraseñas. `.env` no se versiona.
2. Levantar PostgreSQL:

   ```sh
   docker compose up -d
   docker compose ps        # el servicio postgres debe figurar como "healthy"
   ```

   Se crean dos bases en el mismo servidor: `scalekine_desarrollo` y `scalekine_pruebas` (para las
   pruebas de integración). El puerto solo escucha en `127.0.0.1` (por defecto, 5432; se cambia con
   `POSTGRES_PORT`). También se crean los mismos tres usuarios que en producción
   (`docs/despliegue.md` §7):

   | Usuario | Para qué |
   |---|---|
   | `scalekine_migraciones` | Dueño del esquema; solo lo usan las migraciones |
   | `scalekine_app` | El backend: lee, inserta y actualiza; no altera el esquema ni borra turnos |
   | `scalekine_respaldo` | Solo lectura, para las copias |

   Si la base se creó antes de agregar un script en `infra/postgres/init/`, hay que recrearla con
   `docker compose down -v` (se pierden los datos de desarrollo).

3. Aplicar las migraciones (desde `backend/`, con `npm install` hecho):

   ```sh
   npm run db:migrar                        # aplica las migraciones pendientes
   npm run db:nueva-migracion -- --name x   # genera una migración nueva sin aplicarla
   ```

   Los índices únicos parciales y los permisos viven en migraciones SQL escritas a mano. Al generar
   una migración nueva, revisar que no los borre.

4. Para entrar a la base: `docker compose exec postgres psql -U scalekine scalekine_desarrollo`.
5. Para apagarla: `docker compose down`. Para borrar también los datos y volver a ejecutar los
   scripts de `infra/postgres/init/`: `docker compose down -v`.

Nunca se cargan datos reales de pacientes en desarrollo ni en pruebas.

### Backend

```sh
cd backend
npm install
npm run dev                # servidor con recarga, lee ../.env
npm test                   # todas las pruebas (Vitest)
npm run test:unidad        # sin base de datos
npm run test:integracion   # contra scalekine_pruebas (requiere la base levantada)
npm run lint               # ESLint
npm run typecheck          # chequeo de tipos
npm run build              # compila a dist/
```

El backend no arranca si falta `ZONA_HORARIA` o, en producción, `CLAVE_CIFRADO`. `GET /api/salud`
responde `ok`.

#### Comandos de instalación y operación

La CLI de `backend/src/cli/` usa la misma configuración, la misma conexión (`scalekine_app`) y el
mismo reloj que el backend, y no arranca el servidor. En desarrollo lee `../.env`:

```sh
cd backend
npm run cli -- instalar --nombre "Consultorio" --direccion "Calle 123" --telefono "11 5555 0000" [--usuario administrador]
npm run cli -- restablecer-admin [--usuario <nombre>]
npm run cli -- restablecer-2fa-admin [--usuario <nombre>]
npm run cli -- revocar-sesiones
```

En producción se ejecuta el código compilado dentro del contenedor `api`, que ya tiene las variables
de entorno: `docker compose exec api node dist/cli/index.js <subcomando> [opciones]`.

- `instalar`: crea el administrador (activo y marcado para cambio de contraseña, RF-05) y el
  consultorio (RF-13). La contraseña temporal se genera al azar y se muestra **una sola vez** por la
  salida estándar: no se guarda ni se registra. Si ya hay un administrador o un consultorio, se
  niega sin modificar nada.
- `restablecer-admin`: genera una nueva contraseña temporal (también una sola vez), marca la cuenta
  para cambio, levanta el bloqueo por intentos y cierra todas las sesiones del administrador.
- `restablecer-2fa-admin`: desactiva el segundo factor del administrador y cierra sus sesiones,
  para que lo vuelva a activar en su próximo ingreso.
- `revocar-sesiones`: revoca las sesiones de todas las cuentas; es el primer paso ante un incidente
  (`docs/despliegue.md` §12).

### Frontend

```sh
cd frontend
npm install
npm start                  # http://localhost:4200, con /api y /socket.io redirigidos al backend
npm test                   # pruebas unitarias (Vitest)
npm run build              # build de producción en dist/
npm run verificar-csp      # sirve el build con la CSP de producción y busca violaciones
```

El build de producción no puede tener scripts en línea, porque la CSP de producción
(`docs/despliegue.md` §6.2) los bloquea. Por eso `angular.json` desactiva la incrustación de CSS
crítico (`inlineCritical: false`). `verificar-csp` usa el Chrome o Edge instalado (variable
`NAVEGADOR`).

### Primer arranque previsto

1. `docker compose up -d` — levanta PostgreSQL.
2. Migraciones de Prisma en `backend/`.
3. Comando de instalación (`npm run cli -- instalar`) — crea la cuenta de administrador (contraseña temporal, se muestra una sola vez) y los datos del consultorio.
4. Levantar backend y frontend, e ingresar como administrador para elegir la contraseña definitiva.

## Trabajo en paralelo

Las tareas se reparten en carriles, cada uno en su worktree, según el grafo de `docs/tasks.md`
("Trabajo en paralelo"). Para preparar un carril:

1. Crear su base de pruebas: `infra/postgres/crear-base-pruebas.sh <carril>`.
2. Copiar el `.env` de la raíz al worktree y apuntar `DATABASE_URL_PRUEBAS` y
   `DATABASE_URL_MIGRACIONES_PRUEBAS` a `scalekine_<carril>_pruebas`. Si el carril levanta
   servidores, cambiar también `PORT`.
3. Ejecutar `npm install` en `backend/` y `frontend/`.

En `.claude/agents/` hay dos agentes de proyecto: `revisor-seguridad` (Opus, solo lectura), que
revisa las tareas críticas antes de fusionarlas, y `tarea-acotada` (Haiku), para tareas chicas y
bien especificadas.

## Integración continua

En cada pull request, GitHub Actions (`.github/workflows/ci.yml`) ejecuta en backend y frontend:
auditoría de dependencias (`npm audit --audit-level=high`, que frena el pipeline ante
vulnerabilidades altas o críticas), lint, compilación y pruebas. El backend corre las pruebas de
integración contra un PostgreSQL de servicio con datos ficticios; el frontend verifica la CSP de
producción. Dependabot propone actualizaciones una vez por semana.

En el backend, `overrides` de `package.json` fuerza versiones corregidas de dos dependencias del
CLI de Prisma (`deepmerge-ts` y `mysql2`). Se pueden quitar cuando Prisma las actualice.

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
├── infra/              postgres/init: bases de desarrollo; (T-36) aprovisionamiento, respaldo y restauración
├── .github/            CI (GitHub Actions) y Dependabot
├── docker-compose.yml  PostgreSQL de desarrollo y de pruebas
├── .env.example        variables de entorno con valores ficticios
└── .nvmrc              versión de Node
```
