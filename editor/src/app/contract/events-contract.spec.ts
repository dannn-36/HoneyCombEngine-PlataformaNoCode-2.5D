/// <reference types="node" />
// Contrato del catalogo de eventos (schema/event_catalog.json): que este bien
// formado, que cada bloque tenga su implementacion en el motor, y que lo que
// arman el panel Eventos y el dialogo de puzzles lleve los parametros que el
// catalogo declara, con su tipo.
//
// Los archivos se leen con node:fs (ver level-contract.spec.ts).

import { TestBed } from '@angular/core/testing';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PUZZLE_KINDS, PuzzleDraft, buildPuzzle } from '../core/puzzles';
import { EventsController } from '../events/events.controller';
import { CatalogEntry, CatalogParamDef, EventCatalog } from '../models/event-catalog.model';
import { EventStep } from '../models/level.model';
import { CatalogService } from '../services/catalog.service';
import { LevelService } from '../services/level.service';
import { ProjectService } from '../services/project.service';

function raizDelRepo(): string {
  let dir = process.cwd();
  while (!existsSync(join(dir, 'schema', 'event_catalog.json'))) {
    const arriba = dirname(dir);
    if (arriba === dir) {
      throw new Error('No se encontro schema/event_catalog.json subiendo desde ' + process.cwd());
    }
    dir = arriba;
  }
  return dir;
}

const RAIZ = raizDelRepo();
const CATALOGO = JSON.parse(readFileSync(join(RAIZ, 'schema', 'event_catalog.json'), 'utf8')) as EventCatalog;
const SECCIONES = ['triggers', 'conditions', 'actions'] as const;
type Seccion = (typeof SECCIONES)[number];

// Los tipos que el formulario dinamico sabe editar (CatalogParamType).
const TIPOS_DE_PARAMETRO = ['entity_ref', 'level_ref', 'zone_ref', 'item_ref', 'variable_ref', 'choice', 'string', 'number', 'boolean'];

/** Los type que registra el motor en engine/game/ (RegisterTrigger, RegisterCondition, RegisterAction). */
function registradosEnMotor(): Record<Seccion, string[]> {
  const registrados: Record<Seccion, Set<string>> = { triggers: new Set(), conditions: new Set(), actions: new Set() };
  const seccionDe = { Trigger: 'triggers', Condition: 'conditions', Action: 'actions' } as const;
  const dir = join(RAIZ, 'engine', 'game');
  for (const archivo of readdirSync(dir).filter((nombre) => nombre.endsWith('.cpp'))) {
    const codigo = readFileSync(join(dir, archivo), 'utf8');
    for (const [, cual, tipo] of codigo.matchAll(/Register(Trigger|Condition|Action)\(\s*"([^"]+)"/g)) {
      registrados[seccionDe[cual as keyof typeof seccionDe]].add(tipo);
    }
  }
  return {
    triggers: [...registrados.triggers].sort(),
    conditions: [...registrados.conditions].sort(),
    actions: [...registrados.actions].sort(),
  };
}

/** null si el valor tiene el tipo que declara el parametro; si no, por que no. */
function problemaDeTipo(param: CatalogParamDef, valor: unknown): string | null {
  switch (param.type) {
    case 'number':
      return typeof valor === 'number' && Number.isFinite(valor) ? null : 'deberia ser un numero: ' + JSON.stringify(valor);
    case 'boolean':
      return typeof valor === 'boolean' ? null : 'deberia ser true o false: ' + JSON.stringify(valor);
    case 'choice':
      return (param.options ?? []).some((opcion) => opcion.value === valor) ? null : 'no es una opcion: ' + JSON.stringify(valor);
    default:
      return typeof valor === 'string' ? null : 'deberia ser un texto: ' + JSON.stringify(valor);
  }
}

/** Los problemas de un paso contra su bloque del catalogo. */
function problemasDelPaso(paso: EventStep, seccion: Seccion): string[] {
  const bloque = CATALOGO[seccion].find((entrada) => entrada.type === paso.type);
  if (!bloque) {
    return [`"${paso.type}" no esta en ${seccion}`];
  }
  return Object.entries(paso.params).flatMap(([clave, valor]) => {
    const param = bloque.params[clave];
    if (!param) {
      return [`"${paso.type}" no declara "${clave}"`];
    }
    const problema = problemaDeTipo(param, valor);
    return problema ? [`${paso.type}.${clave}: ${problema}`] : [];
  });
}

const bloques = (seccion: Seccion) => CATALOGO[seccion].map((entrada) => [seccion, entrada] as [Seccion, CatalogEntry]);
const TODOS = SECCIONES.flatMap(bloques);

