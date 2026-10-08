import { describe, expect, it, vi } from 'vitest';
import {
  instalar,
  restablecer2faAdmin,
  restablecerAdmin,
  revocarSesiones,
  type DatosInstalacion,
  type DependenciasCli,
} from '../../src/cli/comandos.js';
import { ErrorNegocio } from '../../src/comun/errores.js';
import { RelojFijo } from '../../src/comun/reloj.js';
import { crearServicioIdentidad } from '../../src/modulos/m1-identidad/servicio.js';
import { db } from './base.js';
import { crearUsuario } from './fabricas.js';

const AHORA = '2026-10-07T12:00:00Z';
const DATOS: DatosInstalacion = {
  usuario: 'administrador',
  nombre: 'Consultorio Ficticio',
  direccion: 'Calle Falsa 123',
  telefono: '11 5555 0000',
};

function dependencias(): DependenciasCli & { reloj: RelojFijo } {
  return { db, reloj: new RelojFijo(AHORA) };
}

async function servicio(deps: DependenciasCli) {
  return crearServicioIdentidad({ db: deps.db, reloj: deps.reloj });
}

async function codigoDeError(accion: Promise<unknown>): Promise<string> {
  try {
    await accion;
  } catch (error) {
    expect(error).toBeInstanceOf(ErrorNegocio);
    return (error as ErrorNegocio).codigo;
  }
  throw new Error('Se esperaba un ErrorNegocio');
}

async function administrador() {
  return db.usuario.findFirstOrThrow({ where: { rol: 'administrador' } });
}

describe('instalar (RF-05, RF-13)', () => {
  it('crea el administrador activo y marcado para cambio, y el consultorio', async () => {
    const deps = dependencias();

    const { contrasenaTemporal } = await instalar(deps, DATOS);

    const admin = await administrador();
    expect(admin).toMatchObject({
      nombreUsuario: 'administrador',
      rol: 'administrador',
      activo: true,
      debeCambiarContrasena: true,
      totpActivo: false,
    });
    expect(admin.creadoEn.toISOString()).toBe('2026-10-07T12:00:00.000Z');
    expect(admin.hashContrasena.startsWith('$argon2id$')).toBe(true);
    expect(admin.hashContrasena).not.toContain(contrasenaTemporal);

    expect(await db.consultorio.findMany()).toEqual([
      { id: 1, nombre: 'Consultorio Ficticio', direccion: 'Calle Falsa 123', telefono: '11 5555 0000' },
    ]);
  });

  it('la contraseña temporal permite ingresar y la cuenta queda marcada para cambiarla', async () => {
    const deps = dependencias();
    const { contrasenaTemporal } = await instalar(deps, DATOS);

    const { usuario } = await (await servicio(deps)).ingresar('administrador', contrasenaTemporal);

    expect(usuario.rol).toBe('administrador');
    expect(usuario.debeCambiarContrasena).toBe(true);
  });

  it('usa el nombre de usuario indicado', async () => {
    const deps = dependencias();
    const { contrasenaTemporal } = await instalar(deps, { ...DATOS, usuario: 'jefa' });

    const { usuario } = await (await servicio(deps)).ingresar('jefa', contrasenaTemporal);
    expect(usuario.nombreUsuario).toBe('jefa');
  });

  it('se niega si ya hay un administrador, sin modificar nada', async () => {
    const deps = dependencias();
    await crearUsuario({ rol: 'administrador', nombreUsuario: 'existente' });

    expect(await codigoDeError(instalar(deps, DATOS))).toBe('ya_instalado');

    expect(await db.usuario.count()).toBe(1);
    expect(await db.consultorio.count()).toBe(0);
  });

  it('se niega si ya hay un consultorio, sin crear el administrador', async () => {
    const deps = dependencias();
    await db.consultorio.create({ data: { id: 1, nombre: 'Previo', direccion: 'Otra 1', telefono: '1' } });

    expect(await codigoDeError(instalar(deps, DATOS))).toBe('ya_instalado');

    expect(await db.usuario.count()).toBe(0);
    expect(await db.consultorio.findMany()).toEqual([
      { id: 1, nombre: 'Previo', direccion: 'Otra 1', telefono: '1' },
    ]);
  });

  it('una segunda instalación se niega y deja intacta la primera', async () => {
    const deps = dependencias();
    const primera = await instalar(deps, DATOS);

    expect(await codigoDeError(instalar(deps, { ...DATOS, usuario: 'otro', nombre: 'Otro' }))).toBe(
      'ya_instalado',
    );

    expect(await db.usuario.count()).toBe(1);
    expect((await db.consultorio.findFirstOrThrow()).nombre).toBe('Consultorio Ficticio');
    await expect(
      (await servicio(deps)).ingresar('administrador', primera.contrasenaTemporal),
    ).resolves.toBeDefined();
  });

  it('dos instalaciones simultáneas dejan un solo administrador y un solo consultorio', async () => {
    const deps = dependencias();

    const resultados = await Promise.allSettled([
      instalar(deps, DATOS),
      instalar(deps, { ...DATOS, usuario: 'otro' }),
    ]);

    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await db.usuario.count({ where: { rol: 'administrador' } })).toBe(1);
    expect(await db.consultorio.count()).toBe(1);
  });
});

