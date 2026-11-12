// DRONE 3D, the game: the screens (the title, the mission board, the briefing, the report), the mission being
// flown, and the loop that steps the rules, moves the camera and draws each frame.
import { World } from './world/scene.js';
import { Flight, Operation } from './core/flight.js';
import { NO_INPUT, windName } from './core/rules.js';
import { aim, MISSION_IDS, PATROL } from './core/missions.js';
import { capital, direction } from './core/text.js';
import { missionPlan, HAZARDS } from './core/world.js';
import { AUTO } from './core/autopilot.js';
import { Hud } from './ui/hud.js';
import { Sticks } from './ui/sticks.js';
import { Sound, buzz } from './ui/sound.js';
import { store } from './ui/store.js';
import { t, say, getLang, setLang } from './ui/text.js';

const VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const stars = (n) => (n < 0 ? `<span class="off">★★★</span>` : '★'.repeat(n) + `<span class="off">${'★'.repeat(3 - n)}</span>`);
const pct = (v) => Math.round(v * 100);
const touch = () => window.matchMedia('(pointer: coarse)').matches;
const standalone = () => window.matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches || navigator.standalone === true;

export const LOGO = `<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="15" fill="#16303f"/>
  <g stroke="#5c6a73" stroke-width="5" stroke-linecap="round"><line x1="17" y1="17" x2="47" y2="47"/><line x1="47" y1="17" x2="17" y2="47"/></g>
  <g fill="rgba(255,245,223,0.18)" stroke="#fff5df" stroke-width="2.4"><circle cx="16" cy="16" r="9.5"/><circle cx="48" cy="16" r="9.5"/><circle cx="16" cy="48" r="9.5"/><circle cx="48" cy="48" r="9.5"/></g>
  <rect x="24" y="21" width="16" height="22" rx="4.5" fill="#ff7a1a"/><circle cx="32" cy="26.5" r="3" fill="#16303f"/>
  <rect x="26" y="40" width="3" height="3" fill="#3fbf5a"/><rect x="35" y="40" width="3" height="3" fill="#3fbf5a"/></svg>`;

/** The sound for a message of the rules. */
function soundOf(e) {
  if (e.key.startsWith('crash.') && e.key !== 'crash.spare') return 'crash';
  if (e.key === 'mission.complete') return 'complete';
  if (e.key === 'lipad.gate' || e.key === 'lipad.gates.done') return 'gate';
  return { good: 'good', bad: 'bad', warn: 'warn' }[e.kind] || 'radio';
}

export class App {
  constructor() {
    this.canvas = document.getElementById('view');
    this.screenEl = document.getElementById('screen');
    this.hudEl = document.getElementById('hud');
    this.rotateEl = document.getElementById('rotate');
    this.sound = new Sound();
    this.op = Operation.from(store.get('operation'));
    this.screen = 'loading'; this.back = 'title';
    this.flight = null; this.view = null; this.gimbal = -15; this.mode = store.get('mode') || null;
    this.briefId = 'lipad'; this.evIndex = 0; this.endAt = 0; this.last = performance.now();
    this.installEvent = null;
  }

