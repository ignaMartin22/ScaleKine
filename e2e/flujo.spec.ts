import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { generateSync } from 'otplib';
import { DIRECTORIO_BACKEND, ORIGEN_FRONTEND, entornoDelBackend } from './entorno.js';

// jsQR es dependencia de pruebas del backend (lee los QR de los tickets): se reutiliza para leer el
// QR del segundo factor, que es la única forma de obtener el secreto desde la interfaz.
const requerir = createRequire(new URL('../backend/package.json', import.meta.url));
const jsQR = requerir('jsqr') as (
  datos: Uint8ClampedArray,
  ancho: number,
  alto: number,
) => { data: string } | null;

// Datos ficticios. Las contraseñas pasan la política de RNF-03 (12 o más caracteres, no comunes).
const CONTRASENA_ADMIN = 'Admin-E2E-clave-larga-4821';
const KINESIOLOGO = {
  nombre: 'Kinesiologo Prueba',
  usuario: 'kine.prueba',
  temporal: 'Temporal-E2E-clave-7733',
  definitiva: 'Kine-E2E-clave-larga-5519',
};
const PACIENTE = {
  dni: '30111222',
  nombre: 'Paciente Ficticio',
  telefono: '1155550000',
  obraSocial: 'Particular',
};

/** Último día hábil hasta hoy en la zona del consultorio (RF-15: no hay turnos sábados ni domingos). */
function fechaHabil(): string {
  const dia = new Date();
  for (let i = 0; i < 3; i++) {
    const texto = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Argentina/Buenos_Aires',
    }).format(dia);
    const semana = new Date(`${texto}T00:00:00Z`).getUTCDay();
    if (semana !== 0 && semana !== 6) return texto;
    dia.setUTCDate(dia.getUTCDate() - 1);
  }
  throw new Error('No se encontró un día hábil.');
}

