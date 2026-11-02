// IconButton (components.md 1.2): 44 x 44, icon 20, aria-label required. The same label shows as a tooltip after
// 400 ms for pointer and keyboard users (Tooltip); the accessible name never depends on the tooltip.
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { Tooltip } from './Tooltip';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  label: string;
  icon: ReactNode;
  variant?: 'ghost' | 'secondary';
  disabled?: boolean | undefined;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, variant = 'ghost', disabled = false, className, onClick, ...rest },
  ref,
) {
  return (
    <Tooltip content={label}>
      <button
        ref={ref}
        type="button"
        {...rest}
        aria-label={label}
        aria-disabled={disabled ? true : undefined}
        onClick={(e) => {
          if (disabled) e.preventDefault();
          else onClick?.(e);
        }}
        className={clsx(
          'inline-flex size-11 shrink-0 items-center justify-center rounded-md transition-colors motion-transition aria-disabled:opacity-45',
          variant === 'ghost' ? 'text-muted-foreground hover:text-foreground' : 'border border-border-strong bg-input text-foreground hover:bg-ink-700',
          className,
        )}
      >
        <span aria-hidden="true" className="inline-flex size-5 items-center justify-center">
          {icon}
        </span>
      </button>
    </Tooltip>
  );
});
