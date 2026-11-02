// G-01 notice before play (SS2, SS3, US1). Four statements, two buttons, the language switch at the bottom.
// The destination chip reassures people who arrived from a link that their link still works (SS2 rule 5).
import { Ban, Coins, Smile, UserCheck } from 'lucide-react';
import { useT, type MessageKey } from '../i18n/useT';
import { LanguageSwitch } from '../shell/LanguageSwitch';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { GateCard } from './GateCard';

const DESTINATION: Readonly<Record<string, MessageKey>> = {
  '/join': 'gate.dest.join',
  '/replay': 'gate.dest.replay',
  '/practice': 'gate.dest.practice',
  '/arena': 'gate.dest.arena',
};

const ITEMS = [
  ['gate.item.age', UserCheck],
  ['gate.item.chips', Coins],
  ['gate.item.noMoney', Ban],
  ['gate.item.notGambling', Smile],
] as const;

export function DisclosureScreen({ destination, onAdult, onUnderage }: { destination: string; onAdult: () => void; onUnderage: () => void }) {
  const t = useT();
  const dest = DESTINATION[destination];
  return (
    <GateCard title={t('gate.title')} testId="G-01.card" footer={<LanguageSwitch testId="G-01.language" />}>
      {dest ? (
        <Badge tone="info" caps={false} wrap data-testid="G-01.destination" className="self-start">
          {t(dest)}
        </Badge>
      ) : null}
      <ul className="flex flex-col gap-4">
        {ITEMS.map(([key, Icon]) => (
          <li key={key} className="flex items-start gap-3 text-body">
            <Icon aria-hidden="true" width={20} height={20} className="mt-0.5 shrink-0 text-muted-foreground" />
            <span>{t(key)}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-2">
        <Button variant="primary" size="lg" onClick={onAdult} data-testid="G-01.ctaAdult" className="w-full">
          {t('gate.cta.adult')}
        </Button>
        <Button variant="secondary" size="lg" onClick={onUnderage} data-testid="G-01.ctaMinor" className="w-full">
          {t('gate.cta.minor')}
        </Button>
      </div>
    </GateCard>
  );
}
