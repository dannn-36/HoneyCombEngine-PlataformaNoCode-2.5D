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
});
