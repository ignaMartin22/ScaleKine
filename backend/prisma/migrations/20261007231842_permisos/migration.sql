-- Permisos de mínimo privilegio (despliegue.md §7, RNF-09). Los roles los crea quien administra
-- la base: en desarrollo, infra/postgres/init/02-usuarios.sh; en producción, el aprovisionamiento.
-- Esta migración corre como scalekine_migraciones, dueño del esquema.

GRANT USAGE ON SCHEMA public TO scalekine_app, scalekine_respaldo;

-- Aplicación: lee, inserta y actualiza. No borra turnos, eventos, usuarios ni pacientes
-- (RF-39, RF-09): solo sesiones y el límite de intentos, que son datos efímeros.
GRANT SELECT, INSERT, UPDATE ON
  "Usuario", "Sesion", "Consultorio", "Kinesiologo", "Paciente", "Turno", "TurnoEvento",
  "limite_intentos"
  TO scalekine_app;
GRANT DELETE ON "Sesion", "limite_intentos" TO scalekine_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO scalekine_app;

-- Respaldo: solo lectura de todo, incluido el historial de migraciones, para que la copia se
-- pueda restaurar y verificar (despliegue.md §8).
GRANT SELECT ON ALL TABLES IN SCHEMA public TO scalekine_respaldo;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO scalekine_respaldo;

-- Tablas que creen las migraciones futuras: mismos permisos, sin DELETE. Si una tabla nueva
-- necesita otros, su migración los ajusta explícitamente.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO scalekine_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO scalekine_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO scalekine_respaldo;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON SEQUENCES TO scalekine_respaldo;
