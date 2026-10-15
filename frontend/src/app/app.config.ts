import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import {
  type ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { routes } from './app.routes';
import { conCredenciales, erroresDeApi } from './nucleo/http/interceptores';
import { TiempoReal } from './nucleo/tiempo-real/tiempo-real';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withFetch(), withInterceptors([conCredenciales, erroresDeApi])),
    // Instancia el cliente de tiempo real: conecta y desconecta según la sesión.
    provideAppInitializer(() => void inject(TiempoReal)),
  ],
};
