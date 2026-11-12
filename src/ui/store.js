// What the phone remembers between games: the language, the sound, and the operation's record. Storage can be
// missing or refused (a private window); the game then simply forgets.
const PREFIX = 'drone3d.';

export const store = {
  get(key) {
    try { const v = window.localStorage.getItem(PREFIX + key); return v == null ? null : JSON.parse(v); } catch { return null; }
  },
  set(key, value) {
    try { window.localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* nothing to do */ }
  },
};
