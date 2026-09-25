# Constitución del proyecto — Sistema de Turnos para Kinesiología

## 1. Propósito
Sistema web para gestionar la agenda de turnos de un consultorio de kinesiología. Reemplaza la coordinación manual (papel/planilla) entre recepción y los médicos, dando visibilidad en tiempo real de qué pacientes están en sala de espera.

Producto pensado para vender/instalar en una clínica real (single-tenant): un despliegue = un consultorio.

## 2. Principios rectores
1. **Simplicidad sobre completitud.** El MVP resuelve un flujo: reservar → marcar en espera → finalizar, con salidas de cancelación e inasistencia. Nada de features especulativas.
2. **Tiempo real donde importa.** El cambio de estado a "en espera" debe reflejarse en la pantalla del médico sin que tenga que refrescar.
3. **Datos mínimos necesarios.** Se guarda lo que el flujo requiere (paciente, turno, historial). No se maneja ficha clínica ni información médica sensible en el MVP.
4. **Roles separados y auditables.** Recepcionista y médico son roles distintos, cada uno con su propio login, y cada persona con su propia cuenta. Toda alta y toda transición de estado quedan asociadas a quién las hizo.
5. **Preparado para vender, no para escalar infinito.** Se prioriza que funcione bien para un consultorio (single-tenant) antes que arquitectura multi-tenant.

## 3. Alcance del MVP
**Incluye:**
- Gestión de turnos con estados: `reservado` → `en_espera` → `finalizado`, más `cancelado` y
  `no_asistio` como estados terminales alternativos desde `reservado`
- Agenda por médico, con franjas horarias de duración fija
- Múltiples médicos/kinesiólogos
- Login con roles: recepcionista, médico
- Ficha básica de paciente + historial de turnos anteriores
- Actualización en tiempo real de la agenda, para recepción y para el rol médico
- Recordatorio de turno al paciente por email

**Fuera de alcance:** la lista vigente y única está en [`spec.md`](./spec.md) (sección 4, "Fuera de
alcance"). Este documento no la duplica, para evitar que las dos se desincronicen.

## 4. Stack técnico
- **Frontend:** Angular
- **Backend:** Node.js + Express
- **Base de datos:** PostgreSQL (vía Prisma ORM)
- **Tiempo real:** Socket.io (WebSockets)
- **Notificaciones:** servicio externo de email (a definir en plan.md)

### Justificación del cambio de BD (Mongo → PostgreSQL)
El dominio es fuertemente relacional (turno ↔ paciente ↔ médico ↔ estado, con transiciones válidas y consultas por fecha/estado). Un modelo relacional con constraints da integridad "gratis" (ej. no permitir un turno finalizado sin haber pasado por en_espera) y las consultas típicas de agenda son más naturales en SQL.

## 5. Actores del sistema
- **Recepcionista:** crea y edita pacientes, médicos y turnos; cambia estado a `en_espera`,
  `finalizado` y `cancelado`; consulta historiales.
- **Médico/Kinesiólogo:** consulta su agenda en tiempo real, ve pacientes en espera, puede finalizar el turno.
- **Paciente:** no es usuario del sistema en el MVP (no tiene login ni acceso). Solo recibe recordatorios.

## 6. No negociables
- Toda alta y toda transición de estado de turno deben quedar registradas (quién, cuándo).
- El médico nunca debe tener que refrescar manualmente para ver un paciente en espera.
- No se borra un turno: un error de carga se resuelve cancelando y creando el correcto.
- No se avanza sobre lo marcado como "fuera de alcance" sin volver a este documento.