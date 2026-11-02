// Dialog (components.md 1.9) for confirmations. Destructive or leaving confirmations use role="alertdialog" with
// the safe action focused first (patterns section 4): `safeAction` is rendered with Radix AlertDialog.Cancel,
// which receives initial focus.
import type { ReactNode } from 'react';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { Button } from './Button';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: ReactNode;
  safeLabel: string;
  confirmLabel: string;
  onConfirm: () => void;
  testId?: string | undefined;
}

export function ConfirmDialog({ open, onOpenChange, title, body, safeLabel, confirmLabel, onConfirm, testId }: ConfirmDialogProps) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="motion-fade-in fixed inset-0 z-(--z-dialog) bg-background/70" />
        <AlertDialog.Content
          data-testid={testId}
          className="motion-fade-in-base fixed top-1/2 left-1/2 z-(--z-dialog) w-[calc(100%-var(--s-8))] max-w-dialog -translate-x-1/2 -translate-y-1/2 rounded-lg bg-raised p-6 shadow-e3"
        >
          <AlertDialog.Title className="text-title-sm font-semibold">{title}</AlertDialog.Title>
          <AlertDialog.Description asChild>
            <div className="mt-2 text-body text-muted-foreground">{body}</div>
          </AlertDialog.Description>
          <div className="mt-6 flex flex-col-reverse gap-2 md:flex-row md:justify-end">
            <AlertDialog.Cancel asChild>
              <Button variant="secondary">{safeLabel}</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button variant="danger" onClick={onConfirm}>
                {confirmLabel}
              </Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
