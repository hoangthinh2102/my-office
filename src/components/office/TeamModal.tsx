// Team mode's building: your own room (open, closed, paused) and everyone else's, floor by floor. View only.
// Static markup: src/office/ui/team.js fills it in and wires it.
import { getT } from '@/i18n/server';

export default async function TeamModal() {
  const t = await getT();
  return (
    <div className="modal team-modal" id="team-modal" hidden>
      <div className="modal-card team-card" role="dialog" aria-modal="true" aria-labelledby="team-title">
        <header className="dir-head">
          <span className="dir-mark" data-icon="building"></span>
          <div className="dir-titles">
            <h2 id="team-title">{t('team.open')}</h2>
            <span className="dir-sub" id="team-sub"></span>
          </div>
          <button className="dir-x" type="button" data-close aria-label={t('common.close')}><span data-icon="x"></span></button>
        </header>
        <div className="team-body">
          <section className="team-mine" id="team-mine">
            <div className="team-mine-head">
              <b>{t('team.mine.title')}</b>
              <div className="team-seg" role="group" aria-label={t('team.mine.title')}>
                <button type="button" className="team-seg-b" data-mode="open"><span data-icon="door"></span>{t('team.mine.open')}</button>
                <button type="button" className="team-seg-b" data-mode="closed"><span data-icon="lock"></span>{t('team.mine.closed')}</button>
                <button type="button" className="team-seg-b" data-mode="paused"><span data-icon="pause"></span>{t('team.mine.pause')}</button>
              </div>
            </div>
            <p className="dir-note" id="team-mine-note"></p>
            <div className="team-policy" id="team-policy">
              <span className="team-policy-t" id="team-policy-t"></span>
              <label className="team-switch" id="team-policy-sw" hidden>
                <input type="checkbox" id="team-policy-in" />
                <span>{t('team.policy.switch')}</span>
              </label>
            </div>
            {/* your sessions' conversations: may people who see your room read them? (off unless you turn it on) */}
            <div className="team-policy team-convo" id="team-convo">
              <label className="team-switch">
                <input type="checkbox" id="team-convo-in" />
                <span>{t('team.log.switch')}</span>
              </label>
              <span className="team-policy-t" id="team-convo-t"></span>
            </div>
            {/* the oldest office version the team allows (admins raise it; src/office/ui/team.js, server/updater.mjs) */}
            <div className="team-policy team-upd" id="team-upd">
              <span className="team-policy-t" id="team-upd-t"></span>
              <button type="button" className="team-code-make" id="team-upd-b" hidden><span data-icon="rocket"></span><span id="team-upd-l">{t('team.upd.button')}</span></button>
            </div>
            {/* invite someone (admins; src/office/ui/team-join.js) */}
            <div className="team-invite" id="team-invite">
              <button type="button" className="team-code-make" id="team-invite-make" hidden><span data-icon="users"></span>{t('team.join.invite')}</button>
              <span className="team-code-out" id="team-invite-out" hidden></span>
              <p className="team-access-note" id="team-invite-note"></p>
            </div>
            {/* closed rooms: knocks on your door, who may look in, view codes (src/office/ui/team-access.js) */}
            <div className="team-access" id="team-access">
              <p className="team-access-note" id="team-access-open" hidden>{t('team.access.isOpen')}</p>
              <div className="team-knocks" id="team-knocks"></div>
              <div className="team-grants-box">
                <b className="team-access-h">{t('team.access.grantsTitle')}</b>
                <ul className="team-grants" id="team-grants"></ul>
              </div>
              <div className="team-code-row">
                <button type="button" className="team-code-make" id="team-code-make"><span data-icon="lock"></span>{t('team.access.makeCode')}</button>
                <span className="team-code-out" id="team-code-out" hidden></span>
              </div>
              <form className="team-redeem" id="team-redeem">
                <label htmlFor="team-redeem-in">{t('team.access.redeemLabel')}</label>
                <input id="team-redeem-in" type="text" maxLength={14} autoComplete="off" spellCheck={false} placeholder={t('team.access.redeemPh')} />
                <button type="submit" id="team-redeem-go">{t('team.access.redeem')}</button>
              </form>
              <details className="team-log" id="team-log">
                <summary>{t('team.access.logTitle')}</summary>
                <ul id="team-log-list"></ul>
              </details>
            </div>
          </section>
          {/* who is in the team, and its admins (src/office/ui/team-members.js) */}
          <details className="team-members" id="team-members" hidden>
            <summary><b>{t('team.members.title')}</b> <span id="team-members-n"></span></summary>
            <p className="team-access-note" id="team-members-note"></p>
            <ul className="team-mem-list" id="team-members-list"></ul>
          </details>
          <div className="team-floors" id="team-floors"></div>
          <p className="dir-note team-foot">{t('team.readOnly')} <span id="team-3d-note"></span></p>
        </div>
      </div>
    </div>
  );
}