describe('restablecer-admin (plan.md §9)', () => {
  async function conAdministradorInstalado() {
    const deps = dependencias();
    const { contrasenaTemporal } = await instalar(deps, DATOS);
    return { deps, anterior: contrasenaTemporal };
  }

  it('invalida la contraseña anterior y la nueva exige el cambio', async () => {
    const { deps, anterior } = await conAdministradorInstalado();
    // El administrador ya había elegido su contraseña.
    await db.usuario.updateMany({ where: { rol: 'administrador' }, data: { debeCambiarContrasena: false } });

    const { contrasenaTemporal } = await restablecerAdmin(deps, {});

    const identidad = await servicio(deps);
    expect(contrasenaTemporal).not.toBe(anterior);
    await expect(identidad.ingresar('administrador', anterior)).rejects.toMatchObject({
      codigo: 'credenciales_invalidas',
    });
    const { usuario } = await identidad.ingresar('administrador', contrasenaTemporal);
    expect(usuario.debeCambiarContrasena).toBe(true);
  });

  it('cierra todas las sesiones del administrador y no toca las de otras cuentas', async () => {
    const { deps, anterior } = await conAdministradorInstalado();
    const identidad = await servicio(deps);
    const primera = await identidad.ingresar('administrador', anterior);
    const segunda = await identidad.ingresar('administrador', anterior);
    const otra = await crearUsuario({ nombreUsuario: 'otra1' });
    const sesionAjena = await db.sesion.create({
      data: {
        hashToken: 'hash-ajeno',
        usuarioId: otra.id,
        creadaEn: new Date(AHORA),
        venceEn: new Date('2026-10-08T00:00:00Z'),
      },
    });

    await restablecerAdmin(deps, {});

    expect(await identidad.sesionVigente(primera.token)).toBeNull();
    expect(await identidad.sesionVigente(segunda.token)).toBeNull();
    const ajena = await db.sesion.findUniqueOrThrow({ where: { id: sesionAjena.id } });
    expect(ajena.revocadaEn).toBeNull();
  });

  it('levanta el bloqueo por intentos fallidos', async () => {
    const { deps } = await conAdministradorInstalado();
    await db.usuario.updateMany({
      where: { rol: 'administrador' },
      data: {
        ingresosFallidos: 5,
        bloqueadoHasta: new Date('2026-10-07T12:15:00Z'),
        bloqueosConsecutivos: 2,
      },
    });

    await restablecerAdmin(deps, {});

    expect(await administrador()).toMatchObject({
      ingresosFallidos: 0,
      bloqueadoHasta: null,
      bloqueosConsecutivos: 0,
    });
  });

  it('no toca el segundo factor ni los datos del consultorio', async () => {
    const { deps } = await conAdministradorInstalado();
    await db.usuario.updateMany({
      where: { rol: 'administrador' },
      data: {
        totpActivo: true,
        secretoTotpCifrado: 'secreto-cifrado-ficticio',
        codigosRecuperacion: ['h1', 'h2'],
      },
    });

    await restablecerAdmin(deps, {});

    expect(await administrador()).toMatchObject({
      totpActivo: true,
      secretoTotpCifrado: 'secreto-cifrado-ficticio',
      codigosRecuperacion: ['h1', 'h2'],
    });
    expect(await db.consultorio.count()).toBe(1);
  });

  it('un ingreso con la contraseña vieja concurrente con el restablecimiento no deja una sesión viva', async () => {
    const { deps, anterior } = await conAdministradorInstalado();
    const identidad = await servicio(deps);

    // El ingreso lee el hash y verifica la contraseña vieja; justo después se restablece la cuenta.
    const original = db.usuario.findUnique.bind(db.usuario);
    let primera = true;
    const espia = vi.spyOn(db.usuario, 'findUnique').mockImplementation(((args: never) => {
      const lectura = original(args);
      if (!primera) return lectura;
      primera = false;
      return lectura.then(async (usuarioLeido) => {
        await restablecerAdmin(deps, {});
        return usuarioLeido;
      });
    }) as never);
    try {
      await expect(identidad.ingresar('administrador', anterior)).rejects.toMatchObject({
        codigo: 'credenciales_invalidas',
      });
    } finally {
      espia.mockRestore();
    }

    expect(await db.sesion.count({ where: { revocadaEn: null } })).toBe(0);
  });

  it('falla si no hay administrador', async () => {
    expect(await codigoDeError(restablecerAdmin(dependencias(), {}))).toBe('administrador_inexistente');
  });

  it('con más de un administrador exige indicar cuál', async () => {
    const deps = dependencias();
    await crearUsuario({ rol: 'administrador', nombreUsuario: 'uno' });
    await crearUsuario({ rol: 'administrador', nombreUsuario: 'dos' });

    expect(await codigoDeError(restablecerAdmin(deps, {}))).toBe('administrador_ambiguo');
    await expect(restablecerAdmin(deps, { usuario: 'dos' })).resolves.toHaveProperty('contrasenaTemporal');
  });

  it('no restablece cuentas que no son de administrador', async () => {
    const deps = dependencias();
    await crearUsuario({ rol: 'secretaria', nombreUsuario: 'secre1' });

    expect(await codigoDeError(restablecerAdmin(deps, { usuario: 'secre1' }))).toBe(
      'administrador_inexistente',
    );
  });
});

