// Progress (components.md 1.14) for waits over 2 s with a known or unknown total. Without `value` it is an
// indeterminate progressbar (no aria-valuenow) and the caller shows a sentence saying what is happening.
import * as RadixProgress from '@radix-ui/react-progress';

export function Progress({ value, label }: { value?: number | undefined; label: string }) {
  return (
    <RadixProgress.Root
      aria-label={label}
      value={value ?? null}
      className="relative h-2 w-full overflow-hidden rounded-pill bg-input"
    >
      <RadixProgress.Indicator
        className="h-full bg-foreground transition-transform motion-transition"
        style={{ transform: `translateX(-${100 - (value ?? 30)}%)` }}
      />
    </RadixProgress.Root>
  );
}
