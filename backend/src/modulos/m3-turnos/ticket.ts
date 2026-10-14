import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import type { BaseDeDatos } from '../../comun/baseDeDatos.js';
import { ErrorNegocio } from '../../comun/errores.js';
import type { DatosConsultorio, ServicioConsultorio } from '../m2-maestros/consultorio.js';

/** Lo que el ticket muestra del turno (RF-28). Nunca incluye DNI ni coseguros. */
export interface DatosTicket {
  numeroTurno: number;
  paciente: string;
  kinesiologo: string;
  /** Fecha calendario 'AAAA-MM-DD'. */
  fecha: string;
  /** Hora de inicio, 'HH:MM'. */
  horaInicio: string;
}

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'] as const;

/**
 * Fecha y hora en formato local legible y en castellano, por ejemplo `lunes 19/10/2026, 08:00`.
 * La fecha del turno es un día civil del consultorio (RF-12): no se convierte entre zonas.
 */
export function formatearFechaHora(fecha: string, horaInicio: string): string {
  const [anio, mes, dia] = fecha.split('-') as [string, string, string];
  const diaSemana = DIAS[new Date(`${fecha}T00:00:00Z`).getUTCDay()];
  return `${diaSemana} ${dia}/${mes}/${anio}, ${horaInicio}`;
}

/**
 * Texto plano del QR (plan.md §4.11): número de turno, paciente, kinesiólogo, fecha y hora, una
 * línea por dato. Función pura; es lo único que viaja en el código.
 */
export function textoDelQr(datos: DatosTicket): string {
  return [
    `Turno N° ${datos.numeroTurno}`,
    `Paciente: ${datos.paciente}`,
    `Kinesiólogo: ${datos.kinesiologo}`,
    `Fecha y hora: ${formatearFechaHora(datos.fecha, datos.horaInicio)}`,
  ].join('\n');
}

const errorTurnoNoEncontrado = () => new ErrorNegocio('turno_no_encontrado', 'El turno no existe.', 404);

async function dibujarPdf(datos: DatosTicket, consultorio: DatosConsultorio): Promise<Buffer> {
  const qr = await QRCode.toBuffer(textoDelQr(datos), { errorCorrectionLevel: 'M', margin: 2, scale: 8 });
  return new Promise<Buffer>((resolver, rechazar) => {
    // Helvetica estándar usa WinAnsi: cubre las tildes y la eñe del castellano.
    const doc = new PDFDocument({ size: 'A5', margin: 40, info: { Title: `Turno ${datos.numeroTurno}` } });
    const partes: Buffer[] = [];
    doc.on('data', (parte: Buffer) => partes.push(parte));
    doc.on('end', () => resolver(Buffer.concat(partes)));
    doc.on('error', rechazar);

    doc.font('Helvetica-Bold').fontSize(18).text(consultorio.nombre, { align: 'center' });
    doc.font('Helvetica').fontSize(10).text(consultorio.direccion, { align: 'center' });
    doc.text(`Teléfono: ${consultorio.telefono}`, { align: 'center' });
    doc.moveDown(1.5);

    doc.font('Helvetica-Bold').fontSize(16).text(`Turno N° ${datos.numeroTurno}`, { align: 'center' });
    doc.moveDown(0.5);
    doc.font('Helvetica').fontSize(12);
    doc.text(`Paciente: ${datos.paciente}`);
    doc.text(`Kinesiólogo: ${datos.kinesiologo}`);
    doc.text(`Fecha y hora: ${formatearFechaHora(datos.fecha, datos.horaInicio)}`);
    doc.moveDown(1);

    const lado = 160;
    doc.image(qr, (doc.page.width - lado) / 2, doc.y, { width: lado });
    doc.end();
  });
}

/**
 * Ticket del turno (RF-28). No se guarda nada: cada pedido lee el turno, el paciente, el
 * kinesiólogo y el consultorio vigentes y arma el PDF. Es de solo lectura.
 */
export function crearServicioTicket({ db, consultorio }: { db: BaseDeDatos; consultorio: ServicioConsultorio }) {
  return {
    async generar(turnoId: number): Promise<Buffer> {
      const turno = await db.turno.findUnique({
        where: { id: turnoId },
        select: {
          id: true,
          fecha: true,
          horaInicio: true,
          paciente: { select: { nombre: true } },
          kinesiologo: { select: { nombre: true } },
        },
      });
      if (!turno) throw errorTurnoNoEncontrado();
      const datosConsultorio = await consultorio.obtener();
      return dibujarPdf(
        {
          numeroTurno: turno.id,
          paciente: turno.paciente.nombre,
          kinesiologo: turno.kinesiologo.nombre,
          fecha: turno.fecha.toISOString().slice(0, 10),
          horaInicio: turno.horaInicio,
        },
        datosConsultorio,
      );
    },
  };
}

export type ServicioTicket = ReturnType<typeof crearServicioTicket>;
