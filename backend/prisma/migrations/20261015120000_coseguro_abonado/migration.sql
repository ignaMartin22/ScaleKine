-- Coseguro abonado (RF-27, RF-48): un solo monto reemplaza a los dos coseguros anteriores.
-- No hay datos de producción: los montos previos se descartan.
ALTER TABLE "Turno" DROP COLUMN "coseguroObraSocial",
DROP COLUMN "coseguroAdicional",
ADD COLUMN "coseguroAbonado" DECIMAL(12,2);

-- Auditoría del abono (RF-27, RF-46): el tipo de evento pasa a llamarse modificacion_abono.
ALTER TYPE "TipoEvento" RENAME VALUE 'modificacion_coseguros' TO 'modificacion_abono';
