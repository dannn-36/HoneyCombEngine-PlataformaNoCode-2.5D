import { inject, signal } from '@angular/core';

import {
  decodeImage,
  fitTextureSize,
  renderPng,
  renderPngBase64,
  usesNearestNeighbor,
  TextureAsset,
} from '../core/texture-fit';
import { SHAPE_TEXTURE } from '../core/iso-shapes';
import type { ImportSession } from '../electron-api';
import { ProjectService } from '../services/project.service';

/**
 * La biblioteca de texturas del proyecto: listarlas, importarlas y tener sus
 * miniaturas listas.
 *
 * Importar COPIA las imagenes dentro de assets/textures/ y las ajusta de
 * tamano: el motor dibuja cada sprite al tamano de su recorte, asi que una
 * captura de 2377x1837 px ocuparia decenas de celdas. El ajuste se hace aca y
 * no en el proceso principal porque hay que decodificar la imagen, y el
 * navegador abre PNG, JPG, GIF, WebP y BMP mientras que el nativeImage de
 * Electron solo garantiza PNG y JPG (ver ipc/import.js).
 *
 * Elegir una textura para colocar NO esta aca: eso es arbitrar entre texturas,
 * figuras, objetos y personajes de la paleta, y lo hace App.
 *
 * Es un controlador y no un componente por la misma razon que
 * ItemEditorController: el markup vive en app.html para usar los estilos de
 * App (ver el comentario de cabecera de app.ts).
 */
/**
 * Cuantas texturas se procesan para el panel Recursos. Las miniaturas se
 * guardan reducidas, asi que el tope ya no es por memoria sino por tiempo de
 * carga; las que lo pasan se siguen listando por nombre y se usan igual.
 */
