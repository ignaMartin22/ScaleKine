import { z } from 'zod';

/**
 * Configuración del backend (plan.md §5.2), validada al arrancar. Si algo falta o es inválido, el
 * proceso no arranca. Los mensajes de error nombran la variable, nunca su valor.
 */

const NIVELES_LOG = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

function esZonaHorariaValida(zona: string): boolean {
  try {
    new Intl.DateTimeFormat('es-AR', { timeZone: zona });
    return true;
  } catch {
    return false;
  }
}

function esOrigen(valor: string): boolean {
  try {
    const url = new URL(valor);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === valor;
  } catch {
    return false;
  }
}

const esquema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: z
      .string({ error: 'Falta DATABASE_URL.' })
      .refine((v) => /^postgres(ql)?:\/\//.test(v), 'DATABASE_URL debe ser una URL postgresql://.'),
    ZONA_HORARIA: z
      .string({ error: 'Falta ZONA_HORARIA (zona IANA del consultorio, RF-12).' })
      .refine(esZonaHorariaValida, 'ZONA_HORARIA no es una zona IANA válida.'),
    FRONTEND_ORIGIN: z
      .string({ error: 'Falta FRONTEND_ORIGIN.' })
      .refine(esOrigen, 'FRONTEND_ORIGIN debe ser un origen, por ejemplo https://turnos.ejemplo.com.ar.'),
    COOKIE_SECURE: z
      .enum(['true', 'false'], { error: 'COOKIE_SECURE debe ser true o false.' })
      .default('false')
      .transform((v) => v === 'true'),
    CLAVE_CIFRADO: z
      .string()
      .optional()
      .refine(
        (v) => v === undefined || Buffer.from(v, 'base64').length === 32,
        'CLAVE_CIFRADO debe ser una clave de 32 bytes en base64.',
      ),
    LOG_LEVEL: z.enum(NIVELES_LOG, { error: 'LOG_LEVEL no es un nivel válido.' }).default('info'),
  })
  .superRefine((c, ctx) => {
    if (c.NODE_ENV !== 'production') return;
    if (c.CLAVE_CIFRADO === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['CLAVE_CIFRADO'],
        message: 'Falta CLAVE_CIFRADO: es obligatoria en producción (RNF-04).',
      });
    }
    if (!c.COOKIE_SECURE) {
      ctx.addIssue({
        code: 'custom',
        path: ['COOKIE_SECURE'],
        message: 'COOKIE_SECURE debe ser true en producción (RNF-01).',
      });
    }
  });

export interface Configuracion {
  entorno: 'development' | 'test' | 'production';
  puerto: number;
  urlBaseDeDatos: string;
  zonaHoraria: string;
  origenFrontend: string;
  cookieSegura: boolean;
  claveCifrado: Buffer | undefined;
  nivelLog: (typeof NIVELES_LOG)[number];
}

export class ErrorConfiguracion extends Error {
  constructor(readonly problemas: string[]) {
    super(`Configuración inválida:\n${problemas.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ErrorConfiguracion';
  }
}

export function cargarConfiguracion(entorno: Record<string, string | undefined>): Configuracion {
  // Una variable definida pero vacía (`CLAVE_CIFRADO=` en .env) cuenta como ausente.
  const definidas = Object.fromEntries(
    Object.entries(entorno)
      .map(([clave, valor]) => [clave, valor?.trim()])
      .filter(([, valor]) => valor !== undefined && valor !== ''),
  );
  const resultado = esquema.safeParse(definidas);
  if (!resultado.success) {
    // Solo el mensaje de cada problema: zod podría incluir el valor recibido en otros campos.
    throw new ErrorConfiguracion(resultado.error.issues.map((i) => i.message));
  }
  const c = resultado.data;
  return {
    entorno: c.NODE_ENV,
    puerto: c.PORT,
    urlBaseDeDatos: c.DATABASE_URL,
    zonaHoraria: c.ZONA_HORARIA,
    origenFrontend: c.FRONTEND_ORIGIN,
    cookieSegura: c.COOKIE_SECURE,
    claveCifrado: c.CLAVE_CIFRADO === undefined ? undefined : Buffer.from(c.CLAVE_CIFRADO, 'base64'),
    nivelLog: c.LOG_LEVEL,
  };
}
