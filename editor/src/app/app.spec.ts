// Pruebas del componente raiz.
//
// Son pruebas de humo: que el editor entero se construya -- todos sus
// controladores, en el orden en que App los declara -- y que pinte su barra
// superior. No reemplazan a las pruebas de core/, que son las que miran la
// logica; lo que atrapan es un editor que ya no arranca.

import { TestBed } from '@angular/core/testing';
import { App } from './app';

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
