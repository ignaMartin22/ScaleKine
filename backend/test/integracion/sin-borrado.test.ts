import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { Router, type RequestHandler } from "express";
import { describe, expect, it } from "vitest";
import { cargarConfiguracion } from "../../src/comun/configuracion.js";
import { RelojFijo } from "../../src/comun/reloj.js";
import { crearServicioCuentas } from "../../src/modulos/m1-identidad/cuentas.js";
import { crearServicioConsultorio } from "../../src/modulos/m2-maestros/consultorio.js";
import { crearServicioTicket } from "../../src/modulos/m3-turnos/ticket.js";
import { crearServicioTurnos } from "../../src/modulos/m3-turnos/turnos.js";
import { crearRutas } from "../../src/rutas.js";
import { appDePrueba, ENTORNO_PRUEBA } from "../ayudantes.js";
import { db } from "./base.js";

/**
 * Sin borrado (RF-39, RF-09; plan.md §2.3, "Un turno no se elimina"). La aplicación no ofrece
 * ninguna vía de borrado de turnos, eventos ni cuentas: ni ruta HTTP, ni método de servicio, ni
 * sentencia de borrado en el código. La otra mitad de la defensa, que `scalekine_app` no tiene
 * permiso `DELETE` en la base, la cubre `permisos.test.ts` (T-04) y no se repite acá.
 */

/** Lo mínimo que se lee de las capas de un router de Express 5. */
interface CapaExpress {
  handle: unknown;
  route?: { path: string; methods: Record<string, boolean> };
}
interface RouterInspeccionable {
  stack: CapaExpress[];
}

const comoInspeccionable = (router: Router) =>
  router as unknown as RouterInspeccionable;
const pilaDeApp = (app: unknown): CapaExpress[] =>
  (app as { router: RouterInspeccionable }).router.stack;
const subCapas = (capa: CapaExpress): CapaExpress[] | undefined => {
  const stack = (capa.handle as Partial<RouterInspeccionable> | undefined)
    ?.stack;
  return Array.isArray(stack) ? stack : undefined;
};

/**
 * Únicas rutas `DELETE` (o `ALL`) permitidas, por nombre. `DELETE /api/sesion` cierra la sesión
 * propia (RF-10): borra una sesión, no un turno ni una cuenta. Toda excepción nueva se agrega acá
 * con su justificación. Los paths son los del router (el prefijo `/api` lo pone la app).
 */
const BORRADOS_PERMITIDOS = ["DELETE /sesion"];

/** Todas las rutas que aceptan `DELETE` (o `router.all()`), con sub-routers anidados, como `DELETE /ruta`. */
function rutasDeBorrado(capas: CapaExpress[]): string[] {
  const encontradas: string[] = [];
  for (const capa of capas) {
    if (capa.route) {
      const { path, methods } = capa.route;
      if (methods.delete) encontradas.push(`DELETE ${path}`);
      // `_all` es como Express 5 marca `router.all()`, que también acepta DELETE.
      if (methods._all) encontradas.push(`ALL ${path}`);
      continue;
    }
    const hijas = subCapas(capa);
    if (hijas) encontradas.push(...rutasDeBorrado(hijas));
  }
  return encontradas;
}

/** Cantidad de rutas (de cualquier método) en la pila, para probar que se recorrió algo. */
function contarRutas(capas: CapaExpress[]): number {
  let total = 0;
  for (const capa of capas) {
    if (capa.route) {
      total += Object.values(capa.route.methods).filter(Boolean).length;
      continue;
    }
    const hijas = subCapas(capa);
    if (hijas) total += contarRutas(hijas);
  }
  return total;
}

const manejadorCualquiera: RequestHandler = (_req, res) => {
  res.end();
};

