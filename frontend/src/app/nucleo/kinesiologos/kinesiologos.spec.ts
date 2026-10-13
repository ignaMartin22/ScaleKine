import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Kinesiologos, type Kinesiologo } from './kinesiologos';

const kinesiologo: Kinesiologo = {
  id: 5,
  nombre: 'Kinesiólogo Ficticio',
  bloque: 'manana',
  activo: true,
};

function preparar() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  return {
    servicio: TestBed.inject(Kinesiologos),
    servidor: TestBed.inject(HttpTestingController),
  };
}

describe('Kinesiologos (RF-14, RF-16)', () => {
  it('lista sin filtro', async () => {
    const { servicio, servidor } = preparar();
    const resultado = servicio.listar();
    const peticion = servidor.expectOne('/api/kinesiologos');
    expect(peticion.request.params.has('bloque')).toBe(false);
    peticion.flush({ kinesiologos: [kinesiologo] });
    expect(await resultado).toEqual([kinesiologo]);
  });

  it('lista con el filtro por bloque', async () => {
    const { servicio, servidor } = preparar();
    const resultado = servicio.listar('tarde');
    servidor.expectOne('/api/kinesiologos?bloque=tarde').flush({ kinesiologos: [] });
    expect(await resultado).toEqual([]);
  });

  it('da de alta sin mandar un rol', async () => {
    const { servicio, servidor } = preparar();
    const alta = {
      nombre: 'Kinesiólogo Ficticio',
      bloque: 'manana' as const,
      nombreUsuario: 'kine.ficticio',
      contrasenaTemporal: 'temporal-ficticia-1',
    };
    const resultado = servicio.crear(alta);
    const peticion = servidor.expectOne({ method: 'POST', url: '/api/kinesiologos' });
    expect(peticion.request.body).toEqual(alta);
    peticion.flush({ kinesiologo }, { status: 201, statusText: 'Created' });
    expect(await resultado).toEqual(kinesiologo);
  });

  it('cambia el bloque con PUT', async () => {
    const { servicio, servidor } = preparar();
    const resultado = servicio.cambiarBloque(5, 'tarde');
    const peticion = servidor.expectOne({ method: 'PUT', url: '/api/kinesiologos/5/bloque' });
    expect(peticion.request.body).toEqual({ bloque: 'tarde' });
    peticion.flush({ kinesiologo: { ...kinesiologo, bloque: 'tarde' } });
    expect((await resultado).bloque).toBe('tarde');
  });
});
