// Field (components.md 1.3): label above, 44 px input, hint or error below, optional code-point counter.
//
// Errors are linked with aria-describedby + aria-invalid. The counter counts code points of the trimmed value
// ([...value.trim()].length) — the same rule storage and the host use for nicknames (M3A-11) — and turns --warn
// from 90% of the limit.
import { forwardRef, useId, type InputHTMLAttributes } from 'react';
import { clsx } from 'clsx';
import { CircleAlert } from 'lucide-react';

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  hint?: string | undefined;
  error?: string | null | undefined;
  /** Maximum code points; shows "n/max". */
  counterMax?: number | undefined;
  testId?: string | undefined;
}

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, hint, error, counterMax, value, className, testId, ...rest },
  ref,
) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const length = typeof value === 'string' ? [...value.trim()].length : 0;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={clsx('flex flex-col gap-1', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-small font-medium text-muted-foreground">
          {label}
        </label>
        {counterMax !== undefined && (
          <span className={clsx('num text-small', length >= counterMax * 0.9 ? 'text-warn' : 'text-subtle')} aria-hidden="true">
            {length}/{counterMax}
          </span>
        )}
      </div>
      <input
        ref={ref}
        id={id}
        value={value}
        data-testid={testId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={clsx(
          'h-11 rounded-md border bg-input px-3 text-body text-foreground placeholder:text-muted-foreground focus:border-foreground',
          error ? 'border-critical' : 'border-border-strong',
        )}
        {...rest}
      />
      {error ? (
        <p id={errorId} className="flex items-center gap-1 text-small text-critical">
          <CircleAlert aria-hidden="true" width={16} height={16} />
          {error}
        </p>
      ) : null}
      {hint ? (
        <p id={hintId} className="text-small text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
});
