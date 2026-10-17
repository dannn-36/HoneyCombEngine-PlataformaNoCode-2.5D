// Configuracion de arranque de Angular: los servicios globales que van a estar
// disponibles en toda la aplicacion. Se la consume una sola vez, desde main.ts.
//
// Los servicios propios del editor (ProjectService, LevelService,
// CatalogService) NO se listan aca: usan { providedIn: 'root' }, que los
// registra solos.

import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';

// Sin router: el editor es una sola pantalla con docks fijos y no navega. El
// router estaba configurado "por si acaso" con la tabla de rutas vacia, y aun
// asi sumaba ~70 kB al bundle (el router y la parte de rxjs que arrastra).
//
// Si algun dia hace falta una segunda pantalla, se vuelve a agregar aca:
//   provideRouter(routes, withHashLocation())
// con withHashLocation() porque bajo Electron la app se sirve desde file://,
// donde las rutas por path no resuelven contra un servidor.
export const appConfig: ApplicationConfig = {
  providers: [
    // Engancha los errores no capturados de la UI para que lleguen a la consola
    // en vez de perderse en silencio.
    provideBrowserGlobalErrorListeners(),
  ],
};
