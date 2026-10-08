import { computed, inject, signal } from '@angular/core';

import {
  CHARACTERS,
  CharacterId,
  basePresetId,
  characterDef,
  isCharacterKind,
  normalizePreset,
  presetFromArchetype,
  presetIdFromName,
} from '../core/characters';
import { spriteCropStyle, textureName } from '../core/sprite-style';
import { TextureAsset, decodeImage } from '../core/texture-fit';
import { CharacterPreset } from '../models/character-preset.model';
import { EntityStats } from '../models/level.model';
import { CharacterPresetService } from '../services/character-preset.service';
import { ProjectService } from '../services/project.service';

/**
 * La ventana "Configurar personajes": la biblioteca de presets del proyecto
 * (characters.json) y el borrador que se esta editando.
 *
 * Un preset es un personaje listo para colocar -- su textura, su recorte, su
 * collider y sus caracteristicas -- para no reconfigurar lo mismo en cada
 * entidad. Los arquetipos de core/characters.ts son los de fabrica; esto
 * gestiona los que guarda el proyecto.
 *
 * Es un controlador y no un componente por la misma razon que
 * ItemEditorController: el markup vive en app.html para usar los estilos de
 * App (ver el comentario de cabecera de app.ts).
 */
export class CharactersController {
  private readonly presets = inject(CharacterPresetService);
  private readonly project = inject(ProjectService);

  constructor(
    private readonly note: (message: string) => void,
    private readonly describe: (error: unknown) => string,
    private readonly refreshProject: () => Promise<void>,
    /** Las texturas del proyecto ya decodificadas, para la vista previa. */
    private readonly textures: () => Record<string, TextureAsset>,
    private readonly hasFileSystem: boolean,
  ) {}

  //
  // Personajes con su asset, tamano y caracteristicas, guardados en el
  // proyecto (characters.json) para reutilizarlos en cualquier nivel. La paleta
  // los muestra agrupados por tipo y la ventana "Configurar personajes" los
  // crea y los edita. Colocar uno COPIA sus valores a la entidad, asi que un
  // nivel no depende de characters.json para abrirse ni para jugarse.

  readonly basePresetId = basePresetId;
  readonly characterKinds = CHARACTERS;

  /** Tipo desplegado en la paleta, o null si estan todos plegados. */
  readonly expandedKind = signal<CharacterId | null>(null);

  /** Los tipos base mas los guardados: todo lo que se puede colocar. */
  readonly allPresets = computed<CharacterPreset[]>(() => [
    ...CHARACTERS.map(presetFromArchetype),
    ...this.presets.presets(),
  ]);

  /** Ventana de configuracion abierta: el borrador y, si ya esta guardado, su id. */
  readonly characterEditor = signal<{ draft: CharacterPreset; savedId: string | null } | null>(null);

  /**
   * La imagen COMPLETA de la textura del borrador. Las miniaturas de Recursos
   * vienen reducidas: sirven para reconocer un personaje en la paleta, pero no
   * para ajustar un recorte al pixel.
   */
  readonly editorTexture = signal<{ name: string; dataUrl: string; width: number; height: number } | null>(null);

  /** Primer cuadro del borrador, para la vista previa de la ventana. */
  readonly draftPreviewStyle = computed(() => {
    const editor = this.characterEditor();
    const image = this.editorTexture();
    if (!editor || !image || textureName(editor.draft.texture) !== image.name) {
      return null;
    }
    return spriteCropStyle(image.dataUrl, image.width, image.height, editor.draft.sourceRect, 96);
  });

  toggleKind(kind: CharacterId): void {
    this.expandedKind.update((current) => (current === kind ? null : kind));
  }

  /** Lo que se despliega bajo un tipo en la paleta: el base primero, despues los guardados. */
  presetsOfKind(kind: CharacterId): CharacterPreset[] {
    return this.allPresets().filter((preset) => preset.kind === kind);
  }

  savedPresetsOfKind(kind: CharacterId): CharacterPreset[] {
    return this.presets.presets().filter((preset) => preset.kind === kind);
  }

  kindLabel(kind: CharacterId): string {
    return characterDef(kind)?.label ?? kind;
  }

  kindColor(kind: CharacterId): string {
    return characterDef(kind)?.color ?? '#4772b3';
  }

