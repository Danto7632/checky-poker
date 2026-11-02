// Kbd (components.md 1.16): desktop-only shortcut hint; hidden from assistive tech because the button label
// already names the action.
export function Kbd({ children }: { children: string }) {
  return (
    <kbd aria-hidden="true" className="hidden rounded-xs border border-border-strong px-1 font-mono text-micro text-muted-foreground lg:inline">
      {children}
    </kbd>
  );
}
