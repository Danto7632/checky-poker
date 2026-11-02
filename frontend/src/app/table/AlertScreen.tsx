// E-ENG-INVARIANT (snapshot.alert, screen): the engine voided the hand (stacks back to the hand start) and paused the
// room. The contract (MA-R1-06) says the room is NOT closed: Resume continues, Start again makes a new table with the
// same settings, Leave goes home. Wording follows the p1 change note (Jonnathan to confirm in ui-spec).
// Details carry the code and a copyable diagnostics text (codes and timings only).
import { useMemo, useRef } from 'react';
import type { ErrorCode } from '@/config';
import { useT } from '../i18n/useT';
import { buildDiagnostics } from '../shell/diagnostics';
import { Button } from '../ui/Button';
import { ErrorState } from '../ui/ErrorState';

export function AlertScreen({ code, onResume, onRestart, onLeave }: { code: ErrorCode; onResume: () => void; onRestart: () => void; onLeave: () => void }) {
  const t = useT();
  const text = useMemo(() => JSON.stringify(buildDiagnostics(code)), [code]);
  const area = useRef<HTMLTextAreaElement>(null);
  const copy = () => {
    // Clipboard can be refused (permissions, insecure context): select the text so it can be copied by hand.
    navigator.clipboard?.writeText(text).catch(() => area.current?.select()) ?? area.current?.select();
  };
  return (
    <main className="min-h-dvh bg-background">
      <ErrorState
        testId="T-01.alert"
        title={t('invariant.title')}
        body={t('invariant.body')}
        code={code}
        detailsLabel={t('fail.details')}
        details={
          <div className="mt-2 flex flex-col gap-2">
            <textarea ref={area} readOnly value={text} rows={3} aria-label={t('fail.copyDiag')} className="w-full rounded-md border border-border bg-input p-2 font-mono text-micro text-foreground" />
            <Button size="sm" onClick={copy} data-testid="T-01.copyDiag">
              {t('fail.copyDiag')}
            </Button>
          </div>
        }
        actions={
          <>
            <Button variant="primary" onClick={onResume} data-testid="T-01.alertResume">
              {t('table.resume')}
            </Button>
            <Button onClick={onRestart} data-testid="T-01.alertRestart">
              {t('practice.crash.cta')}
            </Button>
            <Button variant="ghost" onClick={onLeave} data-testid="T-01.alertLeave">
              {t('table.leave')}
            </Button>
          </>
        }
      />
    </main>
  );
}