  kindHint(kind: CharacterId): string {
    return characterDef(kind)?.hint ?? '';
  }

  /** Miniatura de un personaje en la paleta: su primer cuadro, sacado de la miniatura de Recursos. */
  presetSpriteStyle(preset: CharacterPreset): Record<string, string> | null {
    const asset = this.textures()[textureName(preset.texture)];
    return asset && asset.width > 0
      ? spriteCropStyle(asset.dataUrl, asset.width, asset.height, preset.sourceRect, 22)
      : null;
  }

  /** Sin tipo, abre el primer personaje guardado; con tipo, uno nuevo de ese tipo. */
  openCharacterEditor(kind?: CharacterId): void {
    if (kind) {
      this.newCharacterDraft(kind);
      return;
    }
    const first = this.presets.presets()[0];
    if (first) {
      this.editCharacterPreset(first.id);
    } else {
      this.newCharacterDraft('enemy');
    }
  }

  /** Borrador nuevo, arrancando de los valores del tipo base. */
  newCharacterDraft(kind: CharacterId): void {
    const def = characterDef(kind);
    if (!def) {
      return;
    }
    const draft = { ...presetFromArchetype(def), id: '', name: 'Nuevo ' + def.label.toLowerCase() };
    this.characterEditor.set({ draft, savedId: null });
    void this.loadEditorTexture(textureName(draft.texture));
  }

  editCharacterPreset(id: string): void {
    const preset = this.presets.presets().find((candidate) => candidate.id === id);
    if (!preset) {
      return;
    }
    // Copia profunda: editar el borrador no tiene que tocar la lista guardada
    // hasta que se aprete Guardar.
    this.characterEditor.set({ draft: structuredClone(preset), savedId: id });
    void this.loadEditorTexture(textureName(preset.texture));
  }

  closeCharacterEditor(): void {
    this.characterEditor.set(null);
  }

  private updateDraft(change: (draft: CharacterPreset) => CharacterPreset): void {
    this.characterEditor.update((editor) => (editor ? { ...editor, draft: change(editor.draft) } : editor));
  }

  patchCharacterDraft(changes: Partial<CharacterPreset>): void {
    this.updateDraft((draft) => ({ ...draft, ...changes }));
  }

  /** El <select> de tipo devuelve texto: se valida antes de aceptarlo. */
  setCharacterKind(value: string): void {
    if (isCharacterKind(value)) {
      this.patchCharacterDraft({ kind: value });
    }
  }

  patchDraftRect(field: 'x' | 'y' | 'width' | 'height', value: number): void {
    const min = field === 'width' || field === 'height' ? 1 : 0;
    this.updateDraft((draft) => ({ ...draft, sourceRect: { ...draft.sourceRect, [field]: Math.max(min, value) } }));
  }

  setDraftFrames(value: number): void {
    this.patchCharacterDraft({ frames: Math.max(1, Math.round(value) || 1) });
  }

  setDraftFrameDuration(value: number): void {
    this.patchCharacterDraft({ frameDuration: value > 0 ? value : 0.15 });
  }

  setDraftScale(value: number): void {
    this.patchCharacterDraft({ scale: value > 0 ? value : 1 });
  }

  patchDraftCollider(field: 'width' | 'height', value: number): void {
    this.updateDraft((draft) => ({ ...draft, collider: { ...draft.collider, [field]: Math.max(1, value) } }));
  }

  setDraftSolid(solid: boolean): void {
    // undefined y no false: es el default del schema, y asi no ensucia el JSON.
    this.updateDraft((draft) => ({ ...draft, collider: { ...draft.collider, solid: solid || undefined } }));
  }

  patchDraftStats(field: keyof EntityStats, value: number): void {
    this.updateDraft((draft) => ({ ...draft, stats: { ...draft.stats, [field]: Math.max(0, value) } }));
  }

  /** Colision del tamano con que se va a dibujar: el recorte por la escala. */
  fitDraftCollider(): void {
    this.updateDraft((draft) => ({
      ...draft,
      collider: {
        ...draft.collider,
        width: Math.max(1, Math.round(draft.sourceRect.width * draft.scale)),
        height: Math.max(1, Math.round(draft.sourceRect.height * draft.scale)),
      },
    }));
  }

