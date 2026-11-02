// Avatar preview + shuffle + nickname field, shared by P-01 (create) and S-01 (profile section).
import { Shuffle } from 'lucide-react';
import { defaults } from '@/config';
import { useT } from '../i18n/useT';
import { Avatar, randomAvatarSeed } from '../ui/Avatar';
import { Field } from '../ui/Field';
import { IconButton } from '../ui/IconButton';
import { nicknameProblem, visibleProblem } from './nickname';

const PROBLEM_KEY = { empty: 'profile.err.empty', spaces: 'profile.err.spaces', long: 'profile.err.long' } as const;

export interface ProfileFieldsProps {
  nickname: string;
  onNickname: (v: string) => void;
  avatarSeed: number;
  onAvatarSeed: (seed: number) => void;
  blurred: boolean;
  onBlur: () => void;
  /** Error from storage after submit (already translated). */
  submitError?: string | null | undefined;
  screen: 'P-01' | 'S-01';
}

export function ProfileFields({ nickname, onNickname, avatarSeed, onAvatarSeed, blurred, onBlur, submitError, screen }: ProfileFieldsProps) {
  const t = useT();
  const problem = visibleProblem(nicknameProblem(nickname, defaults.DV16), blurred);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <Avatar name={nickname} seed={avatarSeed} size={64} />
        <IconButton
          variant="secondary"
          label={t('profile.shuffle')}
          icon={<Shuffle width={20} height={20} />}
          onClick={() => onAvatarSeed(randomAvatarSeed())}
          data-testid={`${screen}.shuffle`}
        />
      </div>
      <Field
        label={t('profile.nickname')}
        value={nickname}
        onChange={(e) => onNickname(e.target.value)}
        onBlur={onBlur}
        autoComplete="nickname"
        counterMax={defaults.DV16.max}
        hint={t('profile.hint')}
        error={problem ? t(PROBLEM_KEY[problem]) : submitError}
        testId={`${screen}.nickname`}
      />
    </div>
  );
}
