// Settings: five tabs instead of a long list. Office (floor plan, scenery, time of day, real weather), Characters (the
// two looks, drawn live by the office's renderer), Display (graphics, language, what shows on screen), Skills (this
// computer's Claude Code skills and plugins: src/office/ui/skills.js) and More (phone, alerts, team, behaviour). Static markup: src/office/ui/settings.js drives it; ids and data-* stay as the
// office's code expects them.
import { LANGS } from '@/i18n/index.js';
import { getT } from '@/i18n/server';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || '';
const LAYOUTS = ['cozy', 'pro', 'hq'] as const;
const SCENES = [['city', 'sc-city'], ['country', 'sc-country'], ['beach', 'sc-beach']] as const;
const TIMES = ['auto', 'day', 'night'] as const;
const LOOKS = ['toy', 'pixar'] as const;
const QUALITY = [['auto', 0], ['low', 1], ['medium', 2], ['high', 3]] as const;
const CITIES = [['hn', 'Hà Nội'], ['hcm', ''], ['dn', 'Đà Nẵng'], ['hue', 'Huế'], ['hp', 'Hải Phòng'], ['ct', 'Cần Thơ'], ['dl', 'Đà Lạt'], ['nt', 'Nha Trang']] as const;
const TIME_ICON = { auto: 'clock', day: 'sun', night: 'moon' } as const;

