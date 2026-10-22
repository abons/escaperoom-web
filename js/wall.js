// One wall of a room: 3:4 box, plate or placeholder, tap zones in fractions, swipe to turn.
import { h, reducedMotion } from './ui.js';

const SWIPE = 80;
const SLOP = 16;
/** Turning slides sideways (the Myst turn); same duration as on Android (`WallView.SLIDE_MS`). */
const SLIDE_MS = 280;
const SIDES = ['north', 'east', 'south', 'west'];
const reduced = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
/** How long the look line stays before it fades (decision: docs/besluiten/kijkregel.md in the app repo). */
const LOOK_MS = 3500;
/** The ◎ flash: two pulses in this time (Android `WallView.FLASH_MS`). */
export const FLASH_MS = 1600;
/** A tap this far (px) outside a zone still hits the nearest one (Android `WallView.TAP_SLOP_DP`). */
const TAP_SLOP = 12;

/**
 * Wall: .el is the 3:4 box (CSS sizes it to fit its container).
 * Callbacks: onTurn(step), onThing(thing), onExit().
 */
export class Wall {
  constructor() {
    this.onTurn = () => {};
    this.onThing = () => {};
    this.onExit = () => {};
    /** A tap on a further door of the room (not the main exit): ../escaperoom/docs/besluiten/deuren.md. */
    this.onDoor = () => {};
    /** Further doors (visible ones), tappable like the exit; tags [{door, text}] say where a door leads. */
    this.more = [];
    this.tags = [];
    this.onMiss = () => {};
    this.room = null;
    this.side = null;
    this.src = null;
    this.things = [];
    this.exitOn = true;
    this.flashing = false;
    this.flashTimer = 0;
    /** Thing ids the ◎ draws as opened (thin dashed line); null = the plain flash. */
    this.flashDone = null;
    /** Misses beside every zone since this wall was shown; a turn or another room starts again at 0. */
    this.missesHere = 0;
    this.fadeTimer = 0;
    this.imgLayer = h('div', { class: 'wall-imgs' });
    this.placeholder = h('div', { class: 'wall-ph' });
    this.zonesEl = h('div', { class: 'wall-zones' });
    this.fbEl = h('div', { class: 'wall-fb' });
    this.lookEl = h('div', { class: 'wall-look', 'aria-live': 'polite' });
    this.lookTimer = 0;
    this.el = h('div', { class: 'wall' }, this.placeholder, this.imgLayer, this.zonesEl, this.lookEl, this.fbEl);

    let down = null;
    this.el.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
    this.el.addEventListener('pointercancel', () => { down = null; });
    this.el.addEventListener('pointerup', (e) => {
      if (!down) return;
      const dx = e.clientX - down.x;
      const dy = e.clientY - down.y;
      down = null;
      if (Math.abs(dx) > SWIPE && Math.abs(dx) > 1.5 * Math.abs(dy)) this.onTurn(dx < 0 ? 1 : -1); // a clear sideways fling only
      else if (Math.abs(dx) <= SLOP && Math.abs(dy) <= SLOP) this.tap(e.clientX, e.clientY);
    });
  }

  /**
   * Show a wall. A turn to another wall of the same room slides sideways: right turn, the new wall comes in
   * from the right; left turn, from the left. A changed plate on the same wall (a variant) cross-fades.
   * Reduced motion: a cut.
   */
  show({ room, side, src, things, exitVisible, wallName, caption }) {
    const same = this.room === room;
    const old = this.src;
    const oldSide = this.side;
    // a refresh of the same wall (say() after every tap) keeps the tap feedback and the look line running
    if (!same || side !== this.side) { this.endLook(true); this.fbEl.textContent = ''; }
    if (!same || side !== this.side) { this.missesHere = 0; clearTimeout(this.flashTimer); this.flashing = false; this.flashDone = null; }
    this.room = room; this.side = side; this.things = things; this.exitOn = exitVisible;
    this.wallName = wallName; this.caption = caption;
    if (src !== old || !same || !this.imgLayer.firstChild) {
      const diff = (SIDES.indexOf(side) - SIDES.indexOf(oldSide) + 4) % 4;
      const dir = same && oldSide && oldSide !== side ? (diff === 1 ? 1 : diff === 3 ? -1 : 0) : 0;
      this.setImage(src, same && !!old && !!src, dir);
    }
    this.el.dataset.side = side;
    this.el.classList.toggle('has-plate', !!src);
    this.src = src;
    this.drawPlaceholder();
    this.drawDots();
    this.drawZones();
  }

