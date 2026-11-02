// Sheet (components.md 1.8): bottom sheet below 768 px, right side sheet (440) from 768 px. Radix Dialog gives
// role="dialog", aria-modal, focus trap and Esc / outside click to close. A visible close button is the non-drag
// alternative (WCAG 2.5.7).
// Focus return to the opener (1.8) is done here: Radix returns focus only to its own Dialog.Trigger, and this sheet
// is opened from outside (controlled `open`, e.g. TableHud's menu button), so every close — Esc, the close button,
// a row that closes it (lead review 4 D-R3-2 added Keep playing) — used to leave focus on <body>. The element that
// had focus when the sheet opened gets it back, unless focus already went elsewhere (Leave table opens its
// confirmation, which focuses Stay).
import { useRef, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  closeLabel: string;
  children: ReactNode;
  testId?: string | undefined;
}

export function Sheet({ open, onOpenChange, title, closeLabel, children, testId }: SheetProps) {
  const opener = useRef<HTMLElement | null>(null);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="motion-fade-in fixed inset-0 z-(--z-sheet) bg-background/70" />
        <Dialog.Content
          data-testid={testId}
          aria-describedby={undefined}
          onOpenAutoFocus={() => {
            // Runs before Radix moves focus in, so this is still the opener.
            opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          }}
          onCloseAutoFocus={() => {
            // Not over a dialog that took focus meanwhile: its trap would pull focus back, after a screen reader
            // already announced the opener.
            if (document.activeElement === null || document.activeElement === document.body) opener.current?.focus();
            opener.current = null;
          }}
          className="motion-fade-in-base fixed inset-x-0 bottom-0 z-(--z-sheet) flex max-h-(--sheet-max-h) flex-col rounded-t-lg bg-surface shadow-e3 md:inset-y-0 md:right-0 md:left-auto md:max-h-none md:w-110 md:rounded-none"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
            <Dialog.Title className="text-title-sm font-semibold">{title}</Dialog.Title>
            <Dialog.Close className="inline-flex size-11 items-center justify-center rounded-md text-muted-foreground hover:text-foreground" aria-label={closeLabel}>
              <X aria-hidden="true" width={20} height={20} />
            </Dialog.Close>
          </div>
          <div className="overflow-y-auto px-4 py-4">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
