// Folding the side columns away (wide screens; markup: SessionRail.tsx #fold-left, ActivityPanel.tsx #fold-right): one
// click on the arrow at a column's inner edge folds it to a narrow strip, the office gets the room; the same arrow opens
// it again. Remembered on this browser. Narrow screens and phones keep their drawers (styles/sidebars.css).
import { $ } from '../core/env.js';
import { t as tr } from '../../i18n/index.js';

const KEY = 'office-fold';
const SIDES = { left: 'ui.sessionRail', right: 'ui.activityPanel' };
const load = () => { try { return (localStorage.getItem(KEY) || '').split(',').filter((s) => s in SIDES); } catch { return []; } };
const save = (list) => { try { localStorage.setItem(KEY, list.join(',')); } catch { /* storage blocked: not remembered */ } };

function set(side, folded) {
  const app = $('app'), b = $(`fold-${side}`); if (!app || !b) return;
  app.classList.toggle(`fold-${side}`, folded);
  const label = tr(`${SIDES[side]}.${folded ? 'unfold' : 'fold'}`);
  b.setAttribute('aria-expanded', String(!folded)); b.setAttribute('aria-label', label); b.title = label;
}

export function setup() {
  const folded = new Set(load());
  for (const side of Object.keys(SIDES)) {
    set(side, folded.has(side));
    $(`fold-${side}`)?.addEventListener('click', () => {
      if (folded.has(side)) folded.delete(side); else folded.add(side);
      set(side, folded.has(side)); save([...folded]);
    });
  }
}