  async init() {
    document.querySelector('#loading div:last-child').textContent = t('loading');
    document.documentElement.lang = getLang() === 'fil' ? 'fil' : 'en';
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));
    this.world = new World(this.canvas);
    this.hud = new Hud(this, this.hudEl);
    this.sticks = new Sticks(this.hudEl.querySelector('#pad'), this.hudEl.querySelector('#stickL'), this.hudEl.querySelector('#stickR'), (deg) => this.tilt(deg), () => this.blocked());
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 250));
    this.screenEl.addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b && !b.disabled) this.act(b.dataset.act, b); });
    this.wireMapTaps();
    window.addEventListener('keydown', (e) => this.key(e));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.screen === 'play') this.pause();
      if (!document.hidden && this.flight && this.screen !== 'results') this.wake(true);
    });
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); this.installEvent = e; if (this.screen === 'title') this.showTitle(); });
    window.addEventListener('appinstalled', () => { this.installEvent = null; });
    // a phone makes sound only after a tap
    const unlock = () => this.sound.unlock();
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
    document.getElementById('loading').hidden = true;
    this.world.idle('lipad');
    this.showTitle();
    requestAnimationFrame((now) => this.frame(now));
  }

  // ---------- the screens ----------

  show(name, html) {
    this.screen = name;
    this.screenEl.innerHTML = html;
    this.screenEl.hidden = false;
    this.screenEl.scrollTop = 0;
    this.hudEl.hidden = !(name === 'pause' && this.flight);
    this.layout();
  }

  showTitle() {
    const fs = document.documentElement.requestFullscreen && !document.fullscreenElement;
    this.show('title', `<div class="card title-card">
      <div class="logo">${LOGO}<div><h1>${esc(t('start.title'))}</h1><div class="sub">${esc(t('start.sub'))}</div></div></div>
      <p>${esc(t('start.body'))}</p>
      <p class="muted">${esc(touch() ? t('start.howto') : t('start.howto.desktop'))}</p>
      <div class="row">
        <button class="btn go" data-act="start">${esc(t('start.go'))}</button>
        <button class="btn" data-act="lang">${esc(t('btn.lang'))}</button>
        <button class="btn" data-act="sound">${esc(t(this.sound.on ? 'btn.sound.on' : 'btn.sound.off'))}</button>
        <button class="btn" data-act="about">${esc(t('btn.about'))}</button>
        ${this.installEvent ? `<button class="btn gold" data-act="install">${esc(t('btn.install'))}</button>` : ''}
        ${fs && touch() ? `<button class="btn" data-act="fullscreen">${esc(t('btn.fullscreen'))}</button>` : ''}
      </div></div>`);
  }

  showBoard() {
    if (this.flight) this.leave();
    this.world.idle('lipad');
    const cards = MISSION_IDS.map((id) => {
      const best = this.op.best[id];
      return `<button class="mission" data-act="brief" data-m="${id}">
        ${id === 'lipad' && !best ? `<span class="badge">${esc(t('board.first'))}</span>` : ''}
        <span class="name">${esc(t('mission.' + id + '.name'))}</span>
        <span class="what">${esc(t('mission.' + id + '.title'))}</span>
        <span class="stars">${stars(best ? best.stars : -1)}</span>
        <span class="best">${esc(best ? t('board.best', t('mode.' + best.mode), best.score) : t('board.notflown'))}</span></button>`;
    }).join('');
    this.show('board', `<div class="card">
      <h2>${esc(t('board.title'))}</h2>
      <p class="muted">${esc(t('board.pick'))}</p>
      <div class="board">${cards}</div>
      <div class="row foot"><button class="btn small" data-act="summary">${esc(t('btn.summary'))}</button><button class="btn small" data-act="lang">${esc(t('btn.lang'))}</button><button class="btn small ghost" data-act="title">${esc(t('brief.back'))}</button></div></div>`);
  }

  showBrief(id) {
    this.briefId = id;
    this.world.idle(id);
    const plan = missionPlan(id), lang = getLang();
    if (!this.mode) this.mode = id === 'lipad' ? 'pilot' : 'desk';
    const lv = plan.floodLevels, first = lv[0], last = lv[lv.length - 1];
    const facts = [t('brief.weather', plan.wind, direction(plan.windFrom, lang), t(windName(plan.wind)))];
    if (Math.max(...lv) > 0) facts.push(last > first ? t('brief.flood.rising', first) : last < first ? t('brief.flood.falling', first) : t('brief.flood', first));
    facts.push(t('brief.minutes', plan.minutes));
    const modes = ['desk', 'pilot', 'hybrid'].map((m) => `<button class="mode${m === this.mode ? ' on' : ''}" data-act="mode" data-mode="${m}"><b>${esc(t('mode.' + m))}</b><span>${esc(t('mode.' + m + '.about'))}</span></button>`).join('');
    this.show('brief', `<div class="card">
      <h2>${esc(t('mission.' + id + '.name'))} · ${esc(t('mission.' + id + '.title'))}</h2>
      <div class="brief"><div>
        <p>${esc(t('mission.' + id + '.brief'))}</p>
        <p class="sub">${esc(t('mission.' + id + '.task'))}</p>
        <p class="muted">${esc(t('mission.' + id + '.tip'))}</p>
        <p class="facts">${facts.map(esc).join('<br>')}</p>
      </div><div>
        <h3>${esc(t('brief.mode'))}</h3><div class="modes">${modes}</div>
        <div class="row" style="margin-top:10px"><button class="btn go" data-act="begin">${esc(t('brief.begin'))}</button><button class="btn" data-act="board">${esc(t('brief.back'))}</button></div>
      </div></div></div>`);
  }

  showPause() {
    const fs = document.documentElement.requestFullscreen && !document.fullscreenElement && touch();
    this.show('pause', `<div class="card" style="max-width:460px"><div class="menu">
      <h2>${esc(t('pause.title'))}</h2>
      <button class="btn go wide" data-act="resume">${esc(t('btn.resume'))}</button>
      <button class="btn" data-act="again">${esc(t('btn.again'))}</button>
      <button class="btn" data-act="end">${esc(t('btn.end'))}</button>
      <button class="btn" data-act="board">${esc(t('btn.board'))}</button>
      <button class="btn" data-act="sound">${esc(t(this.sound.on ? 'btn.sound.on' : 'btn.sound.off'))}</button>
      <button class="btn" data-act="lang">${esc(t('btn.lang'))}</button>
      ${fs ? `<button class="btn" data-act="fullscreen">${esc(t('btn.fullscreen'))}</button>` : ''}
      </div></div>`);
  }

  showResults() {
    const f = this.flight, m = f.mission, r = f.result();
    // a better score than an earlier flight of the same mission
    const flownBefore = !!this.op.best[m.id];
    const best = this.op.record(m.id, f.mode, r) && flownBefore;
    store.set('operation', this.op.toJSON());
    this.endAt = 0;
    let extra = '';
    if (m.id === 'bantay') {
      const done = HAZARDS.filter((h, i) => m.quality[i] >= PATROL.enough);
      if (done.length) extra = `<h3>${esc(t('results.reports'))}</h3>` + done.map((h) => `<p><b>${esc(capital(t('hazard.' + h.id)))}.</b> ${esc(t('hazard.' + h.id + '.act'))}</p>`).join('');
    }
    this.sticks.release();
    this.sound.quiet();
    this.show('results', `<div class="card results">
      <h2>${esc(t('results.title', t('mission.' + m.id + '.name')))}</h2>
      <div class="row"><span class="stars big">${stars(r.stars)}</span><div>
        <p><b>${esc(t('results.score', t('stars', r.stars), r.score))}</b> · ${esc(t('mode.' + f.mode))}</p>
        <p class="muted">${esc(t('results.parts', pct(r.tasks), pct(r.safety), pct(r.pace)))}</p>
        ${best ? `<p class="sub">${esc(t('results.best'))}</p>` : ''}</div></div>
      <ul>${r.lines.map((e) => `<li class="${e.kind}">${esc(say(e))}</li>`).join('')}</ul>${extra}
      <div class="row"><button class="btn go" data-act="again">${esc(t('btn.again'))}</button><button class="btn" data-act="board">${esc(t('btn.board'))}</button></div></div>`);
    this.sound.play(r.stars >= 2 ? 'complete' : 'warn');
    this.wake(false);
  }

  showSummary() {
    const lines = MISSION_IDS.map((id) => {
      const b = this.op.best[id], name = t('mission.' + id + '.name');
      return `<p>${esc(b ? t('sum.line', name, t('stars', b.stars), b.score, t('mode.' + b.mode)) : t('sum.notflown', name))}</p>`;
    }).join('');
    this.show('summary', `<div class="card"><h2>${esc(t('sum.title'))}</h2>${lines}
      <p class="sub">${esc(t('sum.total', this.op.totalStars, 3 * MISSION_IDS.length))}</p>
      <p>${esc(this.op.allFlown ? t('sum.all') : t('sum.more'))}</p>
      <div class="row"><button class="btn" data-act="board">${esc(t('btn.close'))}</button></div></div>`);
  }

  showAbout() {
    this.back = this.screen === 'about' ? this.back : this.screen;
    this.show('about', `<div class="card"><div class="logo">${LOGO}<h2>${esc(t('about.title'))}</h2></div>
      <p>${esc(t('about.body'))}</p><p class="muted">${esc(t('about.samples'))}</p>
      ${standalone() ? '' : `<p class="muted">${esc(t('install.hint'))}</p>`}
      <p class="muted">${esc(t('version', VERSION))}</p>
      <div class="row"><button class="btn" data-act="back">${esc(t('btn.close'))}</button></div></div>`);
  }

  /** Shows again the screen that is up, in the language chosen. */
  redraw() {
    switch (this.screen) {
      case 'title': this.showTitle(); break;
      case 'board': this.showBoard(); break;
      case 'brief': this.showBrief(this.briefId); break;
      case 'pause': this.showPause(); break;
      case 'summary': this.showSummary(); break;
      case 'about': this.showAbout(); break;
    }
    if (this.flight) this.hud.texts();
  }

  // ---------- what the buttons do ----------

  act(name, el) {
    const f = this.flight;
    if (name !== 'sound') this.sound.play('tap');
    switch (name) {
      case 'start': this.showBoard(); break;
      case 'title': this.showTitle(); break;
      case 'lang': setLang(getLang() === 'en' ? 'fil' : 'en'); this.redraw(); break;
      case 'sound': this.sound.setOn(!this.sound.on); this.sound.play('tap'); this.redraw(); break;
      case 'about': this.showAbout(); break;
      case 'back': if (this.back === 'title') this.showTitle(); else this.showBoard(); break;
      case 'install': if (this.installEvent) { this.installEvent.prompt(); this.installEvent.userChoice.finally(() => { this.installEvent = null; this.showTitle(); }); } break;
      case 'fullscreen': this.fullscreen(); break;
      case 'summary': this.showSummary(); break;
      case 'board': this.showBoard(); break;
      case 'brief': this.showBrief(el.dataset.m); break;
      case 'mode': this.mode = el.dataset.mode; store.set('mode', this.mode); this.showBrief(this.briefId); break;
      case 'begin': this.begin(this.briefId, this.mode); break;
      case 'again': this.begin(f.mission.id, f.mode); break;
      case 'pause': this.pause(); break;
      case 'resume': this.resume(); break;
      case 'end': if (f && !f.mission.over) f.mission.end(); this.showResults(); break;
      case 'view-map': this.setView('map'); break;
      case 'view-fpv': this.setView('fpv'); break;
      case 'view-chase': this.setView('chase'); break;
      case 'alt-': case 'alt+': {
        const A = AUTO.altitudes, i = A.indexOf(f.waypointAlt);
        f.waypointAlt = A[Math.max(0, Math.min(A.length - 1, (i < 0 ? 3 : i) + (name === 'alt+' ? 1 : -1)))];
        break;
      }
      case 'undo': if (f.undoWaypoint()) this.sound.play('undo'); break;
      case 'clear': f.clearRoute(); this.sound.play('undo'); break;
      case 'launch': if (f.launch()) { this.sound.play('launch'); buzz(20); } else this.sound.play('warn'); break;
      case 'home': if (f.goHome()) this.sound.play('launch'); break;
      case 'take':
        if (f.takeControl()) { this.hud.toast('info', t('pilot.took'), 3); if (this.view === 'map') this.setView('chase'); }
        break;
      case 'give': if (f.handBack()) this.hud.toast('info', t('pilot.gave'), 3); break;
      case 'primary': this.primary(); break;
      case 'drop': this.drop(); break;
      case 'thermal': this.thermal(); break;
    }
    if (this.flight && this.screen === 'play') this.hud.update(0, true);
  }

  // ---------- a mission ----------

  begin(id, mode) {
    if (this.flight) this.leave();
    const f = this.flight = new Flight(id, mode);
    this.world.start(f);
    this.evIndex = 0; this.endAt = 0;
    this.gimbal = id === 'sagip' ? -35 : id === 'bantay' ? -20 : -12;
    this.view = null;
    this.hud.begin(f);
    this.setView(mode === 'pilot' ? 'chase' : 'map', true);
    this.screen = 'play';
    this.screenEl.hidden = true; this.screenEl.innerHTML = '';
    this.hudEl.hidden = false;
    this.layout();
    this.hud.update(0, true);
    this.hud.toast('info', t('mission.go', t('mission.' + id + '.name')), 4);
    if (mode === 'pilot') this.hud.toast('hint', touch() ? t('hud.controls') : t('hud.controls.desktop', t(id === 'bantay' ? 'tool.photo' : id === 'sagip' ? 'tool.mark' : id === 'hatid' ? 'tool.drop' : 'tool.none')), 7);
    else this.hud.toast('hint', t('map.hint'), 7);
    if (mode === 'hybrid') this.hud.toast('hint', t('hud.controls.hybrid'), 7);
    if (touch()) this.fullscreen();
    this.wake(true);
  }

  /** Leaves the mission being flown. */
  leave() {
    if (this.view === 'map') this.world.leaveMap();
    this.flight = null; this.view = null; this.endAt = 0;
    this.sticks.enable(false);
    this.hudEl.hidden = true;
    this.sound.quiet();
    this.wake(false);
  }

  pause() {
    if (this.screen !== 'play') return;
    this.sticks.release();
    this.sound.quiet();
    this.showPause();
  }

  resume() {
    this.screen = 'play';
    this.screenEl.hidden = true; this.screenEl.innerHTML = '';
    this.hudEl.hidden = false;
    this.last = performance.now();
    this.layout();
  }

  setView(v, quiet) {
    if (v === this.view || !this.flight) return;
    if (this.view === 'map') this.world.leaveMap();
    this.view = v;
    if (v === 'map') this.world.enterMap();
    this.world.setThermal(this.flight.thermal && v !== 'map');
    this.sticks.release();
    if (!quiet) this.sound.play('tap');
    this.hud.update(0, true);
  }

  /** A thumb on the sticks of a drone the autopilot flies: say how to take them. */
  blocked() {
    const f = this.flight, now = performance.now();
    if (!f || f.mission.over || now < (this.toldBlocked || 0)) return;
    this.toldBlocked = now + 8000;
    this.hud.toast('info', f.mode === 'desk' ? t('pilot.cannot.desk') : t('hud.controls.hybrid'), 4);
  }

  tilt(deg) {
    this.gimbal = Math.max(-90, Math.min(20, this.gimbal + deg));
    this.hud.showTilt();
  }

  primary() {
    const f = this.flight;
    if (!f || !f.manual || f.mission.over) return;
    const m = f.mission, c = this.world.droneCamera(f.drone, this.gimbal);
    if (m.id === 'bantay') { this.hud.flash(); this.sound.play('photo'); buzz(15); }
    const done = f.primary(aim(c.from, c.dir));
    if (done && m.id === 'sagip') { this.sound.play('mark'); buzz(25); }
    if (done && m.id === 'hatid') { this.sound.play('drop'); buzz(20); }
  }

  drop() {
    const f = this.flight;
    if (f && f.release()) { this.sound.play('drop'); buzz(20); }
  }

  thermal() {
    const f = this.flight;
    if (!f || f.mission.id !== 'sagip') return;
    f.thermal = !f.thermal;
    this.world.setThermal(f.thermal && this.view !== 'map');
    this.sound.play(f.thermal ? 'on' : 'off');
  }

  load(item) {
    const f = this.flight;
    if (!f) return;
    if (f.mission.load(item, f.drone)) { this.sound.play('add'); buzz(10); this.hud.toast('info', t('load.on', t('supply.' + item)), 2.5); }
    this.hud.update(0, true);
  }

  unload(item) {
    const f = this.flight;
    if (f && item && f.mission.unload(item, f.drone)) { this.sound.play('undo'); this.hud.toast('info', t('load.off', t('supply.' + item)), 2.5); }
    this.hud.update(0, true);
  }

  /** A tap on the map puts a waypoint where it touched; a drag moves the map instead. */
  wireMapTaps() {
    const down = new Map();
    let multi = false;
    this.canvas.addEventListener('pointerdown', (e) => { down.set(e.pointerId, { x: e.clientX, y: e.clientY, at: performance.now() }); if (down.size > 1) multi = true; });
    const up = (e, cancel) => {
      const p = down.get(e.pointerId);
      down.delete(e.pointerId);
      const tap = p && !cancel && !multi && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 10 && performance.now() - p.at < 450;
      if (!down.size) multi = false;
      if (tap && this.screen === 'play' && this.view === 'map') this.placeWaypoint(e.clientX, e.clientY);
    };
    this.canvas.addEventListener('pointerup', (e) => up(e, false));
    this.canvas.addEventListener('pointercancel', (e) => up(e, true));
  }

  placeWaypoint(px, py) {
    const f = this.flight;
    if (!f.canPlan) { this.hud.toast('info', t('console.route.pilot'), 2.5); return; }
    const p = this.world.pick(px, py);
    if (!p) return;
    if (f.addWaypoint(p.x, p.z)) { this.sound.play('add'); buzz(8); } else this.sound.play('warn');
    this.hud.update(0, true);
  }

  key(e) {
    if (e.repeat) return;
    if (e.code === 'Escape' || e.code === 'KeyP') { if (this.screen === 'play') this.pause(); else if (this.screen === 'pause') this.resume(); return; }
    if (this.screen !== 'play') return;
    switch (e.code) {
      case 'Space': e.preventDefault(); this.primary(); break;
      case 'KeyG': this.drop(); break;
      case 'KeyT': this.thermal(); break;
      case 'KeyV': this.setView({ map: 'fpv', fpv: 'chase', chase: 'map' }[this.view]); break;
      case 'KeyM': this.setView('map'); break;
      case 'KeyH': if (this.flight.mode === 'hybrid') this.act(this.flight.manual ? 'give' : 'take'); break;
    }
  }

  // ---------- each frame ----------

  frame(now) {
    requestAnimationFrame((n) => this.frame(n));
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    const w = this.world, f = this.flight;
    if (f && (this.screen === 'play' || this.screen === 'pause' || this.screen === 'results')) {
      const running = this.screen === 'play' && !this.portrait;
      if (running) {
        const keys = this.sticks.keys;
        if (keys.has('KeyZ')) this.tilt(-50 * dt);
        if (keys.has('KeyX')) this.tilt(50 * dt);
        f.advance(dt, f.manual && this.view !== 'map' ? this.sticks.value() : NO_INPUT);
        this.events();
        if (f.mission.over && !this.endAt) this.endAt = now + 2600;
        if (this.endAt && now >= this.endAt) { this.showResults(); }
      }
      w.update(running ? dt : 0, this.view);
      if (this.view === 'map') w.updateMap();
      else if (this.view === 'fpv') w.viewFpv(f.drone, this.gimbal);
      else w.viewChase(f.drone, this.gimbal, running ? dt : 1);
      if (running) this.hud.update(dt);
      if (running) this.sounds();
    } else w.viewOrbit(now / 1000);
    w.render();
  }

  events() {
    const ev = this.flight.mission.events;
    while (this.evIndex < ev.length) {
      const e = ev[this.evIndex++];
      this.hud.toast(e.kind, say(e));
      const s = soundOf(e);
      this.sound.play(s);
      if (s === 'crash') buzz([80, 60, 200]);
      if (s === 'gate') buzz(30);
    }
  }

  sounds() {
    const f = this.flight, d = f.drone, m = f.mission;
    const flying = !d.landed && !d.crashed;
    const motor = flying ? Math.min(1, 0.45 + d.speed / 30 + Math.max(0, d.vy) / 8) : 0;
    const near = this.view === 'map' ? 0.2 : this.view === 'fpv' ? 0.75 : 1;
    const wind = this.view === 'map' ? 0 : m.weather.speedAt(m.time) * Math.min(1, 0.4 + d.aboveGround / 40);
    this.sound.loop({ motor, near, wind, rain: m.id === 'sagip' && this.view !== 'map' });
  }

  // ---------- the phone ----------

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.world.resize(w, h);
    this.sticks.place();
    this.layout();
  }

  /** On a phone held upright, the mission waits until it is turned sideways. */
  layout() {
    this.portrait = touch() && window.innerHeight > window.innerWidth * 1.05;
    const block = this.portrait && this.screen === 'play';
    this.rotateEl.hidden = !block;
    if (block) this.rotateEl.querySelector('.rotate-text').textContent = t('rotate');
  }

  async fullscreen() {
    const el = document.documentElement;
    try { if (!document.fullscreenElement && el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' }); } catch { /* not allowed here */ }
    try { if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape'); } catch { /* not allowed here */ }
    if (this.screen === 'title') this.showTitle();
  }

  async wake(on) {
    try {
      if (on && 'wakeLock' in navigator && !this.lock) { this.lock = await navigator.wakeLock.request('screen'); this.lock.addEventListener('release', () => { this.lock = null; }); }
      else if (!on && this.lock) { await this.lock.release(); this.lock = null; }
    } catch { /* the screen may sleep */ }
  }
}
