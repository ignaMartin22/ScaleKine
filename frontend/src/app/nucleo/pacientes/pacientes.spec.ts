import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { normalizarDni } from './dni';
import { Pacientes, type DatosPaciente, type Paciente } from './pacientes';

const paciente: Paciente = {
  id: 7,
  dni: '30123456',
  nombre: 'Paciente Ficticio',
  telefono: '1100000000',
  obraSocial: 'Particular',
};
const alta: DatosPaciente = {
  dni: paciente.dni,
  nombre: paciente.nombre,
  telefono: paciente.telefono,
  obraSocial: paciente.obraSocial,
};

function preparar() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  return { servicio: TestBed.inject(Pacientes), servidor: TestBed.inject(HttpTestingController) };
}

describe('Pacientes (RF-17, RF-19 a RF-21)', () => {
  it('busca por DNI mandando solo el parámetro dni', async () => {
    const { servicio, servidor } = preparar();
    const resultado = servicio.buscarPorDni('30.123.456');
    const peticion = servidor.expectOne((p) => p.method === 'GET' && p.url === '/api/pacientes');
    expect(peticion.request.params.keys()).toEqual(['dni']);
    expect(peticion.request.params.get('dni')).toBe('30.123.456');
    peticion.flush({ pacientes: [paciente] });
    expect(await resultado).toEqual([paciente]);
  });

  it('busca por nombre mandando solo el parámetro nombre', async () => {
    const { servicio, servidor } = preparar();
    const resultado = servicio.buscarPorNombre('Ficti');
    const peticion = servidor.expectOne((p) => p.method === 'GET' && p.url === '/api/pacientes');
    expect(peticion.request.params.keys()).toEqual(['nombre']);
    expect(peticion.request.params.get('nombre')).toBe('Ficti');
    peticion.flush({ pacientes: [paciente] });
    expect(await resultado).toEqual([paciente]);
  });

  it('sin resultados devuelve una lista vacía, no un error', async () => {
    const { servicio, servidor } = preparar();
    const resultado = servicio.buscarPorDni('30123456');
    servidor.expectOne((p) => p.url === '/api/pacientes').flush({ pacientes: [] });
    expect(await resultado).toEqual([]);
  });

  it('lee la ficha por id', async () => {
    const { servicio, servidor } = preparar();
    const resultado = servicio.obtener(7);
    servidor.expectOne({ method: 'GET', url: '/api/pacientes/7' }).flush({ paciente });
    expect(await resultado).toEqual(paciente);
  });

  it('crea con los cuatro datos', async () => {
    const { servicio, servidor } = preparar();
    const resultado = servicio.crear(alta);
    const peticion = servidor.expectOne({ method: 'POST', url: '/api/pacientes' });
    expect(peticion.request.body).toEqual(alta);
    peticion.flush({ paciente }, { status: 201, statusText: 'Created' });
    expect(await resultado).toEqual(paciente);
  });

  it('edita con PUT reemplazando todos los datos', async () => {
    const { servicio, servidor } = preparar();
    const resultado = servicio.editar(7, alta);
    const peticion = servidor.expectOne({ method: 'PUT', url: '/api/pacientes/7' });
    expect(peticion.request.body).toEqual(alta);
    peticion.flush({ paciente });
    expect(await resultado).toEqual(paciente);
  });
});

describe('normalizarDni (RF-18)', () => {
  it('quita puntos y espacios', () => {
    expect(normalizarDni('30.123.456')).toBe('30123456');
    expect(normalizarDni(' 30 123 456 ')).toBe('30123456');
  });

  it('acepta 7 y 8 dígitos y rechaza el resto', () => {
    expect(normalizarDni('1234567')).toBe('1234567');
    expect(normalizarDni('123456')).toBeNull();
    expect(normalizarDni('123456789')).toBeNull();
    expect(normalizarDni('12a45678')).toBeNull();
    expect(normalizarDni('12-345-678')).toBeNull();
    expect(normalizarDni('')).toBeNull();
  });
});
