// The centred gate card shared by G-01, G-02, G-03 and P-01 (ui-spec G-01 layout: max 520, over --z-gate).
// The heading takes focus when the card first appears so screen readers start reading from the title, while no
// button is focused (prevents passing the notice with a stray Enter).
import { useEffect, useRef, type ReactNode } from 'react';
import { Logo } from '../brand/Logo';
import { useT } from '../i18n/useT';

export function GateCard({ title, testId, children, footer }: { title: string; testId: string; children: ReactNode; footer?: ReactNode }) {
  const t = useT();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  return (
    <main className="motion-fade-in-base relative z-(--z-gate) flex min-h-dvh items-start justify-center bg-background px-2 py-8 xs:px-4 md:items-center">
      <section data-testid={testId} className="flex w-full max-w-gate flex-col gap-6 rounded-lg bg-surface p-4 shadow-e2 xs:p-6 md:p-8">
        <Logo variant="lockup" height={28} label={t('brand.name')} />
        <h1 ref={headingRef} tabIndex={-1} className="text-title font-semibold outline-none">
          {title}
        </h1>
        {children}
        {footer}
      </section>
    </main>
  );
}
