-- Restricciones que schema.prisma no puede expresar (plan.md §4.14). Escrita a mano: si una
-- migración generada después intenta borrarlas, hay que quitar ese paso de la migración.

-- Un kinesiólogo no tiene dos turnos activos en la misma franja (RF-24, RF-37).
CREATE UNIQUE INDEX "Turno_kinesiologo_franja_activa_key"
  ON "Turno" ("kinesiologoId", "fecha", "horaInicio")
  WHERE "estado" IN ('reservado', 'en_espera');

-- Un paciente no tiene dos turnos activos en la misma franja, con ningún kinesiólogo (RF-25, RF-37).
CREATE UNIQUE INDEX "Turno_paciente_franja_activa_key"
  ON "Turno" ("pacienteId", "fecha", "horaInicio")
  WHERE "estado" IN ('reservado', 'en_espera');

-- Los datos del consultorio son una fila única (RF-13).
ALTER TABLE "Consultorio" ADD CONSTRAINT "Consultorio_fila_unica" CHECK ("id" = 1);
