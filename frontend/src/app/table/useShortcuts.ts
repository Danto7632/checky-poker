// Single-letter table shortcuts (patterns section 12, WCAG 2.1.4): ignored while typing in a field and while a sheet
// or dialog is open, and the whole set can be switched off from TableMenu "Keyboard shortcuts". Keys are matched
// case-insensitively.
//
// Why the modal rule lives here and not in each caller: F, C and P send game actions that cannot be undone. Behind the
// Leave confirmation or the menu sheet the user has not chosen them (focus sits on "Stay"), and a screen reader in
// focus mode passes letter keys straight through (review M2). Every caller (ActionBar, TableScreen) goes through this
// hook, so one guard covers them all, including dialogs later stories add.
import { useEffect, useRef } from 'react';

// Radix renders Sheet and Dialog content with role="dialog" / "alertdialog"; aria-modal covers any other modal.
const MODAL = '[role="dialog"], [role="alertdialog"], [aria-modal="true"]';

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/**
 * True while a sheet or dialog is in the document. This also covers key events from inside one: a modal traps
 * focus, so its events only exist while it is open.
 */
export function modalOpen(): boolean {
  return document.querySelector(MODAL) !== null;
}

export function useShortcuts(enabled: boolean, map: Readonly<Record<string, () => void>>): void {
  // Keep the latest handlers without re-binding the listener on every render.
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    if (!enabled) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target) || modalOpen()) return;
      const handler = ref.current[e.key.length === 1 ? e.key.toLowerCase() : e.key];
      if (handler === undefined) return;
      e.preventDefault();
      handler();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
