-- La auditoría es de solo agregado (RF-46, RNF-09): la aplicación inserta y lee eventos, pero no
-- los modifica. Se revoca el UPDATE que otorgó la migración "permisos"; DELETE nunca se otorgó.
-- Esta migración corre como scalekine_migraciones, dueño del esquema.

REVOKE UPDATE ON "TurnoEvento" FROM scalekine_app;