describe('restablecer-2fa-admin (RNF-04)', () => {
  it('deja el segundo factor sin activar, sin secreto y sin códigos', async () => {
    const deps = dependencias();
    await instalar(deps, DATOS);
    await db.usuario.updateMany({
      where: { rol: 'administrador' },
      data: {
        totpActivo: true,
        secretoTotpCifrado: 'secreto-cifrado-ficticio',
        codigosRecuperacion: ['h1', 'h2'],
      },
    });

    await restablecer2faAdmin(deps, {});

    expect(await administrador()).toMatchObject({
      totpActivo: false,
      secretoTotpCifrado: null,
      codigosRecuperacion: [],
    });
  });

  it('no cambia la contraseña ni la marca de cambio', async () => {
    const deps = dependencias();
    const { contrasenaTemporal } = await instalar(deps, DATOS);
    const antes = await administrador();

    await restablecer2faAdmin(deps, {});

    const despues = await administrador();
    expect(despues.hashContrasena).toBe(antes.hashContrasena);
    expect(despues.debeCambiarContrasena).toBe(true);
    await expect((await servicio(deps)).ingresar('administrador', contrasenaTemporal)).resolves.toBeDefined();
  });

  it('cierra las sesiones abiertas del administrador y no toca las de otras cuentas', async () => {
    const deps = dependencias();
    const { contrasenaTemporal } = await instalar(deps, DATOS);
    const identidad = await servicio(deps);
    const primera = await identidad.ingresar('administrador', contrasenaTemporal);
    const segunda = await identidad.ingresar('administrador', contrasenaTemporal);
    // Una sesión que ya había verificado el segundo factor.
    await db.sesion.updateMany({ data: { segundoFactorVerificado: true } });
    const otra = await crearUsuario({ nombreUsuario: 'otra1' });
    const sesionAjena = await db.sesion.create({
      data: {
        hashToken: 'hash-ajeno',
        usuarioId: otra.id,
        creadaEn: new Date(AHORA),
        venceEn: new Date('2026-10-08T00:00:00Z'),
      },
    });

    await restablecer2faAdmin(deps, {});

    expect(await identidad.sesionVigente(primera.token)).toBeNull();
    expect(await identidad.sesionVigente(segunda.token)).toBeNull();
    const ajena = await db.sesion.findUniqueOrThrow({ where: { id: sesionAjena.id } });
    expect(ajena.revocadaEn).toBeNull();
  });

  it('falla si no hay administrador', async () => {
    expect(await codigoDeError(restablecer2faAdmin(dependencias(), {}))).toBe('administrador_inexistente');
  });

  it('no toca el segundo factor de otras cuentas', async () => {
    const deps = dependencias();
    await instalar(deps, DATOS);
    const otra = await crearUsuario({ nombreUsuario: 'otra1' });
    await db.usuario.update({ where: { id: otra.id }, data: { totpActivo: true, secretoTotpCifrado: 'x' } });

    await restablecer2faAdmin(deps, {});

    expect(await db.usuario.findUniqueOrThrow({ where: { id: otra.id } })).toMatchObject({
      totpActivo: true,
      secretoTotpCifrado: 'x',
    });
  });
});

