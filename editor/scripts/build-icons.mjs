// Arma src/app/ui/icons.generated.ts: un sprite SVG con los iconos que usa el
// editor, sacados de lucide-static (licencia ISC). Solo entran los de la lista
// de abajo, asi el bundle no carga los dos mil del paquete.
//
// Uso: node scripts/build-icons.mjs   (desde editor/)
// Para sumar un icono: agregar su nombre de Lucide a ICONS y volver a correrlo.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ICONS = [
  // Barra de herramientas
  'mouse-pointer-2', 'mouse-pointer-square-dashed', 'stamp', 'grid-2x2', 'brick-wall', 'square-dashed', 'route',
  'grid-3x3', 'box-select', 'zoom-in', 'zoom-out', 'scan', 'play',
  'panel-left', 'panel-right', 'panel-bottom', 'layers',
  // Dock inferior y categorias de recursos
  'shapes', 'zap', 'terminal', 'file-text', 'cuboid', 'users', 'package', 'image', 'image-plus',
  // Escena y proyecto
  'list-tree', 'folder', 'folder-open', 'folder-plus', 'file-json', 'file', 'refresh-cw', 'external-link',
  'chevron-right', 'chevron-down',
  // Inspector
  'box', 'map', 'copy', 'trash-2', 'pencil', 'plus', 'x', 'check', 'triangle-alert', 'store',
  // Tipos de entidad
  'user', 'skull', 'message-circle-more', 'gem', 'circle-dashed',
  // Objetos
  'sword', 'heart-plus', 'coins',
  // Formas de ataque
  'move-right', 'circle-dot', 'radar', 'arrow-up-right', 'crosshair', 'bomb',
  // Lienzo y dialogos
  'crown', 'heart-pulse',
  // Herramienta de sprites
  'brush', 'eraser', 'paint-bucket', 'pipette', 'slash', 'square', 'diamond', 'minus', 'undo-2', 'redo-2',
  'file-plus', 'save', 'chevron-left', 'pause', 'arrow-left', 'arrow-right', 'arrow-up', 'arrow-down',
  'arrow-left-right', 'ghost', 'eye', 'eye-off', 'flip-horizontal-2', 'flip-vertical-2',
];

const here = dirname(fileURLToPath(import.meta.url));
const iconDir = join(here, '..', 'node_modules', 'lucide-static', 'icons');
const outFile = join(here, '..', 'src', 'app', 'ui', 'icons.generated.ts');
const version = JSON.parse(readFileSync(join(here, '..', 'node_modules', 'lucide-static', 'package.json'), 'utf8')).version;

const symbols = ICONS.map((name) => {
  const source = readFileSync(join(iconDir, name + '.svg'), 'utf8');
  const body = source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>[\s\S]*$/, '')
    .replace(/\s*\n\s*/g, '')
    .trim();
  return `<symbol id="i-${name}" viewBox="0 0 24 24">${body}</symbol>`;
});

const output = `// Generado por scripts/build-icons.mjs a partir de lucide-static ${version} (ISC,
// https://lucide.dev/license). No editar a mano: agregar el icono a la lista del
// script y volver a correrlo.

export const ICON_NAMES = ${JSON.stringify(ICONS)} as const;

export type IconName = (typeof ICON_NAMES)[number];

export const ICON_SPRITE =
  '<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute" aria-hidden="true">' +
${symbols.map((symbol) => '  ' + JSON.stringify(symbol)).join(' +\n')} +
  '</svg>';
`;

writeFileSync(outFile, output);
console.log(`icons.generated.ts: ${ICONS.length} iconos`);
