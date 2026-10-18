import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SafeHtml } from '@angular/platform-browser';

import { JsonViewController } from '../debug/json-view.controller';
import { LevelEntity } from '../models/level.model';
import { LevelService } from '../services/level.service';
import { ProjectService } from '../services/project.service';
import { SelectionService } from '../services/selection.service';
import { Cell, IconSprite } from '../ui/icon';
import { ICON_SPRITE } from '../ui/icons.generated';

// Seguridad del renderer: texto de un nivel que llega a la pantalla.
//
// Un nivel es un JSON que puede venir de cualquier lado (se importa de otra
// carpeta, se edita a mano), asi que nombres, ids y tipos de entidad son datos
// no confiables. Angular escapa la interpolacion y sanitiza [innerHTML], pero
// hay dos lugares donde el editor se saltea el sanitizador a proposito
// (bypassSecurityTrustHtml): la pestaña JSON (debug/json-view.controller.ts) y
// el sprite de iconos (ui/icon.ts). Aca se prueba que lo que se dibuja ahi no
// se vuelve HTML activo.

/** Textos con las formas tipicas de inyectar HTML o scripts. */
const CARGAS = [
  '<img src=x onerror=alert(1)>',
  '<script>alert(1)</script>',
  '"><svg onload=alert(1)>',
  "</span><a href='javascript:alert(1)'>clic</a>",
  '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
  '&lt;img src=x onerror=alert(1)&gt;',
];

/** Lo que el DOM tiene de peligroso: etiquetas activas o atributos on*. */
function activos(root: HTMLElement): string[] {
  const encontrados: string[] = [];
  for (const el of Array.from(root.querySelectorAll('*'))) {
    const tag = el.tagName.toLowerCase();
    if (
      ['script', 'img', 'iframe', 'a', 'object', 'embed', 'foreignobject', 'svg', 'style'].includes(
        tag,
      )
    ) {
      encontrados.push(tag);
    }
    for (const attr of Array.from(el.attributes)) {
      // Un "javascript:" solo es peligroso donde el navegador lo navega o lo
      // carga; en un value o un title es texto.
      const esUrl = /^(href|xlink:href|src|action|formaction|srcdoc)$/i.test(attr.name);
      if (/^on/i.test(attr.name) || (esUrl && /javascript:/i.test(attr.value))) {
        encontrados.push(`${tag}[${attr.name}]`);
      }
    }
  }
  return encontrados;
}

@Component({
  selector: 'app-json-host',
  template: `<pre class="fileview jsonview" [innerHTML]="html()"></pre>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class JsonHost {
  readonly html = input<SafeHtml | null>(null);
}

@Component({
  selector: 'app-name-host',
  template: `<span class="tree__label">{{ name() }}</span>
    <option [value]="name()">{{ name() }}</option>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class NameHost {
  readonly name = input('');
}

@Component({
  selector: 'app-cell-host',
  imports: [Cell],
  template: `<svg [hcCell]="type()"></svg>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class CellHost {
  readonly type = input('');
}

function entity(id: string, type: string): LevelEntity {
  return {
    id,
    type,
    position: { col: 1, row: 1 },
    texture: 'textures/' + id + '.png',
    sourceRect: { x: 0, y: 0, width: 16, height: 16 },
  };
}

describe('seguridad: texto del nivel en la interfaz', () => {
  let levels: LevelService;
  let selection: SelectionService;
  let json: JsonViewController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [{ provide: ProjectService, useValue: {} }] });
    levels = TestBed.inject(LevelService);
    selection = TestBed.inject(SelectionService);
    json = TestBed.runInInjectionContext(() => new JsonViewController(() => undefined));
  });

  function renderJson(): HTMLElement {
    const fixture = TestBed.createComponent(JsonHost);
    fixture.componentRef.setInput('html', json.html());
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('la pestaña JSON muestra como texto un nivel con nombre, ids y tipos maliciosos', () => {
    levels.createNew(CARGAS[0]);
    for (const [i, carga] of CARGAS.entries()) {
      levels.addEntity(entity(`e${i}${carga}`, carga));
    }
    const root = renderJson();

    expect(activos(root)).toEqual([]);
    // Lo unico que agrega highlightJson son sus <span class="j-...">.
    for (const el of Array.from(root.querySelectorAll('pre *'))) {
      expect(el.tagName).toBe('SPAN');
      expect(el.getAttribute('class')).toMatch(/^j-(key|str|num|lit)$/);
    }
    // Y el texto que se ve es exactamente el JSON, cargas incluidas.
    expect(root.textContent).toBe(json.text());
    for (const carga of CARGAS) {
      expect(root.textContent).toContain(JSON.stringify(carga).slice(1, -1));
    }
  });

  it('la pestaña JSON de la seleccion tampoco deja pasar html', () => {
    levels.createNew('ok');
    levels.addEntity(entity('<script>alert(1)</script>', '<img src=x onerror=alert(1)>'));
    selection.selectEntities(['<script>alert(1)</script>']);
    json.scope.set('seleccion');
    const root = renderJson();
    expect(activos(root)).toEqual([]);
    expect(root.textContent).toContain('<script>alert(1)</script>');
  });

  it('la interpolacion de nombres (arbol, desplegables) los muestra como texto', () => {
    const fixture = TestBed.createComponent(NameHost);
    for (const carga of CARGAS) {
      fixture.componentRef.setInput('name', carga);
      fixture.detectChanges();
      const root = fixture.nativeElement as HTMLElement;
      expect(activos(root)).toEqual([]);
      expect(root.querySelector('.tree__label')?.textContent).toBe(carga);
    }
  });

  it('un tipo de entidad malicioso no cambia el icono al que apunta la celda', () => {
    const fixture = TestBed.createComponent(CellHost);
    for (const carga of [...CARGAS, 'javascript:alert(1)', '#i-x" onload="alert(1)']) {
      fixture.componentRef.setInput('type', carga);
      fixture.detectChanges();
      const use = (fixture.nativeElement as HTMLElement).querySelector('use');
      expect(use?.getAttribute('href')).toMatch(/^#i-[a-z0-9-]+$/);
      expect(activos(fixture.nativeElement as HTMLElement).filter((a) => a !== 'svg')).toEqual([]);
    }
  });
});

describe('seguridad: el sprite de iconos que se saltea el sanitizador', () => {
  it('es contenido fijo sin scripts, manejadores ni referencias externas', () => {
    expect(ICON_SPRITE).not.toMatch(/<script|<foreignObject|<iframe|<image|javascript:/i);
    expect(ICON_SPRITE).not.toMatch(/\son[a-z]+\s*=/i);
    expect(ICON_SPRITE).not.toMatch(/(href|src)\s*=\s*["']?(https?:|\/\/|data:)/i);
  });

  it('se dibuja solo con simbolos svg', () => {
    const fixture = TestBed.createComponent(IconSprite);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const tags = new Set(
      Array.from(root.querySelectorAll('*')).map((el) => el.tagName.toLowerCase()),
    );
    for (const tag of tags) {
      expect([
        'div',
        'svg',
        'symbol',
        'path',
        'circle',
        'rect',
        'line',
        'polyline',
        'polygon',
        'ellipse',
        'g',
        'defs',
      ]).toContain(tag);
    }
  });
});
