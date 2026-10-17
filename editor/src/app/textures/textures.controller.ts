import { inject, signal, untracked } from '@angular/core';

import { DEFAULT_FRAME_DURATION, readSpriteFrames } from '../core/sprite-frames';
import { decodeImage, fitTextureSize, renderPng, usesNearestNeighbor, TextureAsset } from '../core/texture-fit';
import { ProjectService } from '../services/project.service';

/**
 * La biblioteca de texturas del proyecto: listarlas y tener sus miniaturas
 * listas.
 *
 * Importar NO esta aca: toda imagen entra por el convertidor
 * (textures/image-converter.controller.ts), que elige archivos sueltos -- nunca
 * una carpeta entera --, los convierte a PNG y los COPIA a assets/textures/ de
 * la carpeta del editor. Cuando termina, llama a reloadLibrary().
 *
 * Elegir una textura para colocar tampoco: eso es arbitrar entre texturas,
 * figuras, objetos y personajes de la paleta, y lo hace App.
 *
 * Es un controlador y no un componente por la misma razon que
 * ItemEditorController: el markup vive en app.html para usar los estilos de
 * App (ver el comentario de cabecera de app.ts).
 */
/** Lado de la miniatura guardada: el doble de lo que se ve, para pantallas de alta densidad. */
const THUMBNAIL_SIDE = 64;

export class TexturesController {
  private readonly project = inject(ProjectService);

  /** Nombres de archivo de assets/textures/. */
  readonly textures = signal<string[]>([]);

  /**
   * Imagen y medidas de cada textura, por nombre de archivo. Sirve para dos
   * cosas: mostrar la miniatura de verdad en el panel Recursos (antes era un
   * cuadrado vacio, y elegir textura era adivinar), y saber el tamano real al
   * soltarla sobre una entidad, para recortarla entera en vez de dejar el
   * recorte viejo.
   *
   * Solo tiene las que ya se pidieron: ver "Miniaturas bajo demanda" abajo.
   */
  readonly textureAssets = signal<Record<string, TextureAsset>>({});

  /**
   * Sube cada vez que se descarta el cache entero (ver invalidate). Lo leen las
   * miniaturas en pantalla (TextureThumbDirective) para volver a pedirse.
   */
  readonly cacheVersion = signal(0);

  /** Texturas pedidas que todavia no terminaron de cargarse. */
  private readonly pending = new Map<string, Promise<TextureAsset | null>>();
  /** Las que no se pudieron leer: no se reintentan hasta el proximo invalidate. */
  private readonly failed = new Set<string>();
  /** De a una por vez: abrir Recursos no dispara cien lecturas de disco juntas. */
  private queue: Promise<unknown> = Promise.resolve();
  /** Una carga de antes de un invalidate() ya no escribe en el cache. */
  private generation = 0;

  constructor(
    /** Relee una carpeta del explorador: las texturas nuevas tienen que aparecer. */
    private readonly reloadDir: (path: string) => Promise<void>,
    /** Despliega un panel de la barra lateral (Recursos, al terminar de importar). */
    private readonly expandPanel: (id: string) => void,
  ) {}

  /**
   * Relee assets/textures/ despues de escribir texturas nuevas: la lista, el
   * explorador y el panel Recursos. La usan el convertidor, la importacion de
   * niveles y la herramienta de sprites; esta ultima con "expand" en false,
   * porque desplegar Recursos le quitaria alto al lienzo.
   */
  async reloadLibrary(expand = true): Promise<void> {
    this.textures.set(await this.project.listTextures());
    // Las que ya estaban no cambiaron (el convertidor y la importacion de
    // niveles nunca pisan una textura; la herramienta de sprites, cuando pisa
    // una, llama antes a invalidate()): solo se olvidan las que ya no estan.
    // Las nuevas se cargan solas cuando aparecen en pantalla.
    const present = new Set(this.textures());
    this.textureAssets.update((state) =>
      Object.fromEntries(Object.entries(state).filter(([name]) => present.has(name))),
    );
    await this.reloadDir('assets/textures');
    // Si Recursos estaba plegado, se despliega: es donde esta el resultado.
    if (expand) {
      this.expandPanel('side-assets');
    }
  }

