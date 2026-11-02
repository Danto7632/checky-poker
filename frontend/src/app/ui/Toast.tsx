// Toast (components.md 1.10) on the existing `sonner` dependency: bottom centre, one sentence, 4 s (6 s with an
// action), role="status" region from sonner. Errors never end in a toast alone — callers keep a recovery path on
// screen.
//
// Bottom offset: `--toast-bottom` when a screen sets it, else 24 px + the safe area (screens off the table). The
// table sets it to its bottom slot's height + 16 px and marks :root with data-table-toasts, which makes toasts
// click-through (theme.css) — so on the table a toast never covers the action bar or the BetSizer confirm, takes
// no click and no hover, and therefore never freezes (W5 R0-2 R0-L18, MS-R0-3 D5; table/BottomSlot.tsx). Off the
// table, hover and focus still pause a toast. Both the desktop and the narrow-screen (< 600 px) offsets use it.
import { Toaster as SonnerToaster, toast } from 'sonner';

const BOTTOM = 'var(--toast-bottom, calc(var(--s-6) + env(safe-area-inset-bottom)))';

export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-center"
      visibleToasts={1}
      duration={4000}
      offset={{ bottom: BOTTOM }}
      mobileOffset={{ bottom: BOTTOM }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            'flex w-full max-w-toast items-center gap-3 rounded-md bg-raised px-4 py-3 text-small text-foreground shadow-e2',
        },
      }}
    />
  );
}

export function showToast(message: string): void {
  toast(message);
}
