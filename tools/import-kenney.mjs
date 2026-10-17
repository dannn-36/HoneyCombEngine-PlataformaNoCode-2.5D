// =============================================================================
// Importa los packs "Isometric Miniature" de Kenney (CC0) a la carpeta del editor
// =============================================================================
//
// Packs: Dungeon, Farm, Library y Bases, de https://kenney.nl (licencia CC0:
// uso libre, sin pedir permiso; el credito a Kenney es voluntario).
//
// Que hace:
//   1. Copia la vista ISOMETRICA de cada pieza (sus cuatro orientaciones,
//      _N _E _S _W) a <destino>/textures/, con un prefijo por tipo para que en
//      Recursos > Texturas queden agrupadas:
//        suelo_  muro_  techo_  estructura_  objeto_  naturaleza_  base_  personaje_
//      seguido del pack en castellano y el nombre original:
//        muro_mazmorra_stoneWallDoor_S.png
//   2. Arma el personaje: Kenney trae cada cuadro de animacion en un archivo
//      aparte, y el motor anima con los cuadros UNO AL LADO DEL OTRO en una sola
//      textura (ver "frames" en schema/level.schema.json). Por cada direccion
//      (d0 a d7) deja una tira: quieto (1 cuadro), corre (10), recoge (10).
//   3. Copia las licencias a <destino>/licencias/.
//
// Las piezas miden 256 px de ancho por casilla; en una grilla de 64x32 se usan
// con escala 0.25.
//
// Uso:
//   node tools/import-kenney.mjs --src <carpeta con dungeon/ farm/ library/ bases/> --dest <assets del editor>
// Necesita ffmpeg en el PATH para armar las tiras del personaje.
// =============================================================================

import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, value, index, all) => {
    if (value.startsWith('--')) pairs.push([value.slice(2), all[index + 1]]);
    return pairs;
  }, []),
);
if (!args.src || !args.dest) {
  console.error('Uso: node tools/import-kenney.mjs --src <packs extraidos> --dest <assets del editor>');
  process.exit(1);
}

// Cada pack: carpeta de origen, nombre en castellano y como se clasifica cada
// pieza por su nombre. Gana la primera regla que coincide.
const PACKS = [
  {
    dir: 'dungeon',
    name: 'mazmorra',
    rules: [
      ['estructura', /^(stairs|bridge|stoneSide|stoneLeft|stoneRight|stoneCorner|stoneStep)/],
      ['muro', /^(stoneWall|stoneColumn|woodenSupport)/],
      ['suelo', /^(dirt|planks|stone)/],
      ['objeto', /./],
    ],
  },
  {
    dir: 'farm',
    name: 'granja',
    rules: [
      ['techo', /^roof/],
      ['muro', /^(woodWall|chimney)/],
      ['estructura', /^(planksHigh|planksSide|planksCorner|fence|ladder)/],
      ['naturaleza', /^corn/],
      ['suelo', /^(dirt|planks)/],
      ['objeto', /./],
    ],
  },
  {
    dir: 'library',
    name: 'biblioteca',
    rules: [
      ['muro', /^wall/],
      ['suelo', /^floorCarpet/],
      ['objeto', /./],
    ],
  },
  {
    dir: 'bases',
    name: 'bases',
    rename: (base) => base.replace(/^base_/, 'redonda_').replace(/^square_/, 'cuadrada_'),
    rules: [['base', /./]],
  },
];

const textures = join(args.dest, 'textures');
const licenses = join(args.dest, 'licencias');
mkdirSync(textures, { recursive: true });
mkdirSync(licenses, { recursive: true });

const counts = {};
for (const pack of PACKS) {
  const source = join(args.src, pack.dir, 'Isometric');
  for (const file of readdirSync(source).filter((name) => name.endsWith('.png'))) {
    const match = /^(.*?)(_[NESW])?\.png$/.exec(file);
    const piece = match[1];
    const type = pack.rules.find(([, pattern]) => pattern.test(piece))[0];
    const name = (pack.rename ? pack.rename(piece) : piece) + (match[2] ?? '');
    copyFileSync(join(source, file), join(textures, `${type}_${pack.name}_${name}.png`));
    counts[type] = (counts[type] ?? 0) + 1;
  }
  const license = join(args.src, pack.dir, 'License.txt');
  if (existsSync(license)) copyFileSync(license, join(licenses, `kenney_${pack.dir}.txt`));
}

// Personaje: tiras horizontales por animacion y direccion.
const characterDir = join(args.src, 'dungeon', 'Characters', 'Male');
const ANIMATIONS = [
  ['Idle', 'quieto'],
  ['Run', 'corre'],
  ['Pickup', 'recoge'],
];
for (let direction = 0; direction < 8; direction += 1) {
  for (const [source, label] of ANIMATIONS) {
    const frames = readdirSync(characterDir)
      .filter((file) => new RegExp(`^Male_${direction}_${source}(\\d+)\\.png$`).test(file))
      .sort((a, b) => Number(/(\d+)\.png$/.exec(a)[1]) - Number(/(\d+)\.png$/.exec(b)[1]));
    if (frames.length === 0) continue;
    const out = join(textures, `personaje_aventurero_${label}_d${direction}.png`);
    if (frames.length === 1) {
      copyFileSync(join(characterDir, frames[0]), out);
    } else {
      const inputs = frames.flatMap((file) => ['-i', join(characterDir, file)]);
      const result = spawnSync(
        'ffmpeg',
        // -pix_fmt rgba: los cuadros vienen con paleta (pal8) y la transparencia
        // en ella; sin pedirlo, hstack los junta en rgb24 y el fondo sale opaco.
        ['-loglevel', 'error', '-y', ...inputs, '-filter_complex', `hstack=inputs=${frames.length}`, '-pix_fmt', 'rgba', out],
        { stdio: 'inherit' },
      );
      if (result.status !== 0) {
        console.error('ffmpeg fallo armando ' + out + ' (hace falta ffmpeg en el PATH)');
        process.exit(1);
      }
    }
    counts.personaje = (counts.personaje ?? 0) + 1;
  }
}

console.log('Texturas en ' + textures);
for (const [type, count] of Object.entries(counts)) console.log('  ' + type.padEnd(11) + count);
console.log('Licencias en ' + licenses);