  /**
   * Cambia el asset del borrador. El recorte arranca con la imagen entera
   * partida en tantos cuadros como tenga el personaje, uno al lado del otro,
   * que es como el motor los lee: una tira de 4 cuadros de 128 px de ancho da
   * cuadros de 32.
   */
  async setDraftTexture(name: string): Promise<void> {
    this.patchCharacterDraft({ texture: 'textures/' + name });
    const image = await this.loadEditorTexture(name);
    const draft = this.characterEditor()?.draft;
    if (!image || !draft) {
      return;
    }
    const frames = Math.max(1, draft.frames);
    this.patchCharacterDraft({
      sourceRect: { x: 0, y: 0, width: Math.max(1, Math.floor(image.width / frames)), height: image.height },
    });
  }

  private async loadEditorTexture(name: string) {
    const current = this.editorTexture();
    if (current?.name === name) {
      return current;
    }
    try {
      const data = await this.project.readFileData('assets/textures/' + name);
      if (data.kind !== 'image') {
        return null;
      }
      const image = await decodeImage(data.dataUrl);
      const loaded = { name, dataUrl: data.dataUrl, width: image.naturalWidth, height: image.naturalHeight };
      this.editorTexture.set(loaded);
      return loaded;
    } catch {
      // Sin proyecto abierto o sin esa textura en disco: la ventana sigue
      // andando, solo que sin vista previa.
      return null;
    }
  }

  /** La carpeta del proyecto, deduciendola o preguntandola si nadie abrio una. */
  private async ensureProject(): Promise<boolean> {
    if (this.project.projectRoot()) {
      return true;
    }
    if (!this.hasFileSystem) {
      this.note('Sin acceso a disco. Abre el editor con "npm run electron".');
      return false;
    }
    if (!(await this.project.ensureRoot())) {
      return false;
    }
    await this.refreshProject();
    return true;
  }

  /**
   * Guarda el borrador en characters.json. El id se fija la primera vez, a
   * partir del nombre, y ya no cambia aunque despues se lo renombre: es la
   * referencia que guardan las entidades colocadas ("preset").
   */
  async saveCharacterDraft(): Promise<void> {
    const editor = this.characterEditor();
    if (!editor) {
      return;
    }
    const name = editor.draft.name.trim();
    if (!name) {
      this.note('El personaje necesita un nombre.');
      return;
    }
    if (!(await this.ensureProject())) {
      return;
    }

    const current = this.presets.presets();
    const id = editor.savedId ?? presetIdFromName(name, current.map((preset) => preset.id));
    const saved = normalizePreset({ ...editor.draft, id, name });
    const list = editor.savedId
      ? current.map((preset) => (preset.id === id ? saved : preset))
      : [...current, saved];

    try {
      await this.presets.save(list);
      this.characterEditor.set({ draft: structuredClone(saved), savedId: id });
      this.note('Personaje "' + name + '" guardado. Ya aparece en el panel Personajes para arrastrarlo.');
    } catch (error) {
      this.note('No se pudo guardar el personaje: ' + this.describe(error));
    }
  }

  async deleteCharacterPreset(): Promise<void> {
    const editor = this.characterEditor();
    if (!editor?.savedId) {
      return;
    }
    const confirmed = window.confirm(
      '¿Eliminar el personaje "' + editor.draft.name + '"? Lo que ya está colocado en los niveles no cambia.',
    );
    if (!confirmed) {
      return;
    }
    const list = this.presets.presets().filter((preset) => preset.id !== editor.savedId);
    try {
      await this.presets.save(list);
    } catch (error) {
      this.note('No se pudo eliminar el personaje: ' + this.describe(error));
      return;
    }
    const next = list.find((preset) => preset.kind === editor.draft.kind) ?? list[0];
    if (next) {
      this.editCharacterPreset(next.id);
    } else {
      this.newCharacterDraft(editor.draft.kind);
    }
    this.note('Personaje "' + editor.draft.name + '" eliminado.');
  }

  /** Copia sin guardar: al guardarla recibe su propio id. */
  duplicateCharacterPreset(): void {
    const editor = this.characterEditor();
    if (!editor) {
      return;
    }
    this.characterEditor.set({
      draft: { ...structuredClone(editor.draft), id: '', name: editor.draft.name + ' (copia)' },
      savedId: null,
    });
  }
}
