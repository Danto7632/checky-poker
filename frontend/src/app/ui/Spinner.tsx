// Spinner (components.md 1.14): only inside buttons for waits under 2 seconds. Rotation stops under
// prefers-reduced-motion (motion-reduce), leaving a static ring.
import { LoaderCircle } from 'lucide-react';

export function Spinner({ size = 16 }: { size?: 16 | 20 | 24 }) {
  return <LoaderCircle aria-hidden="true" width={size} height={size} className="animate-spin motion-reduce:animate-none" />;
}