  // --- Miniaturas bajo demanda -----------------------------------------------
  //
  // Antes, al abrir el proyecto se leian y decodificaban TODAS las texturas
  // (hasta 400), aunque Recursos estuviera plegado o se viera una docena. Ahora
  // cada miniatura se pide cuando su elemento entra en pantalla (ver
  // TextureThumbDirective), y lo que nadie mira no se lee del disco.
  //
  // Lo que se guarda por textura es una miniatura de verdad (64 px de lado, no
  // el data URL completo) y el tamano real de la imagen.

  /** Pide la miniatura de una textura si todavia no esta. No espera. */
  requestThumbnail(name: string): void {
    void this.ensureAsset(name);
  }

  /**
   * La miniatura y el tamano de una textura: la del cache, o la carga. Null si
   * no se pudo leer. La usa quien necesita el tamano aunque la textura no se
   * haya visto todavia (soltarla sobre el viewport).
   */
  ensureAsset(name: string): Promise<TextureAsset | null> {
    const ready = untracked(() => this.textureAssets())[name];
    if (ready) {
      return Promise.resolve(ready);
    }
    if (this.failed.has(name)) {
      return Promise.resolve(null);
    }
    const pending = this.pending.get(name);
    if (pending) {
      return pending;
    }
    const generation = this.generation;
    const job = this.queue.then(() => this.loadAsset(name, generation));
    this.queue = job;
    this.pending.set(name, job);
    return job;
  }

  /**
   * Descarta todas las miniaturas: se abrio el proyecto de nuevo o cambio la
   * carpeta del editor, y una textura con el mismo nombre puede ser otra
   * imagen. Las que estan en pantalla se vuelven a pedir solas.
   */
  invalidate(): void {
    this.generation += 1;
    this.pending.clear();
    this.failed.clear();
    this.textureAssets.set({});
    this.cacheVersion.update((version) => version + 1);
  }

  private async loadAsset(name: string, generation: number): Promise<TextureAsset | null> {
    try {
      if (generation !== this.generation) {
        return null;
      }
      const data = await this.project.readFileData('assets/textures/' + name);
      if (data.kind !== 'image') {
        throw new Error('no es una imagen');
      }
      const image = await decodeImage(data.dataUrl);
      const thumb = fitTextureSize(image.naturalWidth, image.naturalHeight, THUMBNAIL_SIDE);
      // Los cuadros se leen del original: la miniatura es otro PNG y no los trae.
      const strip = readSpriteFrames(data.dataUrl);
      const entry: TextureAsset = {
        dataUrl: thumb.scaled
          ? renderPng(image, thumb, usesNearestNeighbor(image.naturalWidth, thumb))
          : data.dataUrl,
        width: image.naturalWidth,
        height: image.naturalHeight,
        frames: strip?.frames ?? 1,
        frameDuration: strip?.frameDuration ?? DEFAULT_FRAME_DURATION,
      };
      if (generation !== this.generation) {
        return null;
      }
      this.textureAssets.update((state) => ({ ...state, [name]: entry }));
      return entry;
    } catch {
      // Una imagen rota o bloqueada se queda sin miniatura y nada mas: el
      // panel tiene que listar igual el resto de la carpeta.
      if (generation === this.generation) {
        this.failed.add(name);
      }
      return null;
    } finally {
      if (generation === this.generation) {
        this.pending.delete(name);
      }
    }
  }

  onTextureDragStart(event: DragEvent, name: string): void {
    event.dataTransfer?.setData('text/honeycomb-texture', name);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'copy';
    }
  }
}
