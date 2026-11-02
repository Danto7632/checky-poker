// Segmented single choice (components.md 1.6): Radix RadioGroup = role="radiogroup" + role="radio", arrow keys
// move and select. 44 px items, tabular numbers, the selected item gets --ink-700 and a 2 px --text underline.
// When the visible label is shortened ("30s"), `srLabel` gives the full accessible name ("30 seconds").
// Items keep their 56 px minimum and wrap to a second row on very narrow screens (320 px at 200 % zoom) instead of
// being clipped.
import { useId } from 'react';
import * as RadioGroup from '@radix-ui/react-radio-group';

export interface SegmentedOption<V extends string> {
  value: V;
  label: string;
  srLabel?: string | undefined;
  testId?: string | undefined;
}

export interface SegmentedProps<V extends string> {
  label: string;
  options: readonly SegmentedOption<V>[];
  value: V;
  onChange: (value: V) => void;
  describedBy?: string | undefined;
}

export function Segmented<V extends string>({ label, options, value, onChange, describedBy }: SegmentedProps<V>) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <span id={id} className="text-small font-medium text-muted-foreground">
        {label}
      </span>
      <RadioGroup.Root
        aria-labelledby={id}
        aria-describedby={describedBy}
        value={value}
        onValueChange={(v) => {
          const picked = options.find((o) => o.value === v);
          if (picked !== undefined) onChange(picked.value);
        }}
        orientation="horizontal"
        loop
        className="flex w-full flex-wrap overflow-hidden rounded-md border border-border-strong"
      >
        {options.map((o) => (
          <RadioGroup.Item
            key={o.value}
            value={o.value}
            aria-label={o.srLabel}
            data-testid={o.testId}
            className="num min-h-11 min-w-14 flex-1 border-b-2 border-transparent px-3 text-body text-muted-foreground transition-colors motion-transition hover:text-foreground data-[state=checked]:border-foreground data-[state=checked]:bg-ink-700 data-[state=checked]:text-foreground"
          >
            {o.label}
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>
    </div>
  );
}
