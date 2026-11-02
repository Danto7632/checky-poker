// EmptyState (components.md 1.15): an empty screen is an onboarding moment — title, one sentence, one primary
// action and an optional secondary one.
import type { ReactNode } from 'react';

export function EmptyState({ title, body, actions }: { title: string; body: string; actions: ReactNode }) {
  return (
    <section className="flex flex-col items-center gap-3 py-10 text-center">
      <h2 className="text-title-sm font-semibold">{title}</h2>
      <p className="max-w-prose text-body text-muted-foreground">{body}</p>
      <div className="flex flex-wrap justify-center gap-2">{actions}</div>
    </section>
  );
}
