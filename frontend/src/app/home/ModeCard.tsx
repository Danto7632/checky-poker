// ModeCard (components.md section 8): the whole card is one link — icon, title, one line of description.
import type { ReactNode } from 'react';
import { Link } from 'react-router';

export function ModeCard({ to, icon, title, body, testId }: { to: string; icon: ReactNode; title: string; body: string; testId: string }) {
  return (
    <Link
      to={to}
      data-testid={testId}
      className="flex min-h-30 flex-col gap-2 rounded-lg bg-raised p-5 shadow-e1 transition-colors motion-transition hover:bg-input"
    >
      <span aria-hidden="true" className="text-muted-foreground">
        {icon}
      </span>
      <span className="text-title-sm font-semibold text-foreground">{title}</span>
      <span className="text-body text-muted-foreground">{body}</span>
    </Link>
  );
}
