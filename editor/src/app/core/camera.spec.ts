import { CAMERA_ZOOM_MAX, CAMERA_ZOOM_MIN, DEFAULT_CAMERA, cameraOf, sanitizeCamera } from './camera';

describe('cameraOf', () => {
  it('un nivel sin camara tiene la de siempre: fija y con zoom 1', () => {
    expect(cameraOf({})).toEqual(DEFAULT_CAMERA);
    expect(cameraOf({}).mode).toBe('fixed');
    expect(cameraOf({}).zoom).toBe(1);
  });

  it('completa lo que falta con los valores por defecto del motor', () => {
    expect(cameraOf({ camera: { mode: 'follow', zoom: 2 } })).toEqual({
      mode: 'follow',
      zoom: 2,
      smoothing: 0.15,
      deadzone: { width: 0, height: 0 },
      clampToLevel: true,
    });
  });
});

describe('sanitizeCamera', () => {
  it('lleva el zoom, el suavizado y la zona muerta a rango, como el loader del motor', () => {
    const camera = sanitizeCamera({ mode: 'follow', zoom: 100, smoothing: -1, deadzone: { width: -5, height: 30 } });
    expect(camera.zoom).toBe(CAMERA_ZOOM_MAX);
    expect(camera.smoothing).toBe(0);
    expect(camera.deadzone).toEqual({ width: 0, height: 30 });
    expect(sanitizeCamera({ mode: 'fixed', zoom: 0 }).zoom).toBe(CAMERA_ZOOM_MIN);
  });

  it('nunca deja un NaN: en JSON seria null y el motor no cargaria el nivel', () => {
    const camera = sanitizeCamera({ mode: 'follow', zoom: NaN, smoothing: Infinity, deadzone: { width: NaN, height: 10 } });
    expect(camera.zoom).toBe(DEFAULT_CAMERA.zoom);
    expect(camera.smoothing).toBe(DEFAULT_CAMERA.smoothing);
    expect(camera.deadzone.width).toBe(0);
    expect(JSON.stringify(camera)).not.toContain('null');
  });

  it('cualquier modo que no sea "follow" es fijo, como en el motor', () => {
    expect(sanitizeCamera({ mode: 'Follow' as 'follow' }).mode).toBe('fixed');
  });
});
