// PreActionToggle (components.md 3.10, SS9 rule 4, G-8): the ONLY pre-selection is "Check/Fold". When it is on and
// my turn arrives, it sends check if check is legal, otherwise fold — immediately, once. It resets every hand.
// No "Call any", no auto-raise.
import { useEffect, useRef, useState } from 'react';
import type { EngineAction, LegalActions } from '@checky/engine/protocol';
import { useT } from '../i18n/useT';
import { Toggle } from '../ui/Toggle';

export interface PreActionProps {
  handId: string;
  /** Present when it is my turn; null while waiting. */
  legal: LegalActions | null;
  turnKey: string;
  seat: number;
  onAct: (action: EngineAction) => void;
}

/** The action the toggle sends for a given legal set. */
export function checkOrFold(legal: LegalActions, seat: number): EngineAction {
  return legal.check ? { seat, type: 'check' } : { seat, type: 'fold' };
}

export function usePreAction({ handId, legal, turnKey, seat, onAct }: PreActionProps): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(false);
  const fired = useRef<string | null>(null);
  useEffect(() => setOn(false), [handId]);
  useEffect(() => {
    if (!on || legal === null || fired.current === turnKey) return;
    fired.current = turnKey;
    setOn(false);
    onAct(checkOrFold(legal, seat));
  }, [on, legal, turnKey, seat, onAct]);
  return [on, setOn];
}

export function PreActionToggle({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  const t = useT();
  return (
    <div className="w-full max-w-xs" data-testid="T-01.preAction">
      <Toggle label={t('pre.checkFold')} description={t('pre.checkFold.hint')} checked={on} onCheckedChange={onChange} testId="T-01.checkFold" />
    </div>
  );
}
