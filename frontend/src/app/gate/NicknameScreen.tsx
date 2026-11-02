// P-01 nickname, "create" variant (FS-GATE-5, US2). One field, a local avatar, Continue. Saving touches only this
// browser's storage (no fetch/XHR/WebSocket — NicknameScreen.test.tsx spies on all three). The "confirm" variant
// for invite links (FS-GATE-7) is 2-3's.
import { useState, type FormEvent } from 'react';
import { defaults } from '@/config';
import { useI18n } from '../i18n/useT';
import { useServices } from '../shell/ServicesProvider';
import { randomAvatarSeed } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { GateCard } from './GateCard';
import { errorCode, nicknameProblem } from './nickname';
import { ProfileFields } from './ProfileFields';

export function NicknameScreen() {
  const { t, td } = useI18n();
  const { saveProfile } = useServices();
  const [nickname, setNickname] = useState('');
  const [avatarSeed, setAvatarSeed] = useState(randomAvatarSeed);
  const [blurred, setBlurred] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const valid = nicknameProblem(nickname, defaults.DV16) === null;

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    setSubmitError(null);
    saveProfile({ nickname, avatarSeed }).catch((err: unknown) => {
      setSaving(false);
      setSubmitError(td(`err.${errorCode(err) ?? 'E-PROFILE-NICK-INVALID'}`));
    });
  };

  return (
    <GateCard title={t('profile.title')} testId="P-01.card">
      <form className="flex flex-col gap-6" onSubmit={submit} noValidate>
        <ProfileFields
          screen="P-01"
          nickname={nickname}
          onNickname={(v) => {
            setNickname(v);
            setSubmitError(null);
          }}
          avatarSeed={avatarSeed}
          onAvatarSeed={setAvatarSeed}
          blurred={blurred}
          onBlur={() => setBlurred(true)}
          submitError={submitError}
        />
        <p className="text-small text-muted-foreground">{t('profile.privacy')}</p>
        <Button type="submit" variant="primary" size="lg" disabled={!valid} loading={saving} data-testid="P-01.continue">
          {t('profile.continue')}
        </Button>
      </form>
    </GateCard>
  );
}
