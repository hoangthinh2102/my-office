// Team mode: one session's conversation in someone else's room, read only, when its owner allows it.
// Static markup: src/office/ui/team-log.js fills it in and wires it.
import { getT } from '@/i18n/server';

export default async function TeamLogDrawer() {
  const t = await getT();
  return (
    <aside className="drawer" id="dr-team-log" hidden aria-label={t('team.log.label')}>
      <header className="dr-head">
        <span className="dr-dot tc-dot"></span>
        <div className="dr-title"><h2 id="tc-name"></h2><p id="tc-sub"></p></div>
        <span className="pill tc-pill">{t('team.log.readOnly')}</span>
        <button className="icon-btn" type="button" id="tc-close" aria-label={t('common.close')}><span data-icon="x"></span></button>
      </header>
      <p className="dr-note tc-note">{t('team.log.note')}</p>
      <div className="dr-body" id="tc-body"></div>
    </aside>
  );
}
