import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Cuentas, type CuentaListada } from './cuentas';

const cuenta: CuentaListada = {
  id: 2,
  nombreUsuario: 'secretaria.ficticia',
  rol: 'secretaria',
  activo: true,
  debeCambiarContrasena: true,
};

function preparar() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  return { cuentas: TestBed.inject(Cuentas), servidor: TestBed.inject(HttpTestingController) };
}

describe('Cuentas (RF-04, RF-08, RF-09)', () => {
  it('lista las cuentas', async () => {
    const { cuentas, servidor } = preparar();
    const resultado = cuentas.listar();
    servidor.expectOne({ method: 'GET', url: '/api/cuentas' }).flush({ cuentas: [cuenta] });
    expect(await resultado).toEqual([cuenta]);
  });

  it('da de alta una secretaría con su temporal y sin rol en el cuerpo', async () => {
    const { cuentas, servidor } = preparar();
    const resultado = cuentas.crearSecretaria('secretaria.ficticia', 'temporal-ficticia-1');
    const peticion = servidor.expectOne({ method: 'POST', url: '/api/cuentas' });
    expect(peticion.request.body).toEqual({
      nombreUsuario: 'secretaria.ficticia',
      contrasenaTemporal: 'temporal-ficticia-1',
    });
    peticion.flush({ cuenta }, { status: 201, statusText: 'Created' });
    expect(await resultado).toEqual(cuenta);
  });

  it('restablece la contraseña de una cuenta', async () => {
    const { cuentas, servidor } = preparar();
    const resultado = cuentas.restablecer(2, 'temporal-ficticia-2');
    const peticion = servidor.expectOne({ method: 'POST', url: '/api/cuentas/2/restablecimiento' });
    expect(peticion.request.body).toEqual({ contrasenaTemporal: 'temporal-ficticia-2' });
    peticion.flush(null, { status: 204, statusText: 'No Content' });
    await resultado;
  });

  it('desactiva una cuenta', async () => {
    const { cuentas, servidor } = preparar();
    const resultado = cuentas.desactivar(2);
    servidor
      .expectOne({ method: 'POST', url: '/api/cuentas/2/desactivacion' })
      .flush(null, { status: 204, statusText: 'No Content' });
    await resultado;
  });
});