describe('contrato del catalogo de eventos', () => {
  describe('forma del catalogo', () => {
    it.each(SECCIONES)('%s tiene bloques y ninguno repite su type', (seccion) => {
      const tipos = CATALOGO[seccion].map((entrada) => entrada.type);
      expect(tipos.length).toBeGreaterThan(0);
      expect(new Set(tipos).size).toBe(tipos.length);
    });

    it.each(TODOS)('%s: %o tiene etiqueta y parametros con un tipo conocido', (_, entrada) => {
      expect(entrada.label).toMatch(/\S/);
      for (const param of Object.values(entrada.params)) {
        expect(TIPOS_DE_PARAMETRO).toContain(param.type);
      }
    });

    it('los parametros choice traen opciones sin repetir', () => {
      const choices = TODOS.flatMap(([, entrada]) => Object.values(entrada.params)).filter((param) => param.type === 'choice');
      expect(choices.length).toBeGreaterThan(0);
      for (const param of choices) {
        const valores = (param.options ?? []).map((opcion) => opcion.value);
        expect(valores.length).toBeGreaterThan(0);
        expect(new Set(valores).size).toBe(valores.length);
      }
    });

    it('cada default tiene el tipo de su parametro', () => {
      for (const [, entrada] of TODOS) {
        for (const [clave, param] of Object.entries(entrada.params)) {
          if (param.default !== undefined) {
            expect(problemaDeTipo(param, param.default), entrada.type + '.' + clave).toBeNull();
          }
        }
      }
    });
  });

  describe('motor', () => {
    const motor = registradosEnMotor();

    it.each(SECCIONES)('cada bloque de %s esta registrado en el motor', (seccion) => {
      const faltan = CATALOGO[seccion].map((entrada) => entrada.type).filter((tipo) => !motor[seccion].includes(tipo));
      expect(faltan).toEqual([]);
    });

    it.each(SECCIONES)('el motor no registra en %s bloques que el catalogo no declara', (seccion) => {
      const declarados = new Set(CATALOGO[seccion].map((entrada) => entrada.type));
      expect(motor[seccion].filter((tipo) => !declarados.has(tipo))).toEqual([]);
    });
  });

  describe('panel Eventos', () => {
    function panel() {
      TestBed.configureTestingModule({
        providers: [{ provide: ProjectService, useValue: {} }],
      });
      TestBed.inject(CatalogService).catalog.set(CATALOGO);
      const nada = () => undefined;
      const eventos = TestBed.runInInjectionContext(() => new EventsController(nada, nada, nada));
      return { eventos, niveles: TestBed.inject(LevelService) };
    }

    it.each(TODOS)('%s: el bloque %o se agrega con todos sus parametros y del tipo declarado', (seccion, entrada) => {
      const { eventos, niveles } = panel();
      eventos.addEvent();
      if (seccion === 'triggers') {
        eventos.changeTrigger(0, entrada.type);
      } else if (seccion === 'conditions') {
        eventos.addCondition(0);
        eventos.changeCondition(0, 0, entrada.type);
      } else {
        eventos.addAction(0);
        eventos.changeAction(0, 0, entrada.type);
      }
      const evento = niveles.level().events[0];
      const paso = seccion === 'triggers' ? evento.trigger : seccion === 'conditions' ? evento.conditions?.[0] : evento.actions[0];
      expect(paso?.type).toBe(entrada.type);
      expect(Object.keys(paso?.params ?? {}).sort()).toEqual(Object.keys(entrada.params).sort());
      expect(problemasDelPaso(paso as EventStep, seccion)).toEqual([]);
    });

    it('un numero escrito en el formulario se guarda como numero', () => {
      const { eventos, niveles } = panel();
      eventos.addEvent();
      eventos.changeTrigger(0, 'on_items_collected');
      eventos.updateStepParam('trigger', 0, 0, 'count', '4');
      eventos.updateStepParam('trigger', 0, 0, 'item', '');
      expect(niveles.level().events[0].trigger.params).toEqual({ item: '', count: 4 });
      // Lo que no es un numero queda en 0, nunca como texto ni NaN (que en JSON seria null).
      eventos.updateStepParam('trigger', 0, 0, 'count', 'muchos');
      expect(niveles.level().events[0].trigger.params['count']).toBe(0);
    });
  });

  describe('puzzles de sala', () => {
    const borrador = (kind: PuzzleDraft['kind'], lockOnEnter: boolean): PuzzleDraft => ({
      kind,
      zone: 'sala_2',
      boss: 'jefe_1',
      item: 'llave',
      count: 2,
      gates: ['puerta_1', 'puerta_2'],
      lockOnEnter,
      message: 'Listo',
    });

    it.each(PUZZLE_KINDS.flatMap((kind) => [[kind.id, true], [kind.id, false]] as const))(
      'un puzzle %s (cerrar al entrar: %s) usa solo bloques y parametros del catalogo',
      (kind, lockOnEnter) => {
        const plan = buildPuzzle(borrador(kind, lockOnEnter));
        const problemas = plan.events.flatMap((evento) => [
          ...problemasDelPaso(evento.trigger, 'triggers'),
          ...(evento.conditions ?? []).flatMap((paso) => problemasDelPaso(paso, 'conditions')),
          ...evento.actions.flatMap((paso) => problemasDelPaso(paso, 'actions')),
        ]);
        expect(problemas).toEqual([]);
        expect(plan.events.every((evento) => evento.actions.length > 0)).toBe(true);
      },
    );
  });
});
