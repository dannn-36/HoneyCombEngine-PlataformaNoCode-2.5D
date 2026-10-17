import { computed, inject, signal } from '@angular/core';

import {
  ConvertFilter,
  ConvertSizeMode,
  FittedSize,
  convertedSize,
  convertsWithNearest,
  decodeImage,
  fitTextureSize,
  renderPng,
  renderPngBase64,
} from '../core/texture-fit';
import type { ConvertSource } from '../electron-api';
import { ProjectService } from '../services/project.service';

/** Lado de la miniatura de cada fila: el doble de lo que se ve, para pantallas de alta densidad. */
const PREVIEW_SIDE = 64;

/**
 * Una imagen de la lista del convertidor.
 *   loading  leyendose del disco
 *   ready    lista para convertir
 *   done     ya escrita en assets/textures/ (con el nombre de "target")
 *   failed   no se pudo leer o escribir; "message" dice por que
 */
export interface ConverterRow {
  index: number;
  source: string;
  target: string;
  format: string;
  bytes: number;
  width: number;
  height: number;
  preview: string | null;
  state: 'loading' | 'ready' | 'done' | 'failed';
  message: string;
}

export interface ImageConverterDeps {
  note: (message: string) => void;
  describe: (error: unknown) => string;
  /** Relee el proyecto si la raiz cambio al elegirla. */
  refreshProject: () => Promise<void>;
  /** Relee assets/textures/ para que las texturas nuevas aparezcan en Recursos. */
  reloadLibrary: () => Promise<void>;
  /** Ancho del tile del nivel abierto: el tope del modo "Ajustar al tile". */
  tileWidth: () => number;
  hasFileSystem: boolean;
}

/**
 * Herramientas > Convertidor de imagenes: lleva archivos PNG, JPG o JPEG a
 * texturas PNG que el motor puede abrir, y las deja en assets/textures/.
 *
 * Es la conversion de Importar texturas (core/texture-fit.ts) con su propia
 * ventana, y existe por los casos que Importar no cubria:
 *   - elegir archivos sueltos, de varias carpetas, en vez de una carpeta entera;
 *   - convertir los JPG que ya se copiaron a mano a assets/textures/: el motor
 *     no los abre (raylib se compila sin JPG), aunque el editor los muestre;
 *   - nombres que el motor no puede abrir ("♡.jpg"): el proceso principal les
 *     da un nombre ASCII (ver safeTextureName en ipc/convert.js);
 *   - elegir el tamano y el filtro en vez de fijarlos al tile.
 *
 * Nunca pisa nada: el original queda donde estaba, y si el nombre PNG ya
 * existe se usa el siguiente libre ("foo-2.png").
 *
 * Controlador y no componente por la misma razon que ItemEditorController: el
 * markup vive en app.html para usar los estilos de App.
 */
export class ImageConverterController {
  private readonly project = inject(ProjectService);

  readonly isOpen = signal(false);
  readonly rows = signal<ConverterRow[]>([]);
  /** Agregando o convirtiendo: los botones se apagan para no lanzar dos a la vez. */
  readonly busy = signal(false);

  readonly sizeMode = signal<ConvertSizeMode>('tile');
  readonly customSide = signal(128);
  readonly filter = signal<ConvertFilter>('auto');

  /** Las que todavia faltan convertir. */
  readonly pending = computed(() => this.rows().filter((row) => row.state === 'ready').length);

  /** El original decodificado de cada fila, por indice del plan. No va en un signal: no se dibuja. */
  private readonly images = new Map<number, HTMLImageElement>();

  constructor(private readonly deps: ImageConverterDeps) {}

  open(): void {
    if (!this.deps.hasFileSystem) {
      this.deps.note('Sin acceso a disco. Abre el editor con "npm run electron".');
      return;
    }
    this.isOpen.set(true);
  }

  /** Abre la ventana y, en el mismo gesto, agrega imagenes. Es lo que hacen las opciones del menu. */
  async openAndAdd(from: ConvertSource): Promise<void> {
    this.open();
    if (this.isOpen()) {
      await this.add(from);
    }
  }

  /** Cierra y olvida la lista. Lo ya convertido queda en el disco. */
  close(): void {
    if (this.busy()) {
      return;
    }
    this.isOpen.set(false);
    this.rows.set([]);
    this.images.clear();
    void this.project.resetConvert().catch(() => undefined);
  }

