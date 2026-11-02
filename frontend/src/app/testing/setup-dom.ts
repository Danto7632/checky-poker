// Minimal DOM shims some Radix primitives need under happy-dom (tests only).
export function installDomShims(): void {
  if (typeof window.matchMedia !== 'function') {
    window.matchMedia = (query: string) =>
      ({ matches: false, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }) as MediaQueryList;
  }
  if (typeof Element.prototype.scrollIntoView !== 'function') Element.prototype.scrollIntoView = () => undefined;
}