function instalarPorCli(): string {
  const salida = execFileSync(
    process.execPath,
    [
      '--import',
      'tsx',
      'src/cli/index.ts',
      'instalar',
      '--nombre',
      'Consultorio de prueba',
      '--direccion',
      'Calle Ficticia 123',
      '--telefono',
      '1100000000',
    ],
    {
      cwd: DIRECTORIO_BACKEND,
      env: { ...process.env, ...entornoDelBackend() },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const coincidencia = /Contraseña temporal \(se muestra una sola vez\): (\S+)/.exec(salida);
  if (!coincidencia?.[1]) throw new Error('La CLI no mostró la contraseña temporal.');
  return coincidencia[1];
}

async function ingresar(pagina: Page, usuario: string, contrasena: string): Promise<void> {
  await pagina.goto('/ingresar');
  await pagina.getByLabel('Usuario').fill(usuario);
  await pagina.getByLabel('Contraseña').fill(contrasena);
  await pagina.getByRole('button', { name: 'Ingresar' }).click();
}

async function cambiarContrasenaObligatoria(
  pagina: Page,
  actual: string,
  nueva: string,
): Promise<void> {
  await expect(pagina.getByRole('heading', { name: 'Cambiar contraseña' })).toBeVisible();
  await pagina.getByLabel('Contraseña actual').fill(actual);
  await pagina.getByLabel('Contraseña nueva', { exact: true }).fill(nueva);
  await pagina.getByLabel('Repetir la contraseña nueva').fill(nueva);
  await pagina.getByRole('button', { name: 'Cambiar contraseña' }).click();
}

/** Lee el secreto del QR que muestra la pantalla de activación (URI otpauth://). */
async function secretoDelQr(pagina: Page): Promise<string> {
  const imagen = pagina.getByRole('img', { name: 'Código QR para la aplicación autenticadora' });
  await expect(imagen).toBeVisible();
  const pixeles = await imagen.evaluate(async (el) => {
    const img = el as HTMLImageElement;
    await img.decode();
    const lienzo = document.createElement('canvas');
    lienzo.width = img.naturalWidth;
    lienzo.height = img.naturalHeight;
    const contexto = lienzo.getContext('2d');
    if (!contexto) throw new Error('Sin contexto 2D.');
    contexto.drawImage(img, 0, 0);
    const datos = contexto.getImageData(0, 0, lienzo.width, lienzo.height);
    return { ancho: datos.width, alto: datos.height, datos: Array.from(datos.data) };
  });
  const leido = jsQR(Uint8ClampedArray.from(pixeles.datos), pixeles.ancho, pixeles.alto);
  if (!leido) throw new Error('No se pudo leer el QR.');
  const secreto = new URL(leido.data).searchParams.get('secret');
  if (!secreto) throw new Error('El QR no trae secreto.');
  return secreto;
}

function codigoTotp(secreto: string): string {
  return generateSync({
    secret: secreto,
    strategy: 'totp',
    algorithm: 'sha1',
    digits: 6,
    period: 30,
  });
}

async function contextoNuevo(
  browser: Browser,
): Promise<{ contexto: BrowserContext; pagina: Page }> {
  const contexto = await browser.newContext({ baseURL: ORIGEN_FRONTEND });
  return { contexto, pagina: await contexto.newPage() };
}

test('flujo principal con secretaría y kinesiólogo en vivo', async ({ browser }) => {
  const fecha = fechaHabil();
  const secretaria = await contextoNuevo(browser);
  const kinesiologo = await contextoNuevo(browser);
  const admin = secretaria.pagina;
  const kine = kinesiologo.pagina;

  await test.step('1. Instalar con la CLI', async () => {
    const temporal = instalarPorCli();
    await ingresar(admin, 'administrador', temporal);
    await cambiarContrasenaObligatoria(admin, temporal, CONTRASENA_ADMIN);
  });

  await test.step('2. Contraseña nueva y segundo factor (RNF-04)', async () => {
    await expect(admin.getByRole('heading', { name: 'Activar el segundo factor' })).toBeVisible();

    // Sin segundo factor activo, el administrador no pasa de esta pantalla.
    await admin.goto('/admin/kinesiologos');
    await expect(admin.getByRole('heading', { name: 'Activar el segundo factor' })).toBeVisible();
    const bloqueada = await admin.request.get('/api/agenda?fecha=' + fecha);
    expect(bloqueada.status()).toBe(403);

    const secreto = await secretoDelQr(admin);
    await admin
      .getByLabel('Código de seis dígitos que muestra la aplicación')
      .fill(codigoTotp(secreto));
    await admin.getByRole('button', { name: 'Confirmar y activar' }).click();
    await expect(admin.getByRole('list', { name: 'Códigos de recuperación' })).toBeVisible();
    await admin.getByLabel('Guardé mis códigos de recuperación en un lugar seguro.').check();
    await admin.getByRole('button', { name: 'Continuar' }).click();
    await expect(admin.getByRole('heading', { name: 'Agenda de turnos' })).toBeVisible();
  });

  await test.step('3. Alta de un kinesiólogo', async () => {
    await admin.goto('/admin/kinesiologos');
    await admin.getByLabel('Nombre', { exact: true }).fill(KINESIOLOGO.nombre);
    await admin.getByLabel('Bloque').first().selectOption('manana');
    await admin.getByLabel('Nombre de usuario').fill(KINESIOLOGO.usuario);
    await admin.getByLabel('Contraseña temporal').fill(KINESIOLOGO.temporal);
    await admin.getByRole('button', { name: 'Crear kinesiólogo' }).click();
    await expect(admin.getByRole('cell', { name: KINESIOLOGO.nombre })).toBeVisible();

    // El kinesiólogo ingresa en su propio contexto y deja abierta su agenda del día.
    await ingresar(kine, KINESIOLOGO.usuario, KINESIOLOGO.temporal);
    await cambiarContrasenaObligatoria(kine, KINESIOLOGO.temporal, KINESIOLOGO.definitiva);
    await expect(kine.getByRole('heading', { name: 'Mi agenda' })).toBeVisible();
    await kine.getByRole('textbox', { name: 'Fecha' }).fill(fecha);
    await expect(kine.getByRole('heading', { name: 'En espera (0)' })).toBeVisible();
    await expect(kine.getByRole('heading', { name: 'Próximos (0)' })).toBeVisible();
    // Marca para comprobar después que la página nunca se recargó.
    await kine.evaluate(() => {
      (window as unknown as { __sinRecarga: boolean }).__sinRecarga = true;
    });
  });

  await test.step('4. Asignar un turno y descargar el ticket (RF-43)', async () => {
    await admin.goto('/secretaria/asignar');
    await admin.getByRole('textbox', { name: 'Fecha' }).fill(fecha);
    await admin.getByRole('button', { name: 'Ver disponibilidad' }).click();
    await admin.getByLabel('DNI del paciente').fill(PACIENTE.dni);
    await admin.getByRole('button', { name: 'Buscar paciente' }).click();
    await admin.getByRole('button', { name: 'Dar de alta con este DNI' }).click();
    await admin.getByLabel('Nombre y apellido').fill(PACIENTE.nombre);
    await admin.getByLabel('Teléfono').fill(PACIENTE.telefono);
    await admin.getByRole('combobox', { name: 'Obra social' }).fill(PACIENTE.obraSocial);
    await admin.getByRole('button', { name: 'Crear paciente y elegirlo' }).click();
    await expect(admin.getByText(`Paciente: ${PACIENTE.nombre}`)).toBeVisible();

    await admin.getByRole('group', { name: KINESIOLOGO.nombre }).getByRole('radio').first().check();
    await admin.getByRole('button', { name: 'Confirmar turno' }).click();
    await expect(admin.getByRole('heading', { name: 'Turno asignado' })).toBeVisible();

    const descarga = admin.waitForEvent('download');
    await admin.getByRole('button', { name: 'Descargar ticket (PDF)' }).click();
    const ruta = await (await descarga).path();
    expect(readFileSync(ruta).subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  await test.step('5. Llegó y asistió, con el kinesiólogo viendo cada paso en vivo (RF-43)', async () => {
    // El turno asignado llega al kinesiólogo sin recargar.
    await expect(kine.getByRole('heading', { name: 'Próximos (1)' })).toBeVisible();
    await expect(kine.getByText(PACIENTE.nombre)).toBeVisible();

    await admin.goto('/secretaria/agenda');
    await admin.getByRole('textbox', { name: 'Fecha' }).fill(fecha);
    await admin.getByRole('button', { name: `Llegó, turno de ${PACIENTE.nombre}` }).click();
    await expect(kine.getByRole('heading', { name: 'En espera (1)' })).toBeVisible();
    await expect(kine.getByRole('heading', { name: 'Próximos (0)' })).toBeVisible();

    await admin.getByRole('button', { name: `Asistió, turno de ${PACIENTE.nombre}` }).click();
    await expect(kine.getByRole('heading', { name: 'En espera (0)' })).toBeVisible();

    const sinRecarga = await kine.evaluate(
      () => (window as unknown as { __sinRecarga?: boolean }).__sinRecarga === true,
    );
    expect(sinRecarga).toBe(true);
  });

  await test.step('6. El kinesiólogo no puede escribir contra la API (RF-03)', async () => {
    // Con cuerpo válido y Origin correcto: solo el rol puede explicar el rechazo.
    const respuesta = await kine.request.post('/api/pacientes', {
      headers: { Origin: ORIGEN_FRONTEND },
      data: {
        dni: '30999888',
        nombre: 'Otro Ficticio',
        telefono: '1155551111',
        obraSocial: 'Particular',
      },
    });
    expect(respuesta.status()).toBe(403);
  });

  await secretaria.contexto.close();
  await kinesiologo.contexto.close();
});