  /** Agrega imagenes a la lista: elegidas con el dialogo, o los JPG de assets/textures/. */
  async add(from: ConvertSource): Promise<void> {
    if (this.busy()) {
      return;
    }
    this.busy.set(true);
    try {
      const session = await this.project.beginConvert(from);
      if (!session) {
        return; // se cancelo la eleccion de la carpeta del proyecto
      }
      if (session.projectRoot !== this.project.projectRoot()) {
        this.project.projectRoot.set(session.projectRoot);
        await this.deps.refreshProject();
      }
      if (session.canceled) {
        return;
      }
      if (session.items.length === 0) {
        this.deps.note(
          from === 'project-jpg'
            ? 'No hay imágenes JPG o JPEG en assets/textures/ (o ya están en la lista).'
            : 'Esas imágenes ya estaban en la lista.',
        );
        return;
      }

      this.rows.update((rows) => [
        ...rows,
        ...session.items.map((item) => ({
          index: item.index,
          source: item.source,
          target: item.target,
          format: formatOf(item.source),
          bytes: item.size,
          width: 0,
          height: 0,
          preview: null,
          state: 'loading' as const,
          message: '',
        })),
      ]);

      for (const item of session.items) {
        try {
          const image = await decodeImage(await this.project.readConvertImage(item.index));
          this.images.set(item.index, image);
          const thumb = fitTextureSize(image.naturalWidth, image.naturalHeight, PREVIEW_SIDE);
          this.patchRow(item.index, {
            width: image.naturalWidth,
            height: image.naturalHeight,
            preview: renderPng(image, thumb, false),
            state: 'ready',
          });
        } catch (error) {
          this.patchRow(item.index, { state: 'failed', message: this.deps.describe(error) });
        }
      }
    } catch (error) {
      this.deps.note('No se pudieron agregar las imágenes: ' + this.deps.describe(error));
    } finally {
      this.busy.set(false);
    }
  }

  /** Saca una fila de la lista. Lo ya convertido queda en el disco. */
  remove(index: number): void {
    if (this.busy()) {
      return;
    }
    this.images.delete(index);
    this.rows.update((rows) => rows.filter((row) => row.index !== index));
  }

  /** Medidas con que va a quedar una fila, segun el tamano elegido. */
  finalSize(row: ConverterRow): FittedSize {
    return convertedSize(row.width, row.height, this.sizeMode(), this.deps.tileWidth(), this.customSide());
  }

  /** true si el nombre de destino no es el del original con .png (se limpio o estaba ocupado). */
  renamed(row: ConverterRow): boolean {
    return row.target.replace(/\.png$/i, '') !== row.source.replace(/\.[^.]+$/, '');
  }

  setSizeMode(value: string): void {
    if (value === 'tile' || value === 'custom' || value === 'original') {
      this.sizeMode.set(value);
    }
  }

  setFilter(value: string): void {
    if (value === 'auto' || value === 'pixel' || value === 'smooth') {
      this.filter.set(value);
    }
  }

  /** Convierte todas las filas listas y las escribe en assets/textures/. */
  async convert(): Promise<void> {
    if (this.busy() || this.pending() === 0) {
      return;
    }
    this.busy.set(true);
    const report = { converted: 0, copied: 0, renamed: 0, failed: 0 };

    try {
      for (const row of this.rows().filter((candidate) => candidate.state === 'ready')) {
        const image = this.images.get(row.index);
        if (!image) {
          continue;
        }
        try {
          const fitted = this.finalSize(row);
          // Un PNG que ya cumple se copia tal cual: reescribirlo no gana nada
          // y podria perder su perfil de color.
          const needsConversion = fitted.scaled || row.format !== 'PNG';
          const pngBase64 = needsConversion
            ? renderPngBase64(image, fitted, convertsWithNearest(this.filter(), image.naturalWidth, fitted))
            : null;
          const { target } = await this.project.writeConvertedImage(row.index, pngBase64);
          this.patchRow(row.index, {
            target,
            state: 'done',
            message: 'Guardada como ' + target + ' (' + fitted.width + '×' + fitted.height + ')',
          });
          report[needsConversion ? 'converted' : 'copied'] += 1;
          if (this.renamed({ ...row, target })) {
            report.renamed += 1;
          }
        } catch (error) {
          this.patchRow(row.index, { state: 'failed', message: this.deps.describe(error) });
          report.failed += 1;
        }
      }
    } finally {
      this.busy.set(false);
    }

    try {
      await this.deps.reloadLibrary();
    } catch (error) {
      this.deps.note('Se convirtió, pero no se pudo releer assets/textures: ' + this.deps.describe(error));
      return;
    }
    this.deps.note(describeReport(report));
  }

  private patchRow(index: number, changes: Partial<ConverterRow>): void {
    this.rows.update((rows) => rows.map((row) => (row.index === index ? { ...row, ...changes } : row)));
  }
}

/** "PNG" o "JPG" a partir de la extension; es lo que se muestra en la fila. */
function formatOf(fileName: string): string {
  return /\.png$/i.test(fileName) ? 'PNG' : 'JPG';
}

/** Resumen de una conversion para la barra de estado. */
function describeReport(report: { converted: number; copied: number; renamed: number; failed: number }): string {
  const parts: string[] = [];
  if (report.converted > 0) {
    parts.push(report.converted + ' convertidas a PNG');
  }
  if (report.copied > 0) {
    parts.push(report.copied + ' copiadas tal cual (ya cumplían)');
  }
  if (report.renamed > 0) {
    parts.push(report.renamed + ' con nombre nuevo');
  }
  if (report.failed > 0) {
    parts.push(report.failed + ' con error');
  }
  return 'Convertidor: ' + (parts.length > 0 ? parts.join('; ') : 'nada que convertir') + '.';
}
