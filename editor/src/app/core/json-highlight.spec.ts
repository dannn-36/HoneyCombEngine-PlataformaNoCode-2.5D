import { highlightJson } from './json-highlight';

/** Lo que se ve en pantalla: el HTML sin etiquetas y con las entidades resueltas. */
function visibleText(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

describe('highlightJson', () => {
  it('marca claves, textos, numeros y literales', () => {
    const html = highlightJson('{"id": "player_1", "col": -2.5, "solid": true, "x": null}');
    expect(html).toContain('<span class="j-key">&quot;id&quot;</span>:');
    expect(html).toContain('<span class="j-str">&quot;player_1&quot;</span>');
    expect(html).toContain('<span class="j-num">-2.5</span>');
    expect(html).toContain('<span class="j-lit">true</span>');
    expect(html).toContain('<span class="j-lit">null</span>');
  });

  it('los numeros dentro de un texto siguen siendo texto', () => {
    expect(highlightJson('"enemy_12"')).toBe('<span class="j-str">&quot;enemy_12&quot;</span>');
  });

  it('escapa el contenido: un id con etiquetas no se vuelve HTML', () => {
    const html = highlightJson('{"id": "<img src=x onerror=alert(1)>"}');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('no cambia el texto que se ve, comillas escapadas incluidas', () => {
    const json = JSON.stringify({ name: 'dice "hola"', list: [1, 2e3, false] }, null, 2);
    expect(visibleText(highlightJson(json))).toBe(json);
  });
});
