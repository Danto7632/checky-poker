// Table loading (ui-spec T-01): nothing for the first 300 ms (a local Worker usually answers sooner), then the felt
// with six round seat skeletons. Never a spinner.
import { useEffect, useState } from 'react';
import { Skeleton } from '../ui/Skeleton';
import { Felt } from './Felt';
import { seatPointA } from './layout';

const DELAY_MS = 300;

export function TableLoading() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setShow(true), DELAY_MS);
    return () => clearTimeout(id);
  }, []);
  return (
    <main className="flex h-dvh items-center justify-center bg-background px-4" aria-busy="true" data-testid="T-01.loading">
      {show ? (
        <Felt>
          {[0, 1, 2, 3, 4, 5].map((p) => {
            const { x, y } = seatPointA(p, 6);
            return (
              <span key={p} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${x}%`, top: `${y}%` }}>
                <Skeleton round className="size-(--avatar)" />
              </span>
            );
          })}
        </Felt>
      ) : null}
    </main>
  );
}
