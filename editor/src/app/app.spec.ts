// Pruebas del componente raiz.
//
// Son pruebas de humo: que el editor entero se construya -- todos sus
// controladores, en el orden en que App los declara -- y que pinte su barra
// superior. No reemplazan a las pruebas de core/, que son las que miran la
// logica; lo que atrapan es un editor que ya no arranca.

import { TestBed } from '@angular/core/testing';
import { App } from './app';
import type { GameExportResult } from './electron-api';
import { LevelChangedOnDiskError, ProjectService } from './services/project.service';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
    })
      .compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render the brand in the top bar', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.brand__name')?.textContent).toContain('HoneyComb');
  });

  // Los dialogos grandes son componentes aparte que se cargan con @defer la
  // primera vez que se abren (ver dialogs/dialog-base.ts). Esto comprueba que
  // cada uno llegue a dibujarse con los controladores de App: si el token
  // EDITOR_HOST o un nombre expuesto se rompe, el dialogo no aparece.
  const dialogs: [string, string, (app: App) => void][] = [
    ['grilla del mapa', 'room-dialog-title', (app) => app.map.openRoomDialog()],
    [
      'tunel',
      'tunnel-dialog-title',
      (app) =>
        app.map.tunnelDraft.set({ editId: null, from: '', to: '', width: 1, fromSide: '', toSide: '', path: [] }),
    ],
    ['personajes', 'chars-title', (app) => app.chars.openCharacterEditor()],
    ['objetos y armas', 'items-title', (app) => app.itemEditor.open()],
    ['pasar a otro nivel', 'transition-title', (app) => app.transition.openTransitionDialog()],
    ['convertidor', 'converter-title', (app) => app.converter.isOpen.set(true)],
    ['puzzle de sala', 'puzzle-title', (app) => app.puzzle.open()],
    // No es un dialogo pero se carga igual, con @defer, al pasar a Sprites.
    ['herramienta de sprites', 'sprite-start-title', (app) => app.setCenterMode('sprites')],
  ];

  describe('cambios sin guardar', () => {
    afterEach(() => vi.restoreAllMocks());

    const editor = () => TestBed.createComponent(App).componentInstance;

    it('nuevo nivel con cambios pregunta, y cancelar no abre el dialogo', () => {
      const app = editor();
      app.dirty.set(true);
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      app.proj.newLevel();
      expect(confirm).toHaveBeenCalledOnce();
      expect(app.proj.showNewLevelDialog()).toBe(false);
    });

    it('nuevo nivel con cambios, aceptando perderlos, abre el dialogo', () => {
      const app = editor();
      app.dirty.set(true);
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      app.proj.newLevel();
      expect(app.proj.showNewLevelDialog()).toBe(true);
    });

    it('sin cambios no pregunta nada', () => {
      const app = editor();
      const confirm = vi.spyOn(window, 'confirm');
      app.proj.newLevel();
      expect(confirm).not.toHaveBeenCalled();
      expect(app.proj.showNewLevelDialog()).toBe(true);
    });

    it('elegir otro nivel con cambios y cancelar deja el nivel abierto y el desplegable como estaba', async () => {
      const app = editor();
      app.levels.fileName.set('actual.json');
      const before = app.levels.level();
      app.dirty.set(true);
      vi.spyOn(window, 'confirm').mockReturnValue(false);

      const select = document.createElement('select');
      for (const value of ['actual.json', 'otro.json']) {
        select.append(new Option(value, value));
      }
      select.value = 'otro.json';
      await app.pickLevel({ target: select } as unknown as Event);

      expect(app.levels.level()).toBe(before);
      expect(app.dirty()).toBe(true);
      expect(select.value).toBe('actual.json');
    });

    it('cerrar la ventana con cambios en el nivel cancela la salida (main.js pregunta)', () => {
      const app = editor();
      app.dirty.set(true);
      const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
      app.onBeforeUnload(event);
      expect(event.defaultPrevented).toBe(true);
    });

    // Guardar con un disco de mentira: lo que importa es que pasa con la marca
    // de "sin guardar" cuando se edita MIENTRAS se escribe.
    function editorQueGuarda(duranteLaEscritura: (app: App) => void) {
      const app = editor();
      (app.proj as unknown as { hasFileSystem: boolean }).hasFileSystem = true;
      vi.spyOn(TestBed.inject(ProjectService), 'listLevels').mockResolvedValue(['nivel.json']);
      vi.spyOn(app.explorer, 'reloadDir').mockResolvedValue();
      vi.spyOn(app.levels, 'save').mockImplementation(async () => duranteLaEscritura(app));
      app.levels.fileName.set('nivel.json');
      app.dirty.set(true);
      return app;
    }

    it('guardar sin editar en el medio apaga la marca de sin guardar', async () => {
      const app = editorQueGuarda(() => undefined);
      await app.proj.save();
      expect(app.dirty()).toBe(false);
    });

    it('un cambio hecho mientras se escribe el archivo deja la marca de sin guardar', async () => {
      const app = editorQueGuarda((a) => {
        a.levels.updateGrid({ width: 12 });
        a.dirty.set(true);
      });
      await app.proj.save();
      expect(app.dirty()).toBe(true);
    });

    // El archivo cambio en el disco por fuera: el primer intento falla sin escribir.
    function editorConConflicto() {
      const app = editorQueGuarda(() => undefined);
      const save = vi.mocked(app.levels.save);
      save.mockImplementation(async (options) => {
        if (!options?.overwrite) throw new LevelChangedOnDiskError('levels/nivel.json');
      });
      return { app, save };
    }

    it('si el archivo cambio en el disco pregunta, y cancelar no lo pisa', async () => {
      const { app, save } = editorConConflicto();
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      await app.proj.save();
      expect(confirm).toHaveBeenCalledOnce();
      expect(save).toHaveBeenCalledTimes(1);
      expect(app.dirty()).toBe(true);
    });

    it('si el archivo cambio en el disco y se elige reemplazar, se guarda', async () => {
      const { app, save } = editorConConflicto();
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      await app.proj.save();
      expect(save).toHaveBeenLastCalledWith({ overwrite: true });
      expect(app.dirty()).toBe(false);
    });

    it('cerrar la ventana sin cambios no la frena', () => {
      const app = editor();
      const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
      app.onBeforeUnload(event);
      expect(event.defaultPrevented).toBe(false);
    });
  });

  describe('exportar juego', () => {
    afterEach(() => vi.restoreAllMocks());

    // Un editor "de escritorio" con un nivel abierto y guardado; exportGame del
    // servicio contesta lo que diga cada prueba.
    function editorQueExporta(...answers: GameExportResult[]) {
      const app = TestBed.createComponent(App).componentInstance;
      (app.proj as unknown as { hasFileSystem: boolean }).hasFileSystem = true;
      app.levels.fileName.set('inicio.json');
      const project = TestBed.inject(ProjectService);
      const exportGame = vi.spyOn(project, 'exportGame');
      for (const answer of answers) exportGame.mockResolvedValueOnce(answer);
      const reveal = vi.spyOn(project, 'revealExport').mockResolvedValue();
      return { app, exportGame, reveal };
    }
    const lastNotes = (app: App) => app.log().join('\n');

    it('pregunta antes, y exporta desde el nivel abierto si game.json no dice otro', async () => {
      const { app, exportGame } = editorQueExporta({ ok: true, folder: 'D:/J/Mi juego', files: 9, zipBytes: 1 });
      const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(true).mockReturnValueOnce(false);
      await app.proj.exportGame();
      expect(confirm.mock.calls[0][0]).toContain('inicio.json');
      expect(exportGame).toHaveBeenCalledWith('inicio.json');
      expect(lastNotes(app)).toContain('Juego exportado en D:/J/Mi juego');
    });

    it('cancelar la pregunta no exporta nada', async () => {
      const { app, exportGame } = editorQueExporta();
      vi.spyOn(window, 'confirm').mockReturnValue(false);
      await app.proj.exportGame();
      expect(exportGame).not.toHaveBeenCalled();
    });

    it('muestra los avisos de lo que le falta al juego', async () => {
      const warnings = ['levels/a.json usa assets/x.png, que no está', 'game.json usa assets/y.png, que no está'];
      const { app } = editorQueExporta({ ok: true, folder: 'D:/J', files: 3, zipBytes: 1, warnings });
      vi.spyOn(window, 'confirm').mockReturnValueOnce(true).mockReturnValueOnce(false);
      await app.proj.exportGame();
      expect(lastNotes(app)).toContain('Aviso: levels/a.json usa assets/x.png');
      expect(lastNotes(app)).toContain('Aviso: game.json usa assets/y.png');
    });

    it('al terminar ofrece abrir la carpeta', async () => {
      const { app, reveal } = editorQueExporta({ ok: true, folder: 'D:/J', files: 3, zipBytes: 1 });
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      await app.proj.exportGame();
      expect(reveal).toHaveBeenCalledOnce();
    });

    it('sin motor Release ofrece compilarlo y despues exporta sin volver a preguntar', async () => {
      const { app, exportGame } = editorQueExporta(
        { ok: false, missing: true, error: 'sin motor' },
        { ok: true, folder: 'D:/J', files: 3, zipBytes: 1 },
      );
      const build = vi.spyOn(app.engine, 'build').mockResolvedValue(true);
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
      await app.proj.exportGame();
      expect(build).toHaveBeenCalledWith('release');
      expect(exportGame).toHaveBeenCalledTimes(2);
      // Exportar, compilar y abrir la carpeta: el "exportar?" no se repite.
      expect(confirm).toHaveBeenCalledTimes(3);
    });

    it('un error de la exportacion se muestra en la consola', async () => {
      const { app } = editorQueExporta({ ok: false, error: 'Ya existe una carpeta "Mi juego" que no es una exportación' });
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      await app.proj.exportGame();
      expect(lastNotes(app)).toContain('No se pudo exportar el juego: Ya existe una carpeta');
    });

    it('con cambios sin guardar guarda antes, y si no se guarda no exporta', async () => {
      const { app, exportGame } = editorQueExporta();
      app.dirty.set(true);
      vi.spyOn(app.proj, 'save').mockResolvedValue();
      await app.proj.exportGame();
      expect(exportGame).not.toHaveBeenCalled();
      expect(lastNotes(app)).toContain('Guarda el nivel antes de exportar');
    });
  });

  for (const [name, titleId, open] of dialogs) {
    it(`carga y dibuja el dialogo diferido de ${name}`, async () => {
      const fixture = TestBed.createComponent(App);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.querySelector('#' + titleId)).toBeNull();

      open(fixture.componentInstance);
      await fixture.whenStable();

      expect(compiled.querySelector('#' + titleId)).not.toBeNull();
    });
  }
});
