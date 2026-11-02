// Popover (components.md 1.11) for required explanations behind an (i) IconButton; Radix Popover handles focus
// and Esc. Seat popovers (mute, kick) arrive with chat in 2-3.
import type { ReactElement, ReactNode } from 'react';
import * as RadixPopover from '@radix-ui/react-popover';

export function Popover({ trigger, children }: { trigger: ReactElement; children: ReactNode }) {
  return (
    <RadixPopover.Root>
      <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content sideOffset={6} className="z-(--z-panel) max-w-xs rounded-md bg-raised p-3 text-small text-foreground shadow-e2">
          {children}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}
