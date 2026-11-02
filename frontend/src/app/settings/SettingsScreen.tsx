// S-01 settings (R0: the profile section). 2-3 adds #help, 3-3 #keys, 4-3 #data as further sections; the hash only
// scrolls, it is never stripped (routes.v1 fragments.section).
import { useEffect } from 'react';
import { useLocation } from 'react-router';
import { useT } from '../i18n/useT';
import { useServices } from '../shell/ServicesProvider';
import { ProfileSection } from './ProfileSection';

export function SettingsScreen() {
  const t = useT();
  const { profile } = useServices();
  const { hash } = useLocation();
  useEffect(() => {
    if (hash.length > 1) document.getElementById(hash.slice(1))?.scrollIntoView?.();
  }, [hash]);
  return (
    <>
      <h1 className="text-title font-semibold">{t('settings.title')}</h1>
      {/* Mount once the profile is read, so the fields start from the stored values (always true behind GateRoute). */}
      {profile !== undefined ? <ProfileSection /> : null}
      <p className="mt-auto pt-6 text-small text-muted-foreground">{t('footer.disclosure')}</p>
    </>
  );
}
