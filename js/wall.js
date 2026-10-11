// One wall of a room: 3:4 box, plate or placeholder, tap zones in fractions, swipe to turn.
import { h } from './ui.js';

const SWIPE = 80;
const SLOP = 16;

/**
 * Wall: .el is the 3:4 box (CSS sizes it to fit its container).
 * Callbacks: onTurn(step), onThing(thing), onExit().
 */
export class Wall {
  constructor() {
    this.onTurn = () => {};
    this.onThing = () => {};
    this.onExit = () => {};
    this.room = null;
    this.side = null;
    this.src = null;
    this.things = [];
    this.exitOn = true;
    this.flashing = false;
    this.flashTimer = 0;
    this.fadeTimer = 0;
    this.imgLayer = h('div', { class: 'wall-imgs' });
    this.placeholder = h('div', { class: 'wall-ph' });
    this.zonesEl = h('div', { class: 'wall-zones' });
    this.el = h('div', { class: 'wall' }, this.placeholder, this.imgLayer, this.zonesEl);

    let down = null;
    this.el.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
    this.el.addEventListener('pointercancel', () => { down = null; });
    this.el.addEventListener('pointerup', (e) => {
      if (!down) return;
      const dx = e.clientX - down.x;
      const dy = e.clientY - down.y;
      down = null;
      if (Math.abs(dx) > SWIPE) this.onTurn(dx < 0 ? 1 : -1);
      else if (Math.abs(dx) <= SLOP && Math.abs(dy) <= SLOP) this.tap(e.clientX, e.clientY);
    });
  }

  /** Show a wall; a changed plate on the same wall cross-fades. */
  show({ room, side, src, things, exitVisible, wallName, caption }) {
    const same = this.room === room && this.side === side;
    const old = this.src;
    this.room = room; this.side = side; this.things = things; this.exitOn = exitVisible;
    this.wallName = wallName; this.caption = caption;
    if (src !== old || !same || !this.imgLayer.firstChild) this.setImage(src, same && !!old && !!src);
    this.el.dataset.side = side;
    this.el.classList.toggle('has-plate', !!src);
    this.src = src;
    this.drawPlaceholder();
    this.drawZones();
  }

  setImage(src, fade) {
    clearTimeout(this.fadeTimer);
    const layer = this.imgLayer;
    if (!src) { layer.textContent = ''; return; }
    const img = h('img', { class: 'wall-img', src, alt: '', draggable: 'false' });
    if (fade && layer.firstChild) {
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

  drawPlaceholder() {
    this.placeholder.textContent = '';
    if (this.src) return;
    this.placeholder.append(h('div', { class: 'wall-ph-title' }, this.wallName || ''));
    if (this.caption) this.placeholder.append(h('div', { class: 'wall-ph-cap' }, this.caption));
  }

  zoneList() {
    const out = [];
    for (const th of this.things) if (th.side === this.side) out.push({ z: th.zone, label: th.label || '' });
    const ex = this.room && this.room.exit;
    if (this.exitOn && ex && ex.side === this.side) out.push({ z: ex.zone, label: '' });
    return out;
  }

  drawZones() {
    this.zonesEl.textContent = '';
    const show = !this.src || this.flashing;
    this.zonesEl.classList.toggle('flash', this.flashing);
    if (!show) return;
    for (const { z, label } of this.zoneList()) {
      const d = h('div', {
        class: 'zone',
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

  tap(cx, cy) {
    if (!this.room) return;
    const r = this.el.getBoundingClientRect();
    const fx = (cx - r.left) / r.width;
    const fy = (cy - r.top) / r.height;
    if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return;
    const inZone = (z) => fx >= z.x && fx <= z.x + z.w && fy >= z.y && fy <= z.y + z.h;
    const th = this.things.find((x) => x.side === this.side && inZone(x.zone));
    if (th) { this.onThing(th); return; }
    const ex = this.room.exit;
    if (this.exitOn && ex.side === this.side && inZone(ex.zone)) this.onExit();
  }
}
