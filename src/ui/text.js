// The language of the screen, and the texts in it. t('key', ...) gives a text of core/text.js in the language
// chosen, with its blanks filled; a blank that names another text ('hazard.fire') is filled with that text.
import { format, names, say as sayIn, LANGS } from '../core/text.js';
import { store } from './store.js';

let lang = LANGS.includes(store.get('lang')) ? store.get('lang') : (navigator.language || '').toLowerCase().startsWith('fil') || (navigator.language || '').toLowerCase().startsWith('tl') ? 'fil' : 'en';

export const getLang = () => lang;
export function setLang(l) { lang = l; store.set('lang', l); document.documentElement.lang = l === 'fil' ? 'fil' : 'en'; }
export const t = (key, ...args) => format(key, lang, ...names(args, lang));
export const say = (e) => sayIn(e, lang);
