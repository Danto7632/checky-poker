// Select (components.md 1.7): a styled native <select> (keeps native accessibility and mobile pickers).
import { useId, type SelectHTMLAttributes } from 'react';
import { clsx } from 'clsx';

export interface SelectProps<V extends string> extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value'> {
  label: string;
  /** Visually hidden label (the context already names the control, e.g. the TopBar language switch). */
  hideLabel?: boolean;
  value: V;
  options: readonly { value: V; label: string; lang?: string }[];
  onChange: (value: V) => void;
  testId?: string | undefined;
}

export function Select<V extends string>({ label, hideLabel = false, value, options, onChange, className, testId, ...rest }: SelectProps<V>) {
  const id = useId();
  return (
    <div className={clsx('flex flex-col gap-1', className)}>
      <label htmlFor={id} className={hideLabel ? 'sr-only' : 'text-small font-medium text-muted-foreground'}>
        {label}
      </label>
      <select
        id={id}
        value={value}
        data-testid={testId}
        onChange={(e) => {
          const picked = options.find((o) => o.value === e.target.value);
          if (picked !== undefined) onChange(picked.value);
        }}
        className="h-11 rounded-md border border-border-strong bg-input px-3 text-body text-foreground"
        {...rest}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} lang={o.lang}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