describe('revocar-sesiones (despliegue.md §12)', () => {
  const sesion = (usuarioId: number, hashToken: string, revocadaEn: Date | null = null) =>
    db.sesion.create({
      data: {
        hashToken,
        usuarioId,
        creadaEn: new Date('2026-10-07T10:00:00Z'),
        venceEn: new Date('2026-10-07T22:00:00Z'),
        revocadaEn,
      },
    });

  it('deja revocadas todas las sesiones de todas las cuentas', async () => {
    const deps = dependencias();
    const a = await crearUsuario({ nombreUsuario: 'a1' });
    const b = await crearUsuario({ nombreUsuario: 'b1', rol: 'kinesiologo' });
    await sesion(a.id, 'h1');
    await sesion(a.id, 'h2');
    await sesion(b.id, 'h3');

    const { revocadas } = await revocarSesiones(deps);

    expect(revocadas).toBe(3);
    const sesiones = await db.sesion.findMany();
    expect(sesiones).toHaveLength(3);
    for (const s of sesiones) expect(s.revocadaEn?.toISOString()).toBe('2026-10-07T12:00:00.000Z');
  });

  it('conserva la fecha de las ya revocadas y es idempotente', async () => {
    const deps = dependencias();
    const a = await crearUsuario({ nombreUsuario: 'a1' });
    const yaRevocada = new Date('2026-10-07T11:00:00Z');
    await sesion(a.id, 'h1', yaRevocada);
    await sesion(a.id, 'h2');

    expect((await revocarSesiones(deps)).revocadas).toBe(1);
    expect((await revocarSesiones(deps)).revocadas).toBe(0);

    const conservada = await db.sesion.findUniqueOrThrow({ where: { hashToken: 'h1' } });
    expect(conservada.revocadaEn?.toISOString()).toBe(yaRevocada.toISOString());
  });

  it('con la base sin sesiones no hace nada', async () => {
    expect((await revocarSesiones(dependencias())).revocadas).toBe(0);
  });

  it('las sesiones revocadas dejan de ser vigentes', async () => {
    const deps = dependencias();
    const { contrasenaTemporal } = await instalar(deps, DATOS);
    const identidad = await servicio(deps);
    const { token } = await identidad.ingresar('administrador', contrasenaTemporal);
    expect(await identidad.sesionVigente(token)).not.toBeNull();

    await revocarSesiones(deps);

    expect(await identidad.sesionVigente(token)).toBeNull();
  });
});
