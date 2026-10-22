// Builders that mirror the Kotlin constructors (positional args with defaults).
import { Input } from '../js/engine.js';

export const z = { x: 0.1, y: 0.1, w: 0.2, h: 0.2 };
export const item = (id, name) => ({ id, name });

export function thing(id, side, zone, label, text, needs, stuck, gives, o = {}) {
  const code = o.code ?? null;
  const t = {
    id, side, wall: side, zone, label, text, needs, stuck, gives,
    consumes: o.consumes ?? false,
    code, input: o.input ?? 'digits', len: o.len ?? (code === null ? 0 : code.length),
    closeup: o.closeup ?? null, visibleWhen: o.visibleWhen ?? null, search: o.search ?? [], keys: o.keys ?? [],
  };
  Object.defineProperty(t, 'inputType', { get() { return Input.parse(this.input); }, enumerable: false });
  return t;
}

export function exit(side, zone, code, needs, stuck, text, o = {}) {
  const e = {
    side, wall: side, zone, code, needs, stuck, text,
    consumes: o.consumes ?? false, input: o.input ?? 'digits',
    len: o.len ?? (code === null ? 0 : code.length), visibleWhen: o.visibleWhen ?? null,
  };
  Object.defineProperty(e, 'inputType', { get() { return Input.parse(this.input); }, enumerable: false });
  return e;
}

export const combo = (a, b, gives, text, consumes = true) => ({ a, b, gives, text, consumes });

export function room(id, title, task, intro, captions, things, exitObj, o = {}) {
  return {
    id, title, task, intro, captions, things, exit: exitObj,
    difficulty: o.difficulty ?? 1, hints: o.hints ?? [], combos: o.combos ?? [], variants: o.variants ?? [],
  };
}

export const story = (id, lang, title, blurb, intro, outro, rooms, o = {}) => ({
  id, lang, title, blurb, intro, outro, rooms, format: o.format ?? 1, difficulty: o.difficulty ?? 1,
});

export const variant = (side, when, image) => ({ side, wall: side, when, image });
export const cond = (kind, id) => ({ kind, id });