  /** The room's further doors and the door tags ("→ Het magazijn · gehaald ✓"); call after show(). */
  doors(more, tags) {
    this.more = more || [];
    this.tags = tags || [];
    if (!this.tagsEl) { this.tagsEl = h('div', { class: 'wall-tags', 'aria-hidden': 'true' }); this.el.insertBefore(this.tagsEl, this.lookEl); }
    this.tagsEl.textContent = '';
    for (const { door, text } of this.tags) {
      if (door.side !== this.side || !text) continue;
      const z = door.zone;
      this.tagsEl.append(h('span', { class: 'door-tag', style: { left: (z.x + z.w / 2) * 100 + '%', top: z.y * 100 + '%' } }, text));
    }
    this.drawZones();
  }

  /** Which of the four walls this is, as ●○○○ at the top of the plate (north first, clockwise); docs/besluiten/muur-benoemen.md in the app repo. */
  drawDots() {
    if (!this.dotsEl) { this.dotsEl = h('div', { class: 'wall-dots', 'aria-hidden': 'true' }); this.el.append(this.dotsEl); }
    this.dotsEl.textContent = '';
    for (const s of SIDES) this.dotsEl.append(h('span', { class: s === this.side ? 'on' : '' }));
  }

  setImage(src, fade, dir = 0) {
    clearTimeout(this.fadeTimer);
    const layer = this.imgLayer;
    this.slideToken = (this.slideToken || 0) + 1;
    for (const a of this.slides || []) a.cancel();
    this.slides = [];
    if (!src) { layer.textContent = ''; return; }
    const img = h('img', { class: 'wall-img', src, alt: '', draggable: 'false' });
    if (fade && dir !== 0 && layer.firstChild && img.animate) {
      if (reduced()) { layer.textContent = ''; layer.append(img); return; } // a cut
      this.slide(layer, img, dir);
    } else if (fade && layer.firstChild) {
      img.style.opacity = '0';
      layer.append(img);
      void img.offsetWidth;
      img.style.opacity = '1';
      this.fadeTimer = setTimeout(() => { while (layer.children.length > 1) layer.firstChild.remove(); }, 260);
    } else {
      layer.textContent = '';
      layer.append(img);
    }
  }

  /** The old wall slides out against the turn and darkens; the new one slides in from the turn side. */
  slide(layer, img, dir) {
    while (layer.children.length > 1) layer.firstChild.remove(); // a turn mid-slide: keep only the newest
    const prev = layer.lastChild;
    prev.classList.add('sliding');
    img.classList.add('sliding');
    img.style.transform = `translateX(${dir * 100}%)`; // parked beside the box until decoded
    layer.append(img);
    const token = this.slideToken;
    let started = false;
    const go = () => {
      if (started || token !== this.slideToken) return;
      started = true;
      const opts = { duration: SLIDE_MS, easing: 'cubic-bezier(.15,.75,.35,1)' }; // decelerate
      const a = prev.animate([
        { transform: 'translateX(0)', filter: 'brightness(1)' },
        { transform: `translateX(${-dir * 100}%)`, filter: 'brightness(.55)' },
      ], opts);
      const b = img.animate([
        { transform: `translateX(${dir * 100}%)`, filter: 'brightness(.7)' },
        { transform: 'translateX(0)', filter: 'brightness(1)' },
      ], opts);
      img.style.transform = '';
      this.slides = [a, b];
      b.onfinish = () => {
        if (token !== this.slideToken) return;
        prev.remove(); img.classList.remove('sliding'); this.slides = [];
      };
    };
    // app.js decodes the room's walls ahead, so this resolves at once; never wait long for it
    if (img.decode) { img.decode().then(go, go); setTimeout(go, 150); } else go();
  }

  drawPlaceholder() {
    this.placeholder.textContent = '';
    if (this.src) return;
    this.placeholder.append(h('div', { class: 'wall-ph-title' }, this.wallName || ''));
    if (this.caption) this.placeholder.append(h('div', { class: 'wall-ph-cap' }, this.caption));
  }

  /** The look line: `text` as a band over the foot of the plate for LOOK_MS, then it fades; a tap ends it sooner. */
  look(text) {
    if (!text || !this.src) return; // the placeholder already prints the caption
    clearTimeout(this.lookTimer);
    this.lookEl.textContent = text;
    this.lookEl.classList.remove('now');
    this.lookEl.classList.add('on');
    this.lookTimer = setTimeout(() => this.endLook(), LOOK_MS);
  }

  /** Fade the look line out; `now` drops it without the fade (a turn to another wall). */
  endLook(now = false) {
    clearTimeout(this.lookTimer);
    this.lookEl.classList.toggle('now', now);
    this.lookEl.classList.remove('on');
  }

