import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Consultorio, type DatosConsultorio } from './consultorio';

const datos: DatosConsultorio = {
  nombre: 'Consultorio Ficticio',
  direccion: 'Calle Falsa 123',
  telefono: '0000-0000',
};

function preparar() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  return {
    consultorio: TestBed.inject(Consultorio),
    servidor: TestBed.inject(HttpTestingController),
  };
}

describe('Consultorio (RF-13)', () => {
  it('lee los datos', async () => {
    const { consultorio, servidor } = preparar();
    const resultado = consultorio.obtener();
    servidor.expectOne({ method: 'GET', url: '/api/consultorio' }).flush({ consultorio: datos });
    expect(await resultado).toEqual(datos);
  });

  it('edita los tres datos y devuelve lo que guardó el backend', async () => {
    const { consultorio, servidor } = preparar();
    const resultado = consultorio.editar(datos);
    const peticion = servidor.expectOne({ method: 'PUT', url: '/api/consultorio' });
    expect(peticion.request.body).toEqual(datos);
    peticion.flush({ consultorio: { ...datos, telefono: '1111-1111' } });
    expect((await resultado).telefono).toBe('1111-1111');
  });
});