describe("ninguna ruta HTTP borra turnos, eventos ni cuentas (RF-39, RF-09)", () => {
  it("las rutas reales solo tienen la DELETE de cierre de sesión", async () => {
    const rutas = await crearRutas({
      db,
      reloj: new RelojFijo("2026-10-07T12:00:00Z"),
      config: cargarConfiguracion(ENTORNO_PRUEBA),
    });
    const pila = pilaDeApp(appDePrueba(rutas).app);

    // Que no pase en vacío: se recorrió la API completa.
    expect(contarRutas(pila)).toBeGreaterThan(20);
    expect(rutasDeBorrado(pila)).toEqual(BORRADOS_PERMITIDOS);
  });

  it("la guardiana detecta DELETE y ALL sobre turnos, eventos y cuentas, también anidados", () => {
    const turnos = Router();
    turnos.delete("/turnos/:id", manejadorCualquiera);
    const eventos = Router();
    eventos.delete("/turnos/:id/eventos/:eventoId", manejadorCualquiera);
    const cuentas = Router();
    cuentas.all("/cuentas/:id", manejadorCualquiera);
    const anidado = Router();
    const hijo = Router();
    hijo.use("/turnos", turnos);
    anidado.use("/api", hijo);

    expect(rutasDeBorrado(comoInspeccionable(turnos).stack)).toEqual([
      "DELETE /turnos/:id",
    ]);
    expect(rutasDeBorrado(comoInspeccionable(eventos).stack)).toEqual([
      "DELETE /turnos/:id/eventos/:eventoId",
    ]);
    expect(rutasDeBorrado(comoInspeccionable(cuentas).stack)).toEqual([
      "ALL /cuentas/:id",
    ]);
    expect(rutasDeBorrado(comoInspeccionable(anidado).stack)).toEqual([
      "DELETE /turnos/:id",
    ]);
  });

  it("una DELETE de turnos agregada, también anidada, a la app completa aparece en el recorrido", async () => {
    const rutas = await crearRutas({
      db,
      reloj: new RelojFijo("2026-10-07T12:00:00Z"),
      config: cargarConfiguracion(ENTORNO_PRUEBA),
    });
    const intrusa = Router();
    intrusa.delete("/turnos/:id", manejadorCualquiera);
    const contenedor = Router();
    contenedor.use("/anidado", intrusa);
    const pila = pilaDeApp(appDePrueba([...rutas, contenedor]).app);

    expect(rutasDeBorrado(pila)).not.toEqual(BORRADOS_PERMITIDOS);
    expect(rutasDeBorrado(pila)).toContain("DELETE /turnos/:id");
  });

  it("las GET, POST y PUT no cuentan como borrado", () => {
    const router = Router();
    router.get("/turnos/:id", manejadorCualquiera);
    router.post("/turnos", manejadorCualquiera);
    router.put("/cuentas/:id", manejadorCualquiera);

    expect(rutasDeBorrado(comoInspeccionable(router).stack)).toEqual([]);
  });
});

describe("ningún servicio expone un método de borrado (RF-39, RF-09)", () => {
  const NOMBRE_DE_BORRADO =
    /delete|remove|destroy|drop|purge|elimin|borr|quitar/i;
  const reloj = new RelojFijo("2026-10-07T12:00:00Z");

  it("los servicios de cuentas, turnos y ticket no tienen métodos con nombre de borrado", () => {
    const servicios = {
      cuentas: crearServicioCuentas({ db, reloj }),
      turnos: crearServicioTurnos({ db, reloj }),
      ticket: crearServicioTicket({
        db,
        consultorio: crearServicioConsultorio({ db }),
      }),
    };

    for (const [nombre, servicio] of Object.entries(servicios)) {
      const metodos = Object.keys(servicio);
      // Que no pase en vacío: el servicio tiene métodos y se los revisó.
      expect(metodos.length, nombre).toBeGreaterThan(0);
      expect(
        metodos.filter((m) => NOMBRE_DE_BORRADO.test(m)),
        nombre,
      ).toEqual([]);
    }
  });

  it("la expresión reconoce nombres de borrado y deja pasar los demás", () => {
    for (const nombre of [
      "eliminarTurno",
      "borrarCuenta",
      "deleteTurno",
      "removeUsuario",
      "destroy",
    ]) {
      expect(NOMBRE_DE_BORRADO.test(nombre), nombre).toBe(true);
    }
    for (const nombre of [
      "asignar",
      "desactivar",
      "anular",
      "obtener",
      "restablecerContrasena",
    ]) {
      expect(NOMBRE_DE_BORRADO.test(nombre), nombre).toBe(false);
    }
  });
});

