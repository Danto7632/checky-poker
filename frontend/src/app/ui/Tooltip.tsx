// Tooltip (components.md 1.11): 400 ms delay, Esc closes, never the only source of required information (touch
// devices do not show it). Wraps Radix Tooltip; TooltipProvider sits once in App.
import type { ReactElement, ReactNode } from 'react';
import * as RadixTooltip from '@radix-ui/react-tooltip';

export function TooltipProvider({ children }: { children: ReactNode }) {
  return <RadixTooltip.Provider delayDuration={400}>{children}</RadixTooltip.Provider>;
}

export function Tooltip({ content, children }: { content: string; children: ReactElement }) {
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          sideOffset={6}
          className="z-(--z-toast) max-w-xs rounded-sm bg-raised px-2 py-1 text-small text-foreground shadow-e2"
        >
          {content}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
