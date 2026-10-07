-- CreateEnum
CREATE TYPE "Rol" AS ENUM ('administrador', 'secretaria', 'kinesiologo');

-- CreateEnum
CREATE TYPE "Bloque" AS ENUM ('manana', 'tarde');

-- CreateEnum
CREATE TYPE "EstadoTurno" AS ENUM ('reservado', 'en_espera', 'asistio', 'no_asistio', 'anulado');

-- CreateEnum
CREATE TYPE "TipoEvento" AS ENUM ('asignacion', 'cambio_estado', 'correccion', 'reprogramacion');

-- CreateTable
CREATE TABLE "Usuario" (
    "id" SERIAL NOT NULL,
    "nombreUsuario" VARCHAR(64) NOT NULL,
    "hashContrasena" TEXT NOT NULL,
    "rol" "Rol" NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "debeCambiarContrasena" BOOLEAN NOT NULL DEFAULT true,
    "ingresosFallidos" INTEGER NOT NULL DEFAULT 0,
    "bloqueadoHasta" TIMESTAMPTZ(3),
    "bloqueosConsecutivos" INTEGER NOT NULL DEFAULT 0,
    "secretoTotpCifrado" TEXT,
    "totpActivo" BOOLEAN NOT NULL DEFAULT false,
    "codigosRecuperacion" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "creadoEn" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sesion" (
    "id" SERIAL NOT NULL,
    "hashToken" TEXT NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "creadaEn" TIMESTAMPTZ(3) NOT NULL,
    "venceEn" TIMESTAMPTZ(3) NOT NULL,
    "revocadaEn" TIMESTAMPTZ(3),
    "segundoFactorVerificado" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Sesion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Consultorio" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "nombre" TEXT NOT NULL,
    "direccion" TEXT NOT NULL,
    "telefono" TEXT NOT NULL,

    CONSTRAINT "Consultorio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Kinesiologo" (
    "id" SERIAL NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "nombre" TEXT NOT NULL,
    "bloque" "Bloque" NOT NULL,

    CONSTRAINT "Kinesiologo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Paciente" (
    "id" SERIAL NOT NULL,
    "dni" VARCHAR(10) NOT NULL,
    "nombre" TEXT NOT NULL,
    "telefono" TEXT NOT NULL,
    "obraSocial" TEXT NOT NULL,

    CONSTRAINT "Paciente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Turno" (
    "id" SERIAL NOT NULL,
    "pacienteId" INTEGER NOT NULL,
    "kinesiologoId" INTEGER NOT NULL,
    "fecha" DATE NOT NULL,
    "horaInicio" VARCHAR(5) NOT NULL,
    "estado" "EstadoTurno" NOT NULL DEFAULT 'reservado',
    "llegadaEn" TIMESTAMPTZ(3),
    "coseguroObraSocial" DECIMAL(12,2),
    "coseguroAdicional" DECIMAL(12,2),
    "creadoPorId" INTEGER NOT NULL,
    "creadoEn" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Turno_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TurnoEvento" (
    "id" SERIAL NOT NULL,
    "turnoId" INTEGER NOT NULL,
    "tipo" "TipoEvento" NOT NULL,
    "estadoAnterior" "EstadoTurno",
    "estadoNuevo" "EstadoTurno",
    "autorId" INTEGER NOT NULL,
    "ocurridoEn" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TurnoEvento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "limite_intentos" (
    "key" VARCHAR(255) NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,
    "expire" BIGINT,

    CONSTRAINT "limite_intentos_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_nombreUsuario_key" ON "Usuario"("nombreUsuario");

-- CreateIndex
CREATE UNIQUE INDEX "Sesion_hashToken_key" ON "Sesion"("hashToken");

-- CreateIndex
CREATE INDEX "Sesion_usuarioId_idx" ON "Sesion"("usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "Kinesiologo_usuarioId_key" ON "Kinesiologo"("usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "Paciente_dni_key" ON "Paciente"("dni");

-- CreateIndex
CREATE INDEX "Turno_fecha_idx" ON "Turno"("fecha");

-- CreateIndex
CREATE INDEX "Turno_pacienteId_idx" ON "Turno"("pacienteId");

-- CreateIndex
CREATE INDEX "TurnoEvento_turnoId_idx" ON "TurnoEvento"("turnoId");

-- AddForeignKey
ALTER TABLE "Sesion" ADD CONSTRAINT "Sesion_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Kinesiologo" ADD CONSTRAINT "Kinesiologo_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Turno" ADD CONSTRAINT "Turno_pacienteId_fkey" FOREIGN KEY ("pacienteId") REFERENCES "Paciente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Turno" ADD CONSTRAINT "Turno_kinesiologoId_fkey" FOREIGN KEY ("kinesiologoId") REFERENCES "Kinesiologo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Turno" ADD CONSTRAINT "Turno_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TurnoEvento" ADD CONSTRAINT "TurnoEvento_turnoId_fkey" FOREIGN KEY ("turnoId") REFERENCES "Turno"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TurnoEvento" ADD CONSTRAINT "TurnoEvento_autorId_fkey" FOREIGN KEY ("autorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