describe("el código no contiene sentencias de borrado de datos de negocio (RF-39, RF-09)", () => {
  const RAIZ_SRC = join(import.meta.dirname, "../../src");
  const ESQUEMA = join(import.meta.dirname, "../../prisma/schema.prisma");

  /** Los únicos borrados permitidos (despliegue.md §7): sesiones y límite de intentos. */
  const MODELOS_CON_BORRADO_PERMITIDO = ["Sesion", "LimiteIntentos"];
  const TABLAS_CON_BORRADO_PERMITIDO = ["sesion", "limite_intentos"];

  /** Archivos `.ts` de `src/`, sin el cliente generado de Prisma. */
  function archivosDeCodigo(dir: string): string[] {
    return readdirSync(dir).flatMap((nombre) => {
      const ruta = join(dir, nombre);
      if (statSync(ruta).isDirectory())
        return nombre === "generado" ? [] : archivosDeCodigo(ruta);
      return ruta.endsWith(".ts") ? [ruta] : [];
    });
  }

  /** Sin comentarios, para que una mención en texto no cuente una llamada. */
  const sinComentarios = (codigo: string) =>
    codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  /** Modelos del esquema que no pueden borrarse, con minúscula inicial como los expone el cliente. */
  function modelosProtegidos(): string[] {
    const modelos = [
      ...readFileSync(ESQUEMA, "utf8").matchAll(/^model\s+(\w+)\s*\{/gm),
    ].map((m) => m[1] ?? "");
    return modelos
      .filter((m) => !MODELOS_CON_BORRADO_PERMITIDO.includes(m))
      .map((m) => m.charAt(0).toLowerCase() + m.slice(1));
  }

  /** Hallazgos de borrado en un código: `delete`/`deleteMany` de Prisma y SQL `DELETE FROM`/`TRUNCATE`. */
  function borradosEn(codigo: string, protegidos: string[]): string[] {
    const limpio = sinComentarios(codigo);
    const hallazgos: string[] = [];
    const prisma = new RegExp(
      `\\b(${protegidos.join("|")})\\s*\\.\\s*(deleteMany|delete)\\s*\\(`,
      "g",
    );
    for (const m of limpio.matchAll(prisma)) hallazgos.push(`${m[1]}.${m[2]}`);
    for (const m of limpio.matchAll(
      /\b(DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?)\s+"?(\w+)/gi,
    )) {
      if (!TABLAS_CON_BORRADO_PERMITIDO.includes((m[2] ?? "").toLowerCase()))
        hallazgos.push(`SQL ${m[1]} ${m[2]}`);
    }
    return hallazgos;
  }

  it("el esquema tiene modelos protegidos, incluidos turnos, eventos, usuarios y pacientes", () => {
    const protegidos = modelosProtegidos();

    expect(protegidos).toEqual(
      expect.arrayContaining(["turno", "turnoEvento", "usuario", "paciente"]),
    );
    expect(protegidos).not.toContain("sesion");
    expect(protegidos).not.toContain("limiteIntentos");
  });

  it("nada en src/ borra turnos, eventos, usuarios, pacientes ni otro dato de negocio", () => {
    const archivos = archivosDeCodigo(RAIZ_SRC);
    // Que no pase en vacío: se leyeron los módulos de cuentas y turnos.
    const relativos = archivos.map((a) =>
      relative(RAIZ_SRC, a).split(sep).join("/"),
    );
    expect(relativos).toEqual(
      expect.arrayContaining([
        "modulos/m1-identidad/cuentas.ts",
        "modulos/m3-turnos/turnos.ts",
      ]),
    );

    const protegidos = modelosProtegidos();
    const hallazgos = archivos.flatMap((archivo) =>
      borradosEn(readFileSync(archivo, "utf8"), protegidos).map(
        (h) => `${relative(RAIZ_SRC, archivo).split(sep).join("/")}: ${h}`,
      ),
    );

    expect(hallazgos).toEqual([]);
  });

  it("la detección reconoce borrados de Prisma y SQL, y deja pasar los permitidos", () => {
    const protegidos = ["turno", "turnoEvento", "usuario", "paciente"];

    expect(
      borradosEn("await db.turno.delete({ where: { id } });", protegidos),
    ).toEqual(["turno.delete"]);
    expect(
      borradosEn("await tx.turnoEvento.deleteMany();", protegidos),
    ).toEqual(["turnoEvento.deleteMany"]);
    expect(
      borradosEn(
        "const { usuario } = tx; await usuario.delete({ where });",
        protegidos,
      ),
    ).toEqual(["usuario.delete"]);
    expect(
      borradosEn('await db.$executeRaw`DELETE FROM "Paciente"`', protegidos),
    ).toEqual(["SQL DELETE FROM Paciente"]);
    expect(
      borradosEn(
        'await db.$executeRawUnsafe("TRUNCATE TABLE Turno")',
        protegidos,
      ),
    ).toHaveLength(1);
    expect(
      borradosEn("await db.sesion.deleteMany({ where });", protegidos),
    ).toEqual([]);
    expect(
      borradosEn(
        "await db.$executeRaw`DELETE FROM limite_intentos WHERE x`",
        protegidos,
      ),
    ).toEqual([]);
    expect(
      borradosEn(
        "// db.turno.delete(...) no se usa\n/* usuario.delete( */",
        protegidos,
      ),
    ).toEqual([]);
  });
});
