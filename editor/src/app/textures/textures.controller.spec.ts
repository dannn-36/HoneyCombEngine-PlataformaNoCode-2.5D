import { TestBed } from '@angular/core/testing';

import type { ProjectFileData } from '../electron-api';
import { ProjectService } from '../services/project.service';
import { TexturesController } from './textures.controller';

// La carga de miniaturas bajo demanda: que no se lea dos veces lo mismo, que lo
// roto no se reintente sin fin, y que invalidate() deje volver a pedir. Se
// prueba con archivos que no son imagen: jsdom no decodifica imagenes, y lo
// que importa aca es cuando se toca el disco, no el dibujo.
describe('TexturesController (miniaturas bajo demanda)', () => {
  let reads: string[];
  let tex: TexturesController;

  beforeEach(() => {
    reads = [];
    const project = {
      readFileData: async (path: string): Promise<ProjectFileData> => {
        reads.push(path);
        return { kind: 'binary', size: 0, reason: 'unsupported' };
      },
    };
    TestBed.configureTestingModule({ providers: [{ provide: ProjectService, useValue: project }] });
    tex = TestBed.runInInjectionContext(
      () => new TexturesController(async () => undefined, () => undefined),
    );
  });

  it('no lee nada hasta que se pide', () => {
    expect(reads).toEqual([]);
  });

  it('dos pedidos de la misma textura comparten una sola lectura', async () => {
    const [a, b] = await Promise.all([tex.ensureAsset('foo.png'), tex.ensureAsset('foo.png')]);
    expect(a).toBeNull();
    expect(b).toBeNull();
    expect(reads).toEqual(['assets/textures/foo.png']);
  });

  it('una textura que no se pudo leer no se vuelve a leer', async () => {
    await tex.ensureAsset('rota.png');
    await tex.ensureAsset('rota.png');
    expect(reads).toEqual(['assets/textures/rota.png']);
  });

  it('invalidate() olvida los fallos y avisa a las miniaturas en pantalla', async () => {
    await tex.ensureAsset('rota.png');
    const version = tex.cacheVersion();
    tex.invalidate();
    expect(tex.cacheVersion()).toBe(version + 1);
    await tex.ensureAsset('rota.png');
    expect(reads).toEqual(['assets/textures/rota.png', 'assets/textures/rota.png']);
  });
});
