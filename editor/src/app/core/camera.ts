// =============================================================================
// Camara del runtime: valores por defecto y rangos
// =============================================================================
//
// Espejo de CameraSettings y CameraSystem (engine/systems/camera/). El editor
// no simula la camara, solo la configura; pero los valores por defecto y los
// rangos tienen que ser los MISMOS que usa el motor, o el panel mostraria un
// zoom que el runtime despues recorta sin avisar. Si cambian alla, cambian
// aca.

import { CameraConfig, Level } from '../models/level.model';

export const CAMERA_ZOOM_MIN = 0.25;
export const CAMERA_ZOOM_MAX = 8;
export const CAMERA_SMOOTHING_MAX = 2;

/** Una camara con todos sus campos resueltos. */
export interface ResolvedCamera {
  mode: 'fixed' | 'follow';
  zoom: number;
  smoothing: number;
  deadzone: { width: number; height: number };
  clampToLevel: boolean;
}

/**
 * La camara de un nivel que no declara "camera": la de siempre, fija y con
 * zoom 1. Los demas valores son los que toma el motor cuando el bloque existe
 * pero no los trae.
 */
export const DEFAULT_CAMERA: ResolvedCamera = {
  mode: 'fixed',
  zoom: 1,
  smoothing: 0.15,
  deadzone: { width: 0, height: 0 },
  clampToLevel: true,
};

/** La camara de un nivel tal como la va a leer el motor: faltantes completados y todo en rango. */
export function cameraOf(level: Pick<Level, 'camera'>): ResolvedCamera {
  return sanitizeCamera({ ...DEFAULT_CAMERA, ...level.camera });
}

/**
 * Lleva una camara a rango, igual que el loader del motor.
 *
 * Ademas reemplaza lo que no sea un numero finito por su valor por defecto.
 * El motor no necesita ese caso y el editor si: un NaN -- de una cuenta, de un
 * campo leido sin el helper num() -- se guarda en JSON como null, y el loader
 * del motor no acepta null en un campo numerico. El nivel dejaria de cargar.
 */
export function sanitizeCamera(camera: CameraConfig): ResolvedCamera {
  const finite = (value: number | undefined, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
  const deadzone = camera.deadzone ?? DEFAULT_CAMERA.deadzone;
  return {
    mode: camera.mode === 'follow' ? 'follow' : 'fixed',
    zoom: clamp(finite(camera.zoom, DEFAULT_CAMERA.zoom), CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX),
    smoothing: clamp(finite(camera.smoothing, DEFAULT_CAMERA.smoothing), 0, CAMERA_SMOOTHING_MAX),
    deadzone: {
      width: Math.max(0, finite(deadzone.width, 0)),
      height: Math.max(0, finite(deadzone.height, 0)),
    },
    clampToLevel: camera.clampToLevel !== false,
  };
}
