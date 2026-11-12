// The instruments over the 3D view while a mission is flown: the top bar (the mission and its clock, the compass,
// the battery and the wind), the radio, the drone's readings at the bottom, the round map, the buttons, the two
// sticks, and on the map the operator's panel (the route, the supplies, what each place still needs) and the
// labels over the places that matter.
import { t } from './text.js';
import { capital, clock, direction } from '../core/text.js';
import { drawPlan, drawMinimap, drawCompass } from './minimap.js';
import { Compass, GATES, HAZARDS, SURVIVORS, SITES, PAD_X, PAD_Z, PAD_Y, onPad, supply, flat, ground } from '../core/world.js';
import { AUTO } from '../core/autopilot.js';
import { ReliefFlights } from '../core/missions.js';
import { SPEC } from '../core/rules.js';
import { getLang } from './text.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const hex = (n) => '#' + n.toString(16).padStart(6, '0');
const PAUSE_ICON = '<svg viewBox="0 0 20 20"><rect x="4" y="3" width="4.5" height="14" rx="1.2"/><rect x="11.5" y="3" width="4.5" height="14" rx="1.2"/></svg>';

export class Hud {
  constructor(app, root) {
    this.app = app; this.root = root;
    root.innerHTML = `
      <div id="pad"></div>
      <div id="labels"></div>
      <div class="reticle pass" hidden><span></span></div>
      <div class="flash pass"></div>
      <div class="stick pass" id="stickL"><div class="label"></div><div class="knob"></div></div>
      <div class="stick pass" id="stickR"><div class="label"></div><div class="knob"></div></div>
      <div class="topbar">
        <button class="iconbtn" data-act="pause">${PAUSE_ICON}</button>
        <div class="chip shade"><span class="mname"></span><small class="mtask"></small></div>
        <div class="compass"><canvas width="600" height="60"></canvas><div class="tags"></div></div>
        <div class="views"><button data-act="view-map"></button><button data-act="view-fpv"></button><button data-act="view-chase"></button></div>
        <div class="chip shade"><span class="battery"></span><small class="wind"></small></div>
      </div>
      <canvas id="minimap" width="236" height="236" data-act="view-map"></canvas>
      <div id="toasts"></div>
      <div class="osd shade pass"><div class="main"></div><div class="next"></div><div class="drop"></div></div>
      <div class="actions"></div>
      <div class="desk"></div>
      <div class="cargo" hidden></div>`;
    const q = (s) => root.querySelector(s);
    this.el = {
      pad: q('#pad'), labels: q('#labels'), reticle: q('.reticle'), flash: q('.flash'), name: q('.mname'), task: q('.mtask'),
      compass: q('.compass canvas'), tags: q('.tags'), battery: q('.battery'), wind: q('.wind'), minimap: q('#minimap'),
      views: q('.views'), toasts: q('#toasts'), osd: q('.osd .main'), next: q('.osd .next'), drop: q('.osd .drop'),
      actions: q('.actions'), desk: q('.desk'), cargo: q('.cargo'), stickL: q('#stickL'), stickR: q('#stickR'),
    };
    // the two canvases are drawn at twice their size on the screen, so they stay sharp
    this.compassCtx = this.el.compass.getContext('2d'); this.compassCtx.scale(2, 2);
    this.miniCtx = this.el.minimap.getContext('2d'); this.miniCtx.scale(2, 2);
    root.addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b && !b.disabled) app.act(b.dataset.act, b); });
    this.clock = 0; this.slow = 0; this.mini = 0; this.labels = []; this.wpLabels = []; this.tagUntil = 0;
  }

  // ---------- a mission begins ----------

  begin(flight) {
    this.f = flight;
    const m = flight.mission;
    this.planPicture = drawPlan(m.plan, m.weather.level(0)); this.planLevel = m.weather.level(0);
    this.el.toasts.innerHTML = '';
    this.evIndex = 0;
    this.buildLabels();
    this.buildDesk();
    this.buildActions();
    this.texts();
    this.update(0, true);
  }

  /** The words that do not change while flying, in the language chosen. */
  texts() {
    const f = this.f;
    this.el.stickL.querySelector('.label').textContent = '';
    this.el.stickR.querySelector('.label').textContent = '';
    this.root.querySelector('[data-act=pause]').setAttribute('aria-label', t('btn.pause'));
    const v = this.el.views.children;
    v[0].textContent = t('view.map'); v[1].textContent = t('view.fpv'); v[2].textContent = t('view.chase');
    if (f) { this.buildDesk(); this.buildActions(); }
  }

  // ---------- the radio ----------

  toast(kind, text, seconds = 4.5) {
    const box = this.el.toasts, el = document.createElement('div');
    el.className = 'toast shade ' + kind; el.textContent = text;
    box.appendChild(el);
    while (box.children.length > 3) box.removeChild(box.firstChild);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 450); }, seconds * 1000);
  }

  flash() { const f = this.el.flash; f.classList.add('on'); requestAnimationFrame(() => requestAnimationFrame(() => f.classList.remove('on'))); }

  // ---------- the buttons at the right ----------

  buildActions() {
    const f = this.f, m = f.mission, a = [];
    const manual = f.manual, map = this.app.view === 'map';
    if (manual && !map) {
      if (m.id === 'bantay') a.push(`<button class="act primary" data-act="primary">${esc(t('btn.photo'))}</button>`);
      if (m.id === 'sagip') a.push(`<button class="act primary" data-act="primary">${esc(t('btn.mark'))}</button>`, `<button class="act" data-act="drop">${esc(t('btn.drop'))}</button>`);
      if (m.id === 'hatid') a.push(`<button class="act primary" data-act="primary">${esc(t('btn.drop'))}</button>`);
    }
    if (m.id === 'sagip' && !map) a.push(`<button class="act${f.thermal ? ' on' : ''}" data-act="thermal">${esc(t('btn.thermal'))}</button>`);
    // on the map, the panel has the hybrid's button
    if (f.mode === 'hybrid' && !map) a.push(manual ? `<button class="pill gold" data-act="give">${esc(t('btn.give'))}</button>` : `<button class="pill go" data-act="take">${esc(t('btn.take'))}</button>`);
    const html = a.join('');
    if (html !== this.actionsHtml) { this.el.actions.innerHTML = html; this.actionsHtml = html; }
  }

  // ---------- the operator's panel, on the map ----------

  buildDesk() {
    const f = this.f, m = f.mission, d = this.el.desk;
    const offers = m.offers;
    let h = `<h4>${esc(t('mission.' + m.id + '.name'))} · ${esc(t('mission.' + m.id + '.title'))}</h4>
      <p class="d-task"></p><p class="d-state"></p><p class="muted d-status"></p><p class="muted d-weather"></p>`;
    if (f.canPlan) {
      h += `<h4>${esc(t('desk.route'))}</h4><p class="d-route"></p>
        <div class="alt"><button class="btn" data-act="alt-" aria-label="${esc(t('btn.lower'))}">−</button><span class="d-alt"></span><button class="btn" data-act="alt+" aria-label="${esc(t('btn.higher'))}">+</button></div>
        <div class="grid4"><button class="btn" data-act="undo">${esc(t('btn.undo'))}</button><button class="btn" data-act="clear">${esc(t('btn.clear'))}</button>
        <button class="btn go" data-act="launch">${esc(t('btn.launch'))}</button><button class="btn" data-act="home">${esc(t('btn.recall'))}</button></div>`;
      if (f.mode === 'hybrid') h += `<div class="grid1"><button class="btn gold" data-act="take">${esc(t('btn.take'))}</button><button class="btn gold" data-act="give">${esc(t('btn.give'))}</button></div>`;
    } else h += `<p class="muted">${esc(t('console.route.pilot'))}</p>`;
    if (offers.length) {
      h += `<h4>${esc(t('shelf.title'))}</h4><div class="cargo-ui"></div>`;
    }
    if (m instanceof ReliefFlights) h += `<h4>${esc(t('desk.needs'))}</h4><div class="d-needs"></div>`;
    d.innerHTML = h;
    this.desk = { weather: d.querySelector('.d-weather'), task: d.querySelector('.d-task'), state: d.querySelector('.d-state'), status: d.querySelector('.d-status'), route: d.querySelector('.d-route'), alt: d.querySelector('.d-alt'), needs: d.querySelector('.d-needs'), launch: d.querySelector('[data-act=launch]'), home: d.querySelector('[data-act=home]'), undo: d.querySelector('[data-act=undo]'), clear: d.querySelector('[data-act=clear]'), take: d.querySelector('[data-act=take]'), give: d.querySelector('[data-act=give]') };
    this.cargoKey = null;
    if (offers.length) this.buildCargo(d.querySelector('.cargo-ui'));
    // the same supplies, at the bottom of the screen, while the drone stands on the pad
    this.el.cargo.innerHTML = offers.length ? `<p>${esc(t('hooks.title'))}</p><div class="cargo-ui"></div>` : '';
    if (offers.length) this.buildCargo(this.el.cargo.querySelector('.cargo-ui'));
  }

  /** The shelf of supplies and the drone's three hooks: tap or drag a supply onto the hooks; tap a hook to empty it. */
  buildCargo(box) {
    const m = this.f.mission;
    box.innerHTML = `<div class="shelf">${m.offers.map((id) => `<button class="supply" data-item="${id}" style="background:${hex(supply(id).color)}">${esc(capital(t('supply.' + id)))} <i>${supply(id).kg} kg</i></button>`).join('')}</div>
      <div class="hooks">${[0, 1, 2].map((i) => `<div class="hook" data-hook="${i}"></div>`).join('')}</div><p class="muted c-line"></p><p class="muted">${esc(t('console.load.how'))}</p>`;
    const hooks = box.querySelector('.hooks');
    for (const chip of box.querySelectorAll('.supply')) this.dragSupply(chip, hooks);
    hooks.addEventListener('click', (e) => { const k = e.target.closest('.hook.full'); if (k) this.app.unload(k.dataset.item); });
  }

  dragSupply(chip, hooks) {
    let start = null, ghost = null;
    const over = (e) => { const r = hooks.getBoundingClientRect(); return e.clientX >= r.left - 10 && e.clientX <= r.right + 10 && e.clientY >= r.top - 14 && e.clientY <= r.bottom + 14; };
    chip.addEventListener('pointerdown', (e) => { start = { x: e.clientX, y: e.clientY, id: e.pointerId }; try { chip.setPointerCapture(e.pointerId); } catch { /* fine */ } e.preventDefault(); });
    chip.addEventListener('pointermove', (e) => {
      if (!start || e.pointerId !== start.id) return;
      if (!ghost && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) { ghost = chip.cloneNode(true); ghost.classList.add('ghost'); document.body.appendChild(ghost); }
      if (ghost) { ghost.style.left = e.clientX + 'px'; ghost.style.top = e.clientY + 'px'; hooks.classList.toggle('hot', over(e)); }
    });
    const end = (e, cancel) => {
      if (!start || e.pointerId !== start.id) return;
      const dragged = !!ghost, onHooks = over(e);
      if (ghost) { ghost.remove(); ghost = null; }
      hooks.classList.remove('hot'); start = null;
      if (!cancel && (!dragged || onHooks)) this.app.load(chip.dataset.item);
    };
    chip.addEventListener('pointerup', (e) => end(e, false));
    chip.addEventListener('pointercancel', (e) => end(e, true));
  }

  updateCargo() {
    const m = this.f.mission, items = m.cargo.items, key = items.join(',') + '|' + m.canLoad(this.f.drone) + '|' + getLang();
    if (key === this.cargoKey) return;
    this.cargoKey = key;
    for (const box of this.root.querySelectorAll('.cargo-ui')) {
      box.querySelectorAll('.hook').forEach((h, i) => {
        const id = items[i];
        h.className = 'hook' + (id ? ' full' : '');
        h.dataset.item = id || '';
        h.style.background = id ? hex(supply(id).color) : '';
        h.textContent = id ? capital(t('supply.' + id)) : '—';
      });
      const line = items.length ? t('console.cargo', items.map((i) => t('supply.' + i)).join(', '), m.cargo.kg, 8) : t('hooks.empty');
      box.querySelector('.c-line').textContent = line + (m.canLoad(this.f.drone) ? '' : ' · ' + t('load.pad'));
      box.querySelector('.shelf').style.opacity = m.canLoad(this.f.drone) ? '1' : '0.45';
    }
  }

  /** The panel's words that change as the mission goes. */
  updateDesk() {
    const f = this.f, m = f.mission, d = f.drone, D = this.desk;
    D.task.textContent = this.taskLine();
    D.state.textContent = t(...this.stateLine());
    D.status.textContent = t('console.status', Math.round(d.battery * 100), Math.max(0, Math.round(d.aboveGround)), d.speed.toFixed(1));
    const level = m.weather.level(m.time), wind = t('console.wind', Math.round(m.weather.speedAt(m.time)), direction(m.weather.fromAt(m.time), getLang()));
    D.weather.textContent = level > 0.05 ? wind + ' · ' + t('console.flood', level.toFixed(1)) : wind;
    if (f.canPlan) {
      const n = f.ahead().length;
      if (!n) D.route.textContent = t('console.route.none');
      else {
        const e = f.estimate();
        const args = [n, Math.round(e.metres), clock(e.seconds), Math.round(e.battery * 100)];
        D.route.textContent = e.battery > 1 - AUTO.reserve ? t('console.route.toofar') : n === 1 ? t('console.route.one', ...args) : t('console.route', ...args);
      }
      D.alt.textContent = t('console.alt', f.waypointAlt);
      const flying = f.auto.active && !f.manual;
      D.launch.disabled = !n || d.crashed || m.over || flying;
      D.home.disabled = d.crashed || m.over || (d.landed && onPad(d.x, d.z)) || (flying && f.auto.returning);
      D.undo.disabled = !f.auto.route.length; D.clear.disabled = !n;
      if (D.take) { D.take.hidden = f.manual; D.give.hidden = !f.manual; D.take.disabled = d.crashed || m.over; }
    }
    if (D.needs) {
      D.needs.innerHTML = SITES.map((s, i) => {
        const left = m.stillNeeds(i), name = capital(t('site.' + s.id));
        return `<p>${esc(left.length ? t('need.line', name, left.map((k) => t('supply.' + k)).join(', ')) : t('need.done', name))}</p>`;
      }).join('');
    }
  }

  taskLine() {
    const m = this.f.mission;
    switch (m.id) {
      case 'lipad': return t('console.tasks.lipad', m.passed, GATES.length);
      case 'bantay': return t('console.tasks.bantay', m.count, m.total);
      case 'sagip': return t('console.tasks.sagip', m.count, m.total, SURVIVORS.filter((_, i) => m.aboard(i)).length);
      default: return t('console.tasks.hatid', m.count, m.total);
    }
  }

  /** What the drone is doing, for the panel: a text's key and its blanks. */
  stateLine() {
    const f = this.f, d = f.drone, a = f.auto;
    if (d.crashed) return ['console.state.lost'];
    if (f.manual && !d.landed) return ['console.state.manual'];
    if (a.active && !f.manual) {
      if (a.returning) return [a.lowBatteryReturn ? 'console.state.homelow' : 'console.state.home'];
      if (a.waiting) return ['console.state.wait'];
      const w = a.target;
      if (w && w.kind === 'drop' && ['descend', 'settle', 'release'].includes(a.phase) && flat(d.x, d.z, w.x, w.z) < 6) return ['console.state.drop'];
      return ['console.state.auto', Math.min(a.next + 1, a.route.length), a.route.length];
    }
    if (d.landed) return [onPad(d.x, d.z) ? 'console.state.pad' : 'console.state.ground'];
    return ['console.state.manual'];
  }

  // ---------- labels over the map ----------

  buildLabels() {
    const box = this.el.labels, m = this.f.mission;
    box.innerHTML = ''; this.labels = []; this.wpLabels = []; this.wpKey = '';
    const add = (cls, x, y, z, pin, text, update) => {
      const el = document.createElement('div'); el.className = 'lbl ' + cls;
      el.innerHTML = `<div class="pin">${esc(pin)}</div>${text != null ? `<div class="txt">${esc(text)}</div>` : ''}`;
      box.appendChild(el);
      const l = { el, x, y, z, update, cls };
      this.labels.push(l);
      return l;
    };
    add('pad', PAD_X, PAD_Y + 1, PAD_Z, 'H', null);
    if (m.id === 'lipad') GATES.forEach((g, i) => { const c = g.center(); add('', c.x, c.y + g.r + 0.5, c.z, String(i + 1), null, (l) => this.cls(l, i < m.passed ? 'done' : i === m.passed ? 'next' : '')); });
    if (m.id === 'bantay') HAZARDS.forEach((h, i) => add('', h.reportX, ground(h.reportX, h.reportZ) + 3, h.reportZ, '!', null, (l) => {
      const s = m.stateOf(i);
      this.cls(l, s === 2 ? 'done' : s === 1 ? 'half' : '');
      if (s === 2) { l.x = h.x; l.z = h.z; l.y = h.point().y + 3; }
      this.text(l, s > 0 ? capital(t('hazard.' + h.id)) : null);
    }));
    if (m.id === 'sagip') {
      SURVIVORS.forEach((s, i) => add('', s.x, s.point().y + 2.5, s.z, String(s.people), null, (l) => {
        l.hide = !m.found(i);
        this.cls(l, m.aboard(i) ? 'done' : m.needsRing(i) ? 'next' : 'found');
        this.text(l, m.found(i) ? capital(t('survivor.' + s.id)) : null);
      }));
      m.fleet.boats.forEach((b) => add('boat', b.x, 2, b.z, '⛴', null, (l) => { l.x = b.x; l.z = b.z; l.y = Math.max(m.weather.level(m.time), ground(b.x, b.z)) + 2; }));
    }
    if (m.id === 'hatid') SITES.forEach((s, i) => add('', s.x, s.point().y + 3, s.z, '', null, (l) => {
      const left = m.stillNeeds(i), st = m.stateOf(i);
      this.cls(l, st === 2 ? 'done' : st === 1 ? 'half' : 'next');
      l.el.querySelector('.pin').textContent = left.length ? String(left.length) : '✓';
      this.text(l, capital(t('site.' + s.id)) + (left.length ? ': ' + left.map((k) => t('supply.' + k)).join(', ') : ''));
    }));
  }

  cls(l, c) { const want = 'lbl ' + (c || l.cls); if (l.el.className !== want) l.el.className = want; }

  text(l, s) {
    let el = l.el.querySelector('.txt');
    if (s == null) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('div'); el.className = 'txt'; l.el.appendChild(el); }
    if (el.textContent !== s) el.textContent = s;
  }

  /** Numbers over the waypoints still to fly. */
  updateWaypointLabels() {
    const ahead = this.f.ahead(), key = ahead.map((w) => w.x + ',' + w.z + ',' + w.alt + w.kind).join(';') + (this.f.auto.active ? this.f.auto.next : '');
    if (key === this.wpKey) return;
    this.wpKey = key;
    for (const l of this.wpLabels) l.el.remove();
    const first = this.f.auto.active ? this.f.auto.next : 0;
    this.wpLabels = ahead.map((w, i) => {
      const el = document.createElement('div'); el.className = 'lbl wp ' + w.kind;
      el.innerHTML = `<div class="pin">${first + i + 1}</div>`;
      this.el.labels.appendChild(el);
      return { el, x: w.x, y: w.y + 2.4, z: w.z };
    });
  }

  placeLabels(slow) {
    const world = this.app.world;
    for (const l of this.labels) {
      if (slow && l.update) l.update(l);
      const p = l.hide ? null : world.project(l.x, l.y, l.z);
      l.el.style.display = p ? '' : 'none';
      if (p) l.el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -100%)`;
    }
    for (const l of this.wpLabels) {
      const p = world.project(l.x, l.y, l.z);
      l.el.style.display = p ? '' : 'none';
      if (p) l.el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -100%)`;
    }
  }

  // ---------- where to go next ----------

  /** The next place that matters for the pilot: { x, z, text }, or a line of text only. */
  nextTarget() {
    const f = this.f, m = f.mission, d = f.drone;
    const dist = (x, z) => Math.round(flat(d.x, d.z, x, z));
    const pad = { x: PAD_X, z: PAD_Z, text: t('hud.next.pad', dist(PAD_X, PAD_Z)) };
    switch (m.id) {
      case 'lipad': {
        if (m.passed >= GATES.length) return pad;
        const g = GATES[m.passed];
        return { x: g.x, z: g.z, text: t('hud.next.gate', m.passed + 1, dist(g.x, g.z)) };
      }
      case 'bantay': {
        let best = null, bd = Infinity;
        HAZARDS.forEach((h, i) => { if (m.stateOf(i) === 2) return; const q = flat(d.x, d.z, h.reportX, h.reportZ); if (q < bd) { bd = q; best = h; } });
        return best ? { x: best.reportX, z: best.reportZ, text: t('hud.next.report', Math.round(bd)) } : pad;
      }
      case 'sagip': {
        const text = t('hud.next.groups', m.count, m.total);
        if (m.cargo.items.includes('ring')) {
          const i = SURVIVORS.findIndex((s, k) => s.ring && m.found(k) && m.needsRing(k));
          if (i >= 0) return { x: SURVIVORS[i].x, z: SURVIVORS[i].z, text };
        }
        return m.allDone ? { ...pad, text } : { text };
      }
      default: {
        if (!m.cargo.items.length) return pad;
        let best = -1, bd = Infinity;
        SITES.forEach((s, i) => { if (!m.stillNeeds(i).some((k) => m.cargo.items.includes(k))) return; const q = flat(d.x, d.z, s.x, s.z); if (q < bd) { bd = q; best = i; } });
        if (best < 0) return pad;
        const s = SITES[best];
        return { x: s.x, z: s.z, text: t('hud.next.site', capital(t('site.' + s.id)), Math.round(bd)) };
      }
    }
  }

  // ---------- each frame ----------

  update(dt, force) {
    const f = this.f, m = f.mission, d = f.drone, app = this.app, view = app.view, map = view === 'map';
    this.slow += dt; this.mini += dt;
    const slow = force || this.slow >= 0.2;
    // the sticks: only while the player has the drone and looks through it or from behind it
    app.sticks.enable(f.manual && !map && !m.over);
    this.el.pad.hidden = map;
    this.root.classList.toggle('map', map);
    this.el.desk.hidden = !map; this.el.labels.hidden = !map;
    this.el.minimap.hidden = map;
    if (map) { this.placeLabels(slow); this.updateWaypointLabels(); }
    // the camera's mark: in the middle of the drone's picture, or where it looks when seen from behind
    const aims = (m.id === 'bantay' || m.id === 'sagip') && !map;
    let rp = null;
    if (aims && view === 'fpv') rp = { x: app.world.width / 2, y: app.world.height / 2 };
    else if (aims) { const p = app.world.aimPoint(d, app.gimbal); rp = p && app.world.project(p.x, p.y, p.z); }
    this.el.reticle.hidden = !rp;
    if (rp) { this.el.reticle.style.left = rp.x + 'px'; this.el.reticle.style.top = rp.y + 'px'; }

    if (this.mini >= 0.05 || force) {
      this.mini = 0;
      const next = this.nextTarget();
      const marks = this.marks(next);
      if (!map) drawMinimap(this.miniCtx, 118, this.planPicture, d, marks);
      const cm = [{ heading: Compass.towards(d.x, d.z, PAD_X, PAD_Z), color: '#ffc53d', label: 'H' }];
      if (next.x != null && !(next.x === PAD_X && next.z === PAD_Z)) cm.push({ heading: Compass.towards(d.x, d.z, next.x, next.z), color: '#ff7a1a' });
      drawCompass(this.compassCtx, 300, 30, d.heading, cm);
      this.next = next;
    }
    if (!slow) return;
    this.slow = 0;
    // the picture of the barangay, again when the flood has risen
    const level = m.weather.level(m.time);
    if (Math.abs(level - this.planLevel) > 0.15) { this.planPicture = drawPlan(m.plan, level); this.planLevel = level; }
    this.el.name.textContent = t('mission.' + m.id + '.name') + ' · ' + clock(m.remaining);
    this.el.task.textContent = this.taskLine();
    const b = Math.round(d.battery * 100);
    this.el.battery.textContent = t('hud.battery', b);
    this.el.battery.className = 'battery' + (d.battery < 0.12 ? ' critical' : d.battery < 0.3 ? ' low' : '');
    this.el.wind.textContent = t('hud.wind', Math.round(m.weather.speedAt(m.time)), Compass.point(m.weather.fromAt(m.time)));
    // the readings at the bottom
    this.el.osd.textContent = [t('hud.height', Math.max(0, Math.round(d.aboveGround))), t('hud.speed', d.speed.toFixed(1)), t('hud.home', Math.round(flat(d.x, d.z, PAD_X, PAD_Z)))].join('  ·  ');
    this.el.next.textContent = this.next ? this.next.text : '';
    let drop = m.cargo.items.length ? t('hud.hooks', m.cargo.items.map((k) => t('supply.' + k)).join(', ')) : '';
    this.el.drop.className = 'drop plain';
    if (m.id === 'hatid' && !d.landed && m.cargo.items.length) {
      const site = ReliefFlights.siteUnder(d.x, d.z);
      if (site >= 0) {
        const hgt = d.y - SPEC.gear - SITES[site].point().y;
        drop = hgt > 4 ? t('hud.drop.high', hgt.toFixed(1)) : t('hud.drop.height', hgt.toFixed(1));
        this.el.drop.className = 'drop' + (hgt > 4 ? ' high' : '');
      }
    }
    this.el.drop.textContent = drop;
    // the tags under the compass
    const tags = [];
    if (f.auto.active && !f.manual) tags.push(`<span class="tag">${esc(t('hud.auto'))}</span>`);
    if (f.thermal) tags.push(`<span class="tag thermal">${esc(t('hud.thermal'))}</span>`);
    if (performance.now() < this.tagUntil && !map) tags.push(`<span class="tag">${esc(t('gimbal', Math.round(app.gimbal)))}</span>`);
    if (d.y - PAD_Y > 118) tags.push(`<span class="tag warn">${esc(t('hud.ceiling'))}</span>`);
    const th = tags.join('');
    if (th !== this.tagsHtml) { this.el.tags.innerHTML = th; this.tagsHtml = th; }
    for (const btn of this.el.views.children) btn.classList.toggle('on', btn.dataset.act === 'view-' + view);
    this.buildActions();
    if (map) this.updateDesk();
    if (m.offers.length) this.updateCargo();
    this.el.cargo.hidden = map || !m.offers.length || !m.canLoad(d);
  }

  /** The marks on the round map. */
  marks(next) {
    const m = this.f.mission, k = [];
    k.push({ x: PAD_X, z: PAD_Z, color: '#ffc53d', label: 'H', edge: true });
    if (m.id === 'lipad') GATES.forEach((g, i) => { if (i >= m.passed) k.push({ x: g.x, z: g.z, color: i === m.passed ? '#ff7a1a' : '#ffffff', label: String(i + 1), edge: i === m.passed }); });
    if (m.id === 'bantay') HAZARDS.forEach((h, i) => { const s = m.stateOf(i); k.push(s === 2 ? { x: h.x, z: h.z, color: '#3fbf5a' } : { x: h.reportX, z: h.reportZ, color: s ? '#ffc53d' : '#ff7a1a', label: '!', edge: next && next.x === h.reportX }); });
    if (m.id === 'sagip') {
      SURVIVORS.forEach((s, i) => { if (m.found(i)) k.push({ x: s.x, z: s.z, color: m.aboard(i) ? '#3fbf5a' : m.needsRing(i) ? '#ff7a1a' : '#3fd0ff', label: String(s.people), edge: m.needsRing(i) }); });
      for (const b of m.fleet.boats) k.push({ x: b.x, z: b.z, color: '#ff7a1a' });
    }
    if (m.id === 'hatid') SITES.forEach((s, i) => { const st = m.stateOf(i); k.push({ x: s.x, z: s.z, color: st === 2 ? '#3fbf5a' : '#ff7a1a', label: st === 2 ? '✓' : String(m.stillNeeds(i).length), edge: next && next.x === s.x }); });
    return k;
  }

  showTilt() { this.tagUntil = performance.now() + 1500; }
}

