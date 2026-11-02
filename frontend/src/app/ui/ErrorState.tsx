// ErrorState (components.md 1.15): title = what happened, body = why and how, actions = retry + an exit (screen
// errors always offer two or more ways out, exceptions.md section 0), collapsed "Details" with the mono error code.
// No apologies in the copy. The title takes focus when the state appears so screen readers start there.
import { useEffect, useRef, type ReactNode } from 'react';
import { CircleAlert } from 'lucide-react';

export interface ErrorStateProps {
  title: string;
  body?: string | undefined;
  actions: ReactNode;
  code?: string | undefined;
  detailsLabel?: string | undefined;
  details?: ReactNode;
  testId?: string | undefined;
}

export function ErrorState({ title, body, actions, code, detailsLabel, details, testId }: ErrorStateProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  return (
    <section data-testid={testId} className="mx-auto flex w-full max-w-gate flex-col gap-4 px-4 py-10">
      <CircleAlert aria-hidden="true" width={32} height={32} className="text-critical" />
      <h1 ref={headingRef} tabIndex={-1} className="text-title font-semibold outline-none">
        {title}
      </h1>
      {body ? <p className="text-body text-muted-foreground">{body}</p> : null}
      <div className="flex flex-col gap-2 md:flex-row">{actions}</div>
      {code !== undefined && detailsLabel !== undefined ? (
        <details className="text-small text-muted-foreground">
          <summary className="min-h-11 cursor-pointer py-2">{detailsLabel}</summary>
          <p className="font-mono">{code}</p>
          {details}
        </details>
      ) : null}
    </section>
  );
}