  zoneList() {
    const out = [];
    for (const th of this.things) if (th.side === this.side) out.push({ z: th.zone, label: th.label || '', id: th.id });
    const ex = this.room && this.room.exit;
    if (this.exitOn && ex && ex.side === this.side) out.push({ z: ex.zone, label: '' });
    for (const d of this.more || []) if (d.side === this.side) out.push({ z: d.zone, label: '' });
    return out;
  }

  drawZones() {
    this.zonesEl.textContent = '';
    const show = !this.src || this.flashing;
    this.zonesEl.classList.toggle('flash', this.flashing);
    this.zonesEl.classList.toggle('pulse', this.flashing && !!this.flashDone);
    if (!show) return;
    for (const { z, label, id } of this.zoneList()) {
      const d = h('div', {
        class: this.flashing && this.flashDone && id && this.flashDone.has(id) ? 'zone done' : 'zone',
        style: { left: z.x * 100 + '%', top: z.y * 100 + '%', width: z.w * 100 + '%', height: z.h * 100 + '%' },
      }, !this.src ? label : '');
      this.zonesEl.append(d);
    }
  }

  /** Light up every zone of the current wall for a moment. */
  flashZones() {
    this.flashing = true;
    this.drawZones();
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => { this.flashing = false; this.drawZones(); }, 1500);
  }

  /** The ◎: things in `done` (a Set of ids) get a thin dashed line, the rest fill + bold edge, pulsing twice (CSS). */
  flashSpots(done) {
    this.flashing = true;
    this.flashDone = new Set(done);
    this.drawZones();
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => { this.flashing = false; this.flashDone = null; this.drawZones(); }, FLASH_MS);
  }

  /** The zone nearest to (fx, fy) within TAP_SLOP px of the box `r`, as { th, z } (th null for the exit). */
  near(fx, fy, r) {
    const cands = this.things.filter((x) => x.side === this.side).map((th) => ({ th, z: th.zone }));
    const ex = this.room.exit;
    if (this.exitOn && ex.side === this.side) cands.push({ th: null, z: ex.zone });
    for (const d of this.more || []) if (d.side === this.side) cands.push({ th: null, door: d, z: d.zone });
    let best = null; let bestD = Infinity;
    for (const c of cands) {
      const z = c.z;
      const dx = Math.max(z.x - fx, 0, fx - (z.x + z.w)) * r.width;
      const dy = Math.max(z.y - fy, 0, fy - (z.y + z.h)) * r.height;
      const d = Math.hypot(dx, dy);
      if (d <= TAP_SLOP && d < bestD) { bestD = d; best = c; }
    }
    return best;
  }

  tap(cx, cy) {
    if (!this.room) return;
    const r = this.el.getBoundingClientRect();
    const fx = (cx - r.left) / r.width;
    const fy = (cy - r.top) / r.height;
    if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return;
    this.endLook(); // any tap on the plate ends the look line; a miss brings it back
    const inZone = (z) => fx >= z.x && fx <= z.x + z.w && fy >= z.y && fy <= z.y + z.h;
    const th = this.things.find((x) => x.side === this.side && inZone(x.zone));
    if (th) { this.feedback(th.zone); this.onThing(th); return; }
    const ex = this.room.exit;
    if (this.exitOn && ex.side === this.side && inZone(ex.zone)) { this.feedback(ex.zone); this.onExit(); return; }
    const door = (this.more || []).find((d) => d.side === this.side && inZone(d.zone));
    if (door) { this.feedback(door.zone); this.onDoor(door); return; }
    const nb = this.near(fx, fy, r);
    if (nb) { this.feedback(nb.z); if (nb.th) this.onThing(nb.th); else if (nb.door) this.onDoor(nb.door); else this.onExit(); return; }
    this.missesHere++;
    this.feedback(null, fx, fy);
    this.onMiss(fx, fy);
  }

  /** Tap feedback: a filled highlight plus outline over the hit zone `z`, or (no zone) a widening ring at the miss. Off with reduced motion. */
  feedback(z, fx = 0, fy = 0) {
    this.fbEl.textContent = '';
    if (reducedMotion()) return;
    const style = z
      ? { left: z.x * 100 + '%', top: z.y * 100 + '%', width: z.w * 100 + '%', height: z.h * 100 + '%' }
      : { left: fx * 100 + '%', top: fy * 100 + '%' };
    const d = h('div', { class: z ? 'tap-glow' : 'tap-ring', style });
    d.addEventListener('animationend', () => d.remove());
    this.fbEl.append(d);
  }
}
