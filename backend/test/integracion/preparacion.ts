import { afterAll, beforeEach } from 'vitest';
import { cerrarConexiones, vaciarBase } from './base.js';
import { reiniciarFabricas } from './fabricas.js';

beforeEach(async () => {
  await vaciarBase();
  reiniciarFabricas();
});

afterAll(async () => {
  await cerrarConexiones();
});
