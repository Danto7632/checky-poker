// Button (components.md 1.1). Variants and sizes map to tokens only; one `primary` per screen is a usage rule.
//
// Disabled buttons use aria-disabled instead of the native attribute so they stay focusable and screen readers
// can reach the reason text next to them; clicks are swallowed here. `loading` keeps the label and width and adds a
// spinner (aria-busy). The sm size (36 px) gets an invisible 44 px hit area (WCAG 2.5.8, tokens --tap-min).
// Sizes are minimum heights and labels may wrap: a long ja label at 320 px / 200 % zoom grows the button instead of
// overflowing it (design-handoff section 9.3).
import { forwardRef, type ButtonHTMLAttributes, type MouseEvent, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'disabled'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean | undefined;
  loading?: boolean | undefined;
  icon?: ReactNode;
}

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-press',
  secondary: 'bg-input text-foreground border border-border-strong hover:bg-ink-700',
  ghost: 'bg-transparent text-muted-foreground hover:text-foreground',
  danger: 'bg-critical text-primary-foreground',
  link: 'bg-transparent text-info underline underline-offset-2 px-0',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'min-h-9 px-3 py-1 text-small font-semibold before:absolute before:inset-x-0 before:-inset-y-1',
  md: 'min-h-11 px-4 py-2 text-body font-semibold',
  lg: 'min-h-13 px-5 py-2 text-body font-semibold',
  xl: 'min-h-15 px-6 py-2 text-body font-bold',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', disabled = false, loading = false, icon, className, onClick, children, ...rest },
  ref,
) {
  const blocked = disabled || loading;
  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (blocked) {
      e.preventDefault();
      return;
    }
    onClick?.(e);
  };
  return (
    <button
      ref={ref}
      type="button"
      {...rest}
      aria-disabled={disabled ? true : undefined}
      aria-busy={loading ? true : undefined}
      onClick={handleClick}
      className={clsx(
        'relative inline-flex select-none items-center justify-center gap-2 text-center rounded-md transition-colors motion-transition active:translate-y-px aria-disabled:opacity-45 aria-disabled:active:translate-y-0',
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      data-motion="move"
    >
      {loading ? <Spinner size={16} /> : icon}
      {children}
    </button>
  );
});
