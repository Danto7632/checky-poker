// G-03 adult-confirmation slot (flag VITE_ADULT_CHECK, FS-GATE-3). Frame only in this cycle: the body is filled once
// the confirmation method is decided (after the GRAC reply). Passing it lasts for this tab.
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { GateCard } from './GateCard';

export function AdultCheckSlot({ onContinue }: { onContinue: () => void }) {
  const t = useT();
  return (
    <GateCard title={t('gate.adult.title')} testId="G-03.card">
      <Button variant="primary" size="lg" onClick={onContinue} data-testid="G-03.continue">
        {t('gate.adult.continue')}
      </Button>
    </GateCard>
  );
}
