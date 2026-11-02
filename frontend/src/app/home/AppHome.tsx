// H-01 app home (R0 part): greeting with the avatar and an edit link, the Practice card, the disclosure line.
// Cards for screens that do not exist yet (friends, join by code, watch bots, recent hands) are added by the stories
// that build those screens — no dead entry points (US45 AC1).
// The Practice card says "works offline": what makes it true is the shell warm-up GateRoute runs once the gate is
// passed (practice/warmup.ts, R0-L29) — the PracticeScreen chunk, game services, both Workers and the font subsets
// are fetched online whichever screen the tab entered on, so H-01 itself starts nothing.
import { Bot } from 'lucide-react';
import { Link } from 'react-router';
import { useT } from '../i18n/useT';
import { useServices } from '../shell/ServicesProvider';
import { Avatar } from '../ui/Avatar';
import { ModeCard } from './ModeCard';
import { StorageBanner } from './StorageBanner';

export function AppHome() {
  const t = useT();
  const { profile } = useServices();
  return (
    <>
      <StorageBanner />
      {profile ? (
        <div className="flex items-center gap-3">
          <Avatar name={profile.nickname} seed={profile.avatarSeed} size={32} />
          <h1 className="text-title-sm font-semibold">{t('home.hi', { name: profile.nickname })}</h1>
          <Link to="/settings#profile" className="inline-flex min-h-11 items-center px-1 text-small text-info underline" data-testid="H-01.edit">
            {t('home.edit')}
          </Link>
        </div>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        <ModeCard
          to="/practice"
          testId="H-01.practice"
          icon={<Bot width={24} height={24} />}
          title={t('home.practice.title')}
          body={t('home.practice.body')}
        />
      </div>
      <p className="mt-auto pt-6 text-small text-muted-foreground">{t('footer.disclosure')}</p>
    </>
  );
}
