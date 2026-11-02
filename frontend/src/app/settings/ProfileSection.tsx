// S-01 profile and language section. Changes save at once (no Save button, no toast) and a "Saved" status shows for
// 1.5 s. A nickname change applies to the next table: an open practice table keeps the profile snapshot it was
// created with (US2 AC3, settings.profile.note).
import { useEffect, useRef, useState } from 'react';
import { defaults } from '@/config';
import { errorCode, nicknameProblem } from '../gate/nickname';
import { ProfileFields } from '../gate/ProfileFields';
import { useI18n } from '../i18n/useT';
import { LanguageSwitch } from '../shell/LanguageSwitch';
import { useServices } from '../shell/ServicesProvider';

const SAVED_MS = 1500;

export function ProfileSection() {
  const { t, td } = useI18n();
  const { profile, saveProfile } = useServices();
  const [nickname, setNickname] = useState(profile?.nickname ?? '');
  const [avatarSeed, setAvatarSeed] = useState(profile?.avatarSeed ?? 0);
  const [blurred, setBlurred] = useState(false);
  const [saved, setSaved] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);

  const persist = (next: { nickname: string; avatarSeed: number }) => {
    if (nicknameProblem(next.nickname, defaults.DV16) !== null) return;
    if (profile && next.nickname.trim() === profile.nickname && next.avatarSeed === profile.avatarSeed) return;
    saveProfile(next)
      .then(() => {
        setSubmitError(null);
        setSaved(true);
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = setTimeout(() => setSaved(false), SAVED_MS);
      })
      .catch((err: unknown) => setSubmitError(td(`err.${errorCode(err) ?? 'E-PROFILE-NICK-INVALID'}`)));
  };

  return (
    <section id="profile" aria-labelledby="settings-profile" className="flex flex-col gap-4 rounded-lg bg-surface p-5">
      <h2 id="settings-profile" className="text-title-sm font-semibold">
        {t('settings.profile')}
      </h2>
      <ProfileFields
        screen="S-01"
        nickname={nickname}
        onNickname={setNickname}
        avatarSeed={avatarSeed}
        onAvatarSeed={(seed) => {
          setAvatarSeed(seed);
          persist({ nickname, avatarSeed: seed });
        }}
        blurred={blurred}
        onBlur={() => {
          setBlurred(true);
          persist({ nickname, avatarSeed });
        }}
        submitError={submitError}
      />
      <LanguageSwitch testId="S-01.language" showLabel />
      <p className="text-small text-muted-foreground">{t('settings.profile.note')}</p>
      <p role="status" className="min-h-6 text-small text-good" data-testid="S-01.saved">
        {saved ? t('settings.saved') : ''}
      </p>
    </section>
  );
}