export default async function SettingsPanel() {
  const t = await getT();
  const toggle = (k: string, on: boolean) => (
    <button key={k} type="button" className="tgl" data-tgl={k} role="switch" aria-checked={on ? 'true' : 'false'}><span>{t(`ui.topBar.toggles.${k}`)}</span><i></i></button>
  );
  return (
    <div className="pop pop-settings" id="pop-look" hidden role="dialog" aria-label={t('ui.topBar.settings')}>
      <div className="st-head">
        <b>{t('ui.topBar.settings')}</b>
        <button type="button" className="st-close" id="st-close" aria-label={t('common.close')}><span data-icon="x"></span></button>
      </div>
      <div className="st-tabs" role="tablist">
        {(['office', 'people', 'display', 'skills', 'more'] as const).map((k, i) => (
          <button key={k} type="button" role="tab" id={`st-tab-${k}`} aria-controls={`st-panel-${k}`} aria-selected={i === 0 ? 'true' : 'false'} data-st-tab={k}>{t(`settings.tabs.${k}`)}</button>
        ))}
      </div>

      <div className="st-body">
        <section className="st-panel" id="st-panel-office" role="tabpanel" aria-labelledby="st-tab-office" data-st-panel="office">
          <h3>{t('ui.topBar.office')}</h3>
          <div className="st-cards st-cards--3">
            {LAYOUTS.map((l) => (
              <button key={l} type="button" className="scene st-layout" data-layout={l} aria-pressed="false">
                {/* eslint-disable-next-line @next/next/no-img-element -- a small static picture, no optimisation needed */}
                <img className="sc-art st-shot" src={`${BASE}/assets/thumbs/layout-${l}.jpg`} alt="" loading="lazy" decoding="async" />
                <b>{t(`settings.layouts.${l}.name`)}</b><small>{t(`settings.layouts.${l}.sub`)}</small>
              </button>
            ))}
          </div>
          <p className="pop-note">{t('settings.layoutNote')}</p>

          <h3>{t('ui.topBar.scenery')}</h3>
          <div className="st-cards st-cards--3">
            {SCENES.map(([k, art]) => (
              <button key={k} type="button" className="scene" data-scene={k} aria-pressed="false"><span className={`sc-art ${art}`}></span><b>{t(`ui.topBar.scenes.${k}`)}</b><small>{t(`ui.topBar.scenes.${k}Sub`)}</small></button>
            ))}
          </div>

          <h3>{t('ui.topBar.time')}</h3>
          <div className="st-cards st-cards--3">
            {TIMES.map((k) => (
              <button key={k} type="button" className="scene" data-time={k} aria-pressed={k === 'auto' ? 'true' : 'false'}>
                <span className={`sc-art st-time st-time--${k}`}><span data-icon={TIME_ICON[k]}></span></span>
                <b>{t(`settings.times.${k}.name`)}</b><small>{t(`settings.times.${k}.sub`)}</small>
              </button>
            ))}
          </div>

          <h3>{t('ui.topBar.weather')}</h3>
          <div className="wx-chips" id="wx-cities" role="group" aria-label={t('ui.topBar.weatherCity')}>
            <button type="button" data-wx="" aria-pressed="true">{t('settings.weatherOff')}</button>
            {CITIES.map(([k, name]) => <button key={k} type="button" data-wx={k} aria-pressed="false">{name || t('life.weather.hcm')}</button>)}
          </div>
          <p className="pop-note wx-now" id="wx-now">{t('ui.topBar.weatherHint')}</p>
          <div className="pop-toggles">{toggle('season', true)}</div>
        </section>

        <section className="st-panel" id="st-panel-people" role="tabpanel" aria-labelledby="st-tab-people" data-st-panel="people" hidden>
          <h3>{t('ui.topBar.characters')}</h3>
          <div className="st-cards st-cards--2">
            {LOOKS.map((l) => (
              <button key={l} type="button" className="scene st-look" data-look={l} aria-pressed="false">
                <span className="sc-art st-portrait" data-portrait={l}><span className="st-spin" aria-hidden="true"></span></span>
                <b>{t(`ui.topBar.${l}`)}</b><small>{t(`settings.looks.${l}.sub`)}</small>
              </button>
            ))}
          </div>
          <p className="pop-note">{t('settings.lookNote')}</p>
        </section>

        <section className="st-panel" id="st-panel-display" role="tabpanel" aria-labelledby="st-tab-display" data-st-panel="display" hidden>
          <h3>{t('settings.graphics')}</h3>
          <div className="st-cards st-cards--4">
            {QUALITY.map(([q, bars]) => (
              <button key={q} type="button" className="scene" data-quality={q} aria-pressed={q === 'auto' ? 'true' : 'false'}>
                <span className="sc-art st-q">{bars ? <span className="q-bars" data-n={bars}><i></i><i></i><i></i></span> : <span data-icon="sparkle"></span>}</span>
                <b>{t(`settings.q.${q}`)}</b><small>{t(`settings.qSub.${q}`)}</small>
              </button>
            ))}
          </div>
          <p className="pop-note" id="q-note"></p>

          <h3>{t('settings.language')}</h3>
          <div className="st-cards st-cards--2">
            {Object.entries(LANGS).map(([code, l]) => (
              <button key={code} type="button" className="scene st-lang" lang={code} data-lang={code} aria-pressed={code === t.lang ? 'true' : 'false'}>
                <span className="st-code">{code.toUpperCase()}</span><b>{l.name}</b>
              </button>
            ))}
          </div>

          <h3>{t('ui.topBar.more')}</h3>
          <div className="pop-toggles">{toggle('zones', false)}{toggle('stream', false)}{toggle('autocam', true)}</div>
        </section>

        <section className="st-panel" id="st-panel-skills" role="tabpanel" aria-labelledby="st-tab-skills" data-st-panel="skills" hidden>
          <p className="pop-note" id="sk-phone" hidden>{t('settings.skills.phone')}</p>
          <div className="sk" id="sk" hidden>
            <h3>{t('settings.skills.mine')} <span className="sk-n" id="sk-n"></span></h3>
            <p className="pop-note">{t('settings.skills.note')}</p>
            <ul className="sk-list" id="sk-list"></ul>

            <h3>{t('settings.skills.fromFolder')}</h3>
            <form className="sk-form" id="sk-add">
              <input id="sk-dir" type="text" autoComplete="off" spellCheck={false} placeholder={t('settings.skills.dirPh')} aria-label={t('settings.skills.fromFolder')} />
              <button type="submit" className="tb-btn" id="sk-add-go"><span data-icon="plus"></span><span className="lbl">{t('settings.skills.add')}</span></button>
              <label className="sk-check"><input type="checkbox" id="sk-copy" /> <span>{t('settings.skills.copy')}</span></label>
              <p className="pop-note">{t('settings.skills.folderNote')}</p>
            </form>

            <p className="pop-note" id="sk-noclaude" hidden>{t('settings.skills.noClaude')}</p>
            <div id="sk-market">
              <h3>{t('settings.skills.fromMarket')}</h3>
              <form className="sk-form" id="sk-find" role="search">
                <input id="sk-q" type="search" autoComplete="off" spellCheck={false} placeholder={t('settings.skills.searchPh')} aria-label={t('settings.skills.fromMarket')} />
                <button type="submit" className="tb-btn" id="sk-find-go"><span data-icon="search"></span><span className="lbl">{t('settings.skills.search')}</span></button>
              </form>
              <ul className="sk-list sk-results" id="sk-results"></ul>
              <details className="sk-markets">
                <summary>{t('settings.skills.markets')} (<span id="sk-markets-n"></span>)</summary>
                <ul className="sk-list" id="sk-market-list"></ul>
                <form className="sk-form" id="sk-market-add">
                  <input id="sk-market-src" type="text" autoComplete="off" spellCheck={false} placeholder={t('settings.skills.marketPh')} aria-label={t('settings.skills.addMarket')} />
                  <button type="submit" className="tb-btn" id="sk-market-go"><span data-icon="plus"></span><span className="lbl">{t('settings.skills.addMarket')}</span></button>
                </form>
              </details>
            </div>
          </div>
        </section>

        <section className="st-panel" id="st-panel-more" role="tabpanel" aria-labelledby="st-tab-more" data-st-panel="more" hidden>
          <div className="st-group">
          <h3>{t('settings.notify')}</h3>
          <div className="pop-acts">
            <button id="btn-phone" className="tb-btn" type="button" hidden><span data-icon="phone"></span><span className="lbl">{t('ui.topBar.phone')}</span></button>
            <button id="btn-bell" className="tb-btn" type="button" aria-pressed="false" hidden><span data-icon="bell"></span><span className="lbl">{t('ui.topBar.bell')}</span><i className="badge" id="bell-dot" hidden></i></button>
          </div>
          </div>
          {/* team mode: join with an invite link, or which team you are in (src/office/ui/team-join.js) */}
          <div className="st-team" id="st-team">
            <h3>{t('team.join.title')}</h3>
            <div className="st-team-in" id="st-team-in" hidden>
              <p className="pop-note" id="st-team-name-now"></p>
              <div className="pop-acts"><button type="button" className="tb-btn" id="st-team-open"><span data-icon="building"></span><span className="lbl">{t('team.join.open')}</span></button></div>
            </div>
            <form className="st-team-join" id="st-team-join" hidden>
              <input id="st-team-link" type="text" autoComplete="off" spellCheck={false} placeholder={t('team.join.linkPh')} aria-label={t('team.join.linkPh')} />
              <input id="st-team-name" type="text" autoComplete="off" maxLength={40} placeholder={t('team.join.namePh')} aria-label={t('team.join.namePh')} />
              <button type="submit" className="tb-btn" id="st-team-go"><span data-icon="users"></span><span className="lbl">{t('team.join.go')}</span></button>
              <p className="pop-note">{t('team.join.how')}</p>
            </form>
            <p className="pop-note" id="st-team-phone" hidden>{t('team.join.phone')}</p>
          </div>
          <h3>{t('settings.behaviour')}</h3>
          <div className="pop-toggles">{toggle('sound', true)}{toggle('perm', true)}</div>
          <div className="pop-acts"><button id="btn-tips" className="tb-btn" type="button"><span data-icon="sparkle"></span><span className="lbl">{t('tips.again')}</span></button></div>
        </section>
      </div>
    </div>
  );
}
