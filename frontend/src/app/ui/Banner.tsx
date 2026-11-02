// Banner (components.md 1.13): icon + title + body + up to two actions, full *-soft background with a 1 px border
// of the same colour. Warnings and errors use role="alert" (announced once on mount); info uses role="status".
import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import { CircleAlert, Info, TriangleAlert, X } from 'lucide-react';

export type BannerTone = 'info' | 'warn' | 'critical' | 'good';

const TONE: Record<BannerTone, string> = {
  info: 'bg-info-soft border-info/40 text-info',
  warn: 'bg-warn-soft border-warn/40 text-warn',
  critical: 'bg-critical-soft border-critical/40 text-critical',
  good: 'bg-good-soft border-good/40 text-good',
};

export interface BannerProps {
  tone: BannerTone;
  title?: string | undefined;
  children?: ReactNode;
  actions?: ReactNode;
  onDismiss?: (() => void) | undefined;
  dismissLabel?: string | undefined;
  testId?: string | undefined;
}

export function Banner({ tone, title, children, actions, onDismiss, dismissLabel, testId }: BannerProps) {
  const Icon = tone === 'critical' ? CircleAlert : tone === 'warn' ? TriangleAlert : Info;
  return (
    <div
      role={tone === 'warn' || tone === 'critical' ? 'alert' : 'status'}
      data-testid={testId}
      className={clsx('flex items-start gap-3 rounded-md border px-4 py-3', TONE[tone])}
    >
      <Icon aria-hidden="true" width={20} height={20} className="mt-0.5 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-1 text-small text-foreground">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children}
        {actions ? <div className="mt-1 flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      {onDismiss && dismissLabel ? (
        <button type="button" onClick={onDismiss} aria-label={dismissLabel} className="-m-2 inline-flex size-11 items-center justify-center rounded-md text-muted-foreground hover:text-foreground">
          <X aria-hidden="true" width={16} height={16} />
        </button>
      ) : null}
    </div>
  );
}