const TEXTURE_THUMBNAIL_LIMIT = 400;
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
   */
  readonly textureAssets = signal<Record<string, TextureAsset>>({});

  /** Hay una importacion en curso; el boton se apaga para no lanzar dos juntas. */
  readonly importing = signal(false);

  /** Numero de la pasada de miniaturas vigente. Ver loadTextureThumbnails(). */
  private thumbnailRun = 0;

  constructor(
    private readonly note: (message: string) => void,
    private readonly describe: (error: unknown) => string,
    private readonly refreshProject: () => Promise<void>,
    /** Relee una carpeta del explorador: las texturas nuevas tienen que aparecer. */
    private readonly reloadDir: (path: string) => Promise<void>,
    /** Despliega un panel de la barra lateral (Recursos, al terminar de importar). */
    private readonly expandPanel: (id: string) => void,
    /** El tile del nivel, que es la medida a la que se ajustan las imagenes. */
    private readonly tileSize: () => { tileWidth: number; tileHeight: number },
    private readonly hasFileSystem: boolean,
  ) {}

  async importTextures(): Promise<void> {
    if (!this.hasFileSystem) {
      this.note('Sin acceso a disco. Abre el editor con "npm run electron".');
      return;
    }
    if (this.importing()) {
      return;
    }

    let session: ImportSession | null = null;
    try {
      session = await this.project.beginImport();
    } catch (error) {
      this.note('No se pudo empezar a importar: ' + this.describe(error));
      return;
    }
    if (!session) {
      return; // se cancelo la eleccion de la carpeta del proyecto
    }
    if (session.projectRoot !== this.project.projectRoot()) {
      this.project.projectRoot.set(session.projectRoot);
      await this.refreshProject();
    }
    if (session.canceled) {
      return;
    }

    // El limite es el ancho de tile del nivel abierto: es la casilla dentro de
    // la cual tiene que verse el sprite.
    const maxSide = this.tileSize().tileWidth;
    const report = { copied: 0, converted: 0, kept: 0, failed: [] as string[] };
    this.importing.set(true);

    try {
      for (const [index, item] of session.items.entries()) {
        this.note('Importando ' + (index + 1) + '/' + session.items.length + ': ' + item.source);
        // El sheet de figuras no se toca nunca, aunque venga en la carpeta: es
        // un spritesheet de 262 px a proposito, y "ajustarlo" a un tile
        // romperia el recorte de cada figura en el juego.
        if (item.status === 'exists' || 'textures/' + item.target === SHAPE_TEXTURE) {
          report.kept += 1;
          continue;
        }
        try {
          const image = await decodeImage(await this.project.readImportImage(index));
          const fitted = fitTextureSize(image.naturalWidth, image.naturalHeight, maxSide);
          const needsConversion = fitted.scaled || !/\.png$/i.test(item.source);

          // Una copia vieja que ya cumplia los requisitos no gana nada
          // reescribiendose: queda como esta.
          if (item.status === 'stale' && !needsConversion) {
            report.kept += 1;
            continue;
          }

          const pngBase64 = needsConversion
            ? renderPngBase64(image, fitted, usesNearestNeighbor(image.naturalWidth, fitted))
            : null;
          const { written } = await this.project.writeImportedTexture(index, pngBase64);
          if (!written) {
            report.kept += 1;
          } else if (needsConversion) {
            report.converted += 1;
          } else {
            report.copied += 1;
          }
        } catch {
          // Una imagen rota no corta la importacion del resto; queda en el
          // informe final con su nombre.
          report.failed.push(item.source);
        }
      }
    } finally {
      this.importing.set(false);
    }

    try {
      this.textures.set(await this.project.listTextures());
      void this.loadTextureThumbnails();
      await this.reloadDir('assets/textures');
      // Si Recursos estaba plegado, se despliega: es donde esta el resultado.
      this.expandPanel('side-assets');
      this.note(this.describeImport(report, session.items.length, maxSide));
    } catch (error) {
      this.note('Se importo, pero no se pudo releer assets/textures: ' + this.describe(error));
    }
  }

  /** Resumen de una importacion para la barra de estado. */
  private describeImport(
    report: { copied: number; converted: number; kept: number; failed: string[] },
    total: number,
    maxSide: number,
  ): string {
    if (total === 0) {
      return 'Esa carpeta no tiene imagenes.';
    }
    const parts: string[] = [];
    if (report.converted > 0) {
      parts.push(report.converted + ' ajustadas a ' + maxSide + ' px y guardadas como PNG');
    }
    if (report.copied > 0) {
      parts.push(report.copied + ' copiadas tal cual (ya cumplian)');
    }
    if (report.kept > 0) {
      parts.push(report.kept + ' ya estaban y no se tocaron');
    }
    if (report.failed.length > 0) {
      const names = report.failed.slice(0, 3).join(', ') + (report.failed.length > 3 ? '…' : '');
      parts.push(report.failed.length + ' no se pudieron leer (' + names + ')');
    }
    return 'Importacion: ' + parts.join('; ') + '.';
  }

  /**
   * Arma las miniaturas del panel Recursos y guarda el tamano real de cada
   * textura, que es el que se usa al soltarla sobre una entidad.
   *
   * Tres cosas hacian que el panel se quedara en cuadros vacios con una
   * carpeta de capturas, y las tres cambiaron:
   *   - como "miniatura" se guardaba el data URL COMPLETO de cada imagen;
   *     ahora se guarda una version reducida de verdad;
   *   - el panel se actualizaba recien al terminar TODAS; ahora cada miniatura
   *     aparece apenas esta lista;
   *   - solo se procesaban las primeras 80.
   *
   * "run" corta una pasada vieja si arranca otra (por ejemplo, al terminar una
   * importacion mientras todavia cargaban las del proyecto): sin eso, las dos
   * escribirian el mismo signal intercaladas.
   */
  /**
   * Decodifica las texturas y guarda su miniatura. Lo llama App al abrir el
   * proyecto, sin await: las miniaturas van apareciendo solas y abrir el
   * proyecto no espera a que se procese una carpeta de 150 imagenes.
   */
  async loadTextureThumbnails(): Promise<void> {
    const run = ++this.thumbnailRun;

    for (const name of this.textures().slice(0, TEXTURE_THUMBNAIL_LIMIT)) {
      try {
        const data = await this.project.readFileData('assets/textures/' + name);
        if (run !== this.thumbnailRun) {
          return;
        }
        if (data.kind !== 'image') {
          continue;
        }
        const image = await decodeImage(data.dataUrl);
        const thumb = fitTextureSize(image.naturalWidth, image.naturalHeight, THUMBNAIL_SIDE);
        const entry = {
          dataUrl: thumb.scaled
            ? renderPng(image, thumb, usesNearestNeighbor(image.naturalWidth, thumb))
            : data.dataUrl,
          width: image.naturalWidth,
          height: image.naturalHeight,
        };
        if (run !== this.thumbnailRun) {
          return;
        }
        this.textureAssets.update((state) => ({ ...state, [name]: entry }));
      } catch {
        // Una imagen rota o bloqueada se queda sin miniatura y nada mas: el
        // panel tiene que listar igual el resto de la carpeta.
      }
    }

    // Se olvidan las de texturas que ya no estan en la carpeta.
    const present = new Set(this.textures());
    this.textureAssets.update((state) =>
      Object.fromEntries(Object.entries(state).filter(([name]) => present.has(name))),
    );
  }

  onTextureDragStart(event: DragEvent, name: string): void {
    event.dataTransfer?.setData('text/honeycomb-texture', name);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'copy';
    }
  }

  /**
   * Suelta una textura en el viewport. Sobre una entidad le cambia el arte;
   * sobre una celda vacia crea una entidad nueva con esa textura, igual que
   * arrastrar una figura.
   *
   * El recorte se rehace con el tamano real de la imagen: conservar el anterior
   * (16x16 por defecto) mostraria apenas la esquina de un sprite mas grande.
   */
}
