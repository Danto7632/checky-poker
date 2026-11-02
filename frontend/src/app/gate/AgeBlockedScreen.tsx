// G-02 under-18 block (E-GATE-UNDERAGE, screen). Nothing is saved (US1 AC2) and there is no other link: the only way
// on is reloading, which shows G-01 again.
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { GateCard } from './GateCard';

export function AgeBlockedScreen() {
  const t = useT();
  return (
    <GateCard title={t('gate.minor.title')} testId="G-02.card">
      <p className="text-body text-muted-foreground">{t('gate.minor.body')}</p>
      <Button variant="secondary" size="lg" onClick={() => window.location.reload()} data-testid="G-02.reload">
        {t('gate.minor.reload')}
      </Button>
    </GateCard>
  );
}
