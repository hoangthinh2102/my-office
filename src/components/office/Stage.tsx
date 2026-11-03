// The 3D stage and everything that floats over it.
import { getT } from '@/i18n/server';
import TimelinePanel from './TimelinePanel';
import PlaceCard from './PlaceCard';
import CameraToolbar from './CameraToolbar';
import FirstPersonHud from './FirstPersonHud';
import ReplayBar from './ReplayBar';
import PhotoBar from './PhotoBar';

export default async function Stage() {
  const t = await getT();
  return (
    <main className="stage-wrap" id="stage-wrap">
      <div id="stage"></div>
      <TimelinePanel />
      <PlaceCard />
      <nav className="chips" id="chips" aria-label={t('ui.stage.chips')}></nav>
      <CameraToolbar />
      <nav className="tw-lift" id="tw-lift" hidden aria-label={t('team.lift.title')}></nav>
      <div className="tw-card" id="tw-card" hidden role="dialog" aria-label={t('team.lift.title')}></div>
      <div className="tw-hint" id="tw-hint" hidden role="note"><span>{t('team.lift.first')}</span><button type="button" className="tw-hint-x" data-close aria-label={t('common.close')}>×</button></div>
      <div className="lite" id="lite" hidden aria-label={t('ui.stage.lite')}></div>
      <FirstPersonHud />
      <div className="perm-stack" id="perm-stack" hidden aria-live="assertive"></div>
      <div className="incident" id="incident" hidden role="alert"></div>
      <ReplayBar />
      <PhotoBar />
      <div className="empty" id="empty" hidden><b>{t('ui.stage.emptyTitle')}</b><span className="muted">{t('ui.stage.emptyText')}</span></div>
    </main>
  );
}
