# Constitución del proyecto — Sistema de Turnos para Kinesiología

## 1. Propósito
Sistema web para gestionar la agenda de turnos de un consultorio de kinesiología. Reemplaza la coordinación manual (papel/planilla) entre la secretaría y los kinesiólogos, dando visibilidad en tiempo real de los próximos pacientes y de quién está en sala de espera.

Producto pensado para vender/instalar en una clínica real (single-tenant): un despliegue = un consultorio.

## 2. Principios rectores
1. **Simplicidad sobre completitud.** El MVP resuelve un flujo: asignar → marcar en espera → marcar asistido, con las salidas de inasistencia, anulación y reprogramación. Nada de features especulativas.
2. **Tiempo real donde importa.** El cambio de estado a "en espera" debe reflejarse en la pantalla del kinesiólogo sin que tenga que refrescar.
3. **Datos mínimos necesarios.** Se guarda lo que el flujo requiere: datos fijos del paciente (DNI, nombre y apellido, teléfono, obra social), turnos con sus coseguros informativos y su historial. No se maneja ficha clínica ni cobros.
4. **Roles separados y auditables.** Administrador, secretaría y kinesiólogo son roles distintos, cada persona con su propia cuenta. El administrador tiene control total, la secretaría registra pacientes y turnos, el kinesiólogo solo lee. Toda alta y todo cambio de un turno quedan asociados a quién los hizo.
5. **Preparado para vender, no para escalar infinito.** Se prioriza que funcione bien para un consultorio (single-tenant) antes que arquitectura multi-tenant.

## 3. Alcance del MVP
**Incluye:**
- Turnos con estados `reservado` → `en_espera` → `asistio`, más `no_asistio` y `anulado`, todos
  marcados por la secretaría, con corrección y reprogramación
- Grilla fija de turnos de 45 minutos en dos bloques (mañana y tarde), de lunes a viernes
- Ticket descargable con QR y datos del consultorio para cada turno asignado
- Múltiples kinesiólogos, cada uno en un bloque, con turnos en paralelo
- Login con roles: administrador (control total), secretaría (agenda) y kinesiólogo (solo lectura), con
  contraseña temporal y cambio obligatorio en el primer ingreso
- Sección de pacientes con búsqueda y ficha: datos, recuperables por DNI, próximos turnos e historial
- Actualización en tiempo real de la agenda para ambos roles

**Fuera de alcance:** la lista vigente y única está en [`spec.md`](./spec.md) (sección 4, "Fuera de
alcance"). Este documento no la duplica, para evitar que las dos se desincronicen.

## 4. Stack técnico
- **Frontend:** Angular
- **Backend:** Node.js + Express
- **Base de datos:** PostgreSQL (vía Prisma ORM)
- **Tiempo real:** Socket.io (WebSockets)

### Justificación del cambio de BD (Mongo → PostgreSQL)
El dominio es fuertemente relacional (turno ↔ paciente ↔ kinesiólogo ↔ estado, con consultas por fecha y estado). Un modelo relacional con constraints da integridad "gratis" (ej. impedir dos turnos activos del mismo kinesiólogo o del mismo paciente en la misma franja), y las consultas típicas de agenda son más naturales en SQL.

## 5. Actores del sistema
- **Administrador:** control total. Todo lo que hace la secretaría, más crear, restablecer y
  desactivar cuentas, y dar de alta kinesiólogos y definir su bloque.
- **Secretaría:** crea y edita pacientes; asigna, reprograma, anula y cambia el
  estado de los turnos; consulta historiales.
- **Kinesiólogo:** consulta únicamente su propia agenda en tiempo real (próximos pacientes y en
  espera), con los datos de los pacientes de sus turnos. Solo lectura.
- **Paciente:** no es usuario del sistema en el MVP (no tiene login ni acceso).

## 6. No negociables
- Toda alta y todo cambio de un turno deben quedar registrados (quién, cuándo).
- El kinesiólogo nunca debe tener que refrescar manualmente para ver un paciente en espera.
- No se borra un turno: un error de carga se resuelve anulando o corrigiendo.
- No se avanza sobre lo marcado como "fuera de alcance" sin volver a este documento.
