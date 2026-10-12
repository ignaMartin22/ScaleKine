import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { PASO_POR_CODIGO_DE_ERROR, RUTA_POR_PASO } from '../sesion/modelo';
import { Sesion } from '../sesion/sesion';
import { aErrorApi } from './error-api';

/**
 * Las peticiones a la API viajan con la cookie de sesión. Frontend y API comparten origen, así que
 * la cookie `SameSite=Strict` se envía igual; `withCredentials` lo deja explícito.
 */
export const conCredenciales: HttpInterceptorFn = (peticion, siguiente) =>
  siguiente(
    peticion.url.startsWith('/api/') ? peticion.clone({ withCredentials: true }) : peticion,
  );

/**
 * Convierte toda respuesta de error en un `ErrorApi`. Un 401 significa que la sesión venció o fue
 * revocada: se olvida la sesión del cliente y se vuelve al ingreso con un aviso (RF-11). Un 403 por
 * paso pendiente (`debe_*`) indica un estado desactualizado: se vuelve a pedir la sesión y se lleva
 * a la pantalla del paso.
 */
export const erroresDeApi: HttpInterceptorFn = (peticion, siguiente) => {
  const sesion = inject(Sesion);
  const router = inject(Router);

  return siguiente(peticion).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse)) return throwError(() => error);
      if (error.status === 401 && peticion.url !== '/api/sesion') {
        sesion.vencer();
        void router.navigateByUrl('/ingresar');
      }
      const errorApi = aErrorApi(error);
      const paso = error.status === 403 ? PASO_POR_CODIGO_DE_ERROR[errorApi.codigo] : undefined;
      if (paso) void sesion.recargar().then(() => router.navigateByUrl(RUTA_POR_PASO[paso]));
      return throwError(() => errorApi);
    }),
  );
};
