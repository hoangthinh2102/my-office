// The director's office: talk to one person directly, the company's rules, office hours, and the performance board.
// Static markup: src/office/ui/director.js fills it in and wires it.
import { getT } from '@/i18n/server';

export default async function DirectorModal() {
  const t = await getT();
  return (
    <div className="modal dir-modal" id="dir-modal" hidden>
      <div className="modal-card dir-card" role="dialog" aria-modal="true" aria-labelledby="dir-title">
        <header className="dir-head">
          <span className="dir-mark" data-icon="briefcase"></span>
          <div className="dir-titles">
            <h2 id="dir-title">{t('director.title')}</h2>
            <span className="dir-sub" id="dir-sub">{t('director.sub')}</span>
          </div>
          <button className="dir-x" type="button" data-close aria-label={t('common.close')}><span data-icon="x"></span></button>
        </header>
        <nav className="dir-tabs" role="tablist">
          <button type="button" role="tab" className="dir-tab is-sel" data-tab="talk"><span data-icon="chat"></span>{t('director.tab.talk')}</button>
          <button type="button" role="tab" className="dir-tab" data-tab="perf"><span data-icon="chart"></span>{t('director.tab.perf')}</button>
          <button type="button" role="tab" className="dir-tab" data-tab="rules"><span data-icon="book"></span>{t('director.tab.rules')}</button>
          <button type="button" role="tab" className="dir-tab" data-tab="hours"><span data-icon="clock"></span>{t('director.tab.hours')}</button>
          <button type="button" role="tab" className="dir-tab" data-tab="auto"><span data-icon="sparkle"></span>{t('director.tab.auto')}</button>
        </nav>

        {/* talking to one person */}
        <section className="dir-pane dir-talk" data-pane="talk">
          <aside className="dir-people">
            <button type="button" className="btn btn--primary dir-hire-btn" id="dir-hire-btn"><span data-icon="plus"></span>{t('director.hire.button')}</button>
            <div className="dir-plist" id="dir-plist"></div>
          </aside>
          <div className="dir-convo">
            <div className="dir-chead" id="dir-chead"></div>
            <div className="dir-msgs" id="dir-msgs"><p className="dir-empty">{t('director.pick')}</p></div>
            <form className="dir-hire" id="dir-hire" hidden>
              <h3>{t('director.hire.title')}</h3>
              <label>{t('director.hire.project')}<select id="dir-hire-dir"></select></label>
              <label>{t('director.hire.role')}<input id="dir-hire-title" maxLength={60} placeholder={t('director.hire.rolePh')} /></label>
              <label>{t('director.hire.brief')}<textarea id="dir-hire-brief" rows={3} maxLength={600} placeholder={t('director.hire.briefPh')}></textarea></label>
              <div className="dir-hire-row">
                <label>{t('director.perm.label')}<select id="dir-hire-perm"></select></label>
                <label>{t('director.next.label')}<select id="dir-hire-next"></select></label>
              </div>
            </form>
            <div className="dir-approve" id="dir-approve" hidden>
              <span id="dir-approve-text">{t('director.approve.bar')}</span>
              <div className="dir-opts" id="dir-opts"></div>
              <button type="button" className="btn" id="dir-approve-no">{t('director.approve.revise')}</button>
              <button type="button" className="btn btn--primary" id="dir-approve-ok">{t('director.approve.ok')}</button>
            </div>
            <form className="dir-input" id="dir-input">
              <div className="dir-slash" id="dir-slash" role="listbox" aria-label={t('director.slash.label')} hidden></div>
              <div className="dir-att" id="dir-att" hidden></div>
              <textarea id="dir-text" rows={2} maxLength={4000} placeholder={t('director.inputPh')} disabled></textarea>
              <div className="dir-input-row">
                <span className="dir-mode" id="dir-mode"></span>
                <button type="button" className="btn" id="dir-stop" hidden>{t('director.stop')}</button>
                <input type="file" id="dir-file" multiple hidden />
                <button type="button" className="btn dir-attach" id="dir-attach" aria-label={t('director.attach.button')} title={t('director.attach.button')} disabled><span data-icon="clip"></span></button>
                <button type="submit" className="btn btn--primary" id="dir-send" disabled><span data-icon="send"></span>{t('director.send')}</button>
              </div>
            </form>
          </div>
        </section>

        {/* the performance board */}
        <section className="dir-pane dir-perf" data-pane="perf" hidden>
          <div className="dir-perf-bar">
            <div className="seg" id="dir-days">
              <button type="button" data-days="1">{t('director.perf.today')}</button>
              <button type="button" data-days="7" className="is-sel">{t('director.perf.week')}</button>
              <button type="button" data-days="30">{t('director.perf.month')}</button>
            </div>
            <button type="button" className="btn" id="dir-csv"><span data-icon="file"></span>CSV</button>
          </div>
          <div className="dir-tiles" id="dir-tiles"></div>
          <div className="dir-chart" id="dir-chart"></div>
          <div className="dir-budget-now" id="dir-budget-now" hidden></div>
          <h3>{t('director.perf.people')}</h3>
          <div className="dir-table-wrap"><table className="dir-table" id="dir-people-table"></table></div>
          <p className="dir-note">{t('director.perf.scoreNote')}</p>
          <h3>{t('director.perf.tasks')}</h3>
          <p className="dir-note">{t('director.perf.tasksNote')}</p>
          <div className="dir-table-wrap"><table className="dir-table" id="dir-task-table"></table></div>
          <h3>{t('director.perf.projects')}</h3>
          <div className="dir-table-wrap"><table className="dir-table" id="dir-proj-table"></table></div>
          <h3>{t('director.perf.recent')}</h3>
          <div className="dir-table-wrap"><table className="dir-table" id="dir-jobs-table"></table></div>
        </section>

        {/* the company's rules */}
        <section className="dir-pane dir-rules" data-pane="rules" hidden>
          <label className="dir-field">{t('director.rules.company')}<input id="dir-company" maxLength={60} placeholder={t('director.rules.companyPh')} /></label>
          <label className="dir-switch"><input type="checkbox" id="dir-rules-on" /><span>{t('director.rules.on')}</span></label>
          <textarea id="dir-rules" rows={12} maxLength={8000} placeholder={t('director.rules.ph')}></textarea>
          <div className="dir-rules-row">
            <button type="button" className="btn" id="dir-rules-tpl">{t('director.rules.template')}</button>
            <span className="dir-saved" id="dir-rules-saved"></span>
            <button type="button" className="btn btn--primary" id="dir-rules-save">{t('director.save')}</button>
          </div>
          <p className="dir-hook" id="dir-hook"></p>
          <h3>{t('director.rules.skills')}</h3>
          <p className="dir-note">{t('director.rules.skillsNote')}</p>
          <ul className="dir-skills" id="dir-skills"></ul>
        </section>

        {/* automation: budgets and the morning run */}
        <section className="dir-pane dir-auto" data-pane="auto" hidden>
          <h3>{t('director.budget.title')}</h3>
          <p className="dir-note">{t('director.budget.note')}</p>
          <div className="dir-hgrid">
            <label>{t('director.budget.person')}<input type="number" min={0} step={50} id="dir-b-person" /></label>
            <label>{t('director.budget.project')}<input type="number" min={0} step={50} id="dir-b-project" /></label>
          </div>
          <label className="dir-switch"><input type="checkbox" id="dir-b-stop" /><span>{t('director.budget.stop')}</span></label>
          <h3>{t('director.auto.heading')}</h3>
          <p className="dir-note">{t('director.auto.note')}</p>
          <label className="dir-switch"><input type="checkbox" id="dir-a-on" /><span>{t('director.auto.on')}</span></label>
          <label className="dir-switch"><input type="checkbox" id="dir-a-approve" /><span>{t('director.auto.approve')}</span></label>
          <div className="dir-hgrid">
            <label>{t('director.auto.at')}<input type="time" step={300} id="dir-a-at" /></label>
            <label>{t('director.auto.prompt')}<input id="dir-a-prompt" maxLength={400} /></label>
            <label>{t('director.auto.who')}<input id="dir-a-title" maxLength={60} /></label>
            <label>{t('director.perm.label')}<select id="dir-a-perm"></select></label>
          </div>
          <div className="dir-rules-row">
            <span className="dir-saved" id="dir-auto-saved"></span>
            <button type="button" className="btn btn--primary" id="dir-auto-save">{t('director.save')}</button>
          </div>
        </section>

        {/* office hours */}
        <section className="dir-pane dir-hours" data-pane="hours" hidden>
          <p className="dir-note">{t('director.hours.note')}</p>
          <div className="dir-hgrid" id="dir-hgrid"></div>
          <div className="dir-days" id="dir-wdays"></div>
          <div className="dir-today" id="dir-today"></div>
          <div className="dir-rules-row">
            <button type="button" className="btn" id="dir-hours-reset">{t('director.hours.reset')}</button>
            <span className="dir-saved" id="dir-hours-saved"></span>
            <button type="button" className="btn btn--primary" id="dir-hours-save">{t('director.save')}</button>
          </div>
        </section>
      </div>
    </div>
  );
}
