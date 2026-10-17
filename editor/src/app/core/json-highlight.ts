// Colores para leer un JSON: claves, textos, numeros y true/false/null, cada
// uno en un <span> con su clase (ver .jsonview en app.scss).
//
// Devuelve HTML, y es SEGURO meterlo con innerHTML: todo el texto del JSON
// pasa por escapeHtml antes de salir, y lo unico que se agrega son los <span>
// de aca. Un id de entidad como "<b>" sale como texto, no como etiqueta.

/** Un token de JSON: un texto (con ":" despues si es clave), un literal o un numero. */
const TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function span(kind: string, text: string): string {
  return '<span class="j-' + kind + '">' + escapeHtml(text) + '</span>';
}

/** El JSON con cada token envuelto en su span. El texto que se ve es exactamente el mismo. */
export function highlightJson(json: string): string {
  let html = '';
  let last = 0;
  for (const match of json.matchAll(TOKEN)) {
    const [token, string, colon] = match;
    const index = match.index ?? 0;
    html += escapeHtml(json.slice(last, index));
    if (string !== undefined) {
      html += colon ? span('key', string) + escapeHtml(colon) : span('str', string);
    } else {
      html += span(/^[tfn]/.test(token) ? 'lit' : 'num', token);
    }
    last = index + token.length;
  }
  return html + escapeHtml(json.slice(last));
}
