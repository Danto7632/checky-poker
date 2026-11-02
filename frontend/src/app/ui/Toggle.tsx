// Toggle (components.md 1.5): Radix Switch (role="switch" + aria-checked), 44 x 24 track inside a 44 px hit area.
// The "on" track uses --text, not the accent (the accent is kept for three uses only).
import { useId } from 'react';
import * as Switch from '@radix-ui/react-switch';

export interface ToggleProps {
  label: string;
  description?: string | undefined;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean | undefined;
  testId?: string | undefined;
}

export function Toggle({ label, description, checked, onCheckedChange, disabled = false, testId }: ToggleProps) {
  const id = useId();
  return (
    <div className="flex min-h-11 items-center justify-between gap-4">
      <div className="flex flex-col">
        <label htmlFor={id} className="text-body text-foreground">
          {label}
        </label>
        {description ? (
          <span id={`${id}-d`} className="text-small text-muted-foreground">
            {description}
          </span>
        ) : null}
      </div>
      <Switch.Root
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        data-testid={testId}
        aria-describedby={description ? `${id}-d` : undefined}
        className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-pill border border-border-strong bg-ink-700 transition-colors motion-transition before:absolute before:-inset-y-2.5 before:inset-x-0 data-[state=checked]:border-foreground data-[state=checked]:bg-foreground disabled:opacity-45"
      >
        <Switch.Thumb
          data-motion="move"
          className="block size-5 translate-x-0.5 rounded-pill bg-muted-foreground transition-transform motion-transition data-[state=checked]:translate-x-5 data-[state=checked]:bg-background"
        />
      </Switch.Root>
    </div>
  );
}
