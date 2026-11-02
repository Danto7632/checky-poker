// The table screen's only subscription (design-handoff 4.1): useSyncExternalStore over the session client.
// getSnapshot returns the same reference until something changed, so React re-renders only on real updates.
import { useCallback, useSyncExternalStore } from 'react';
import type { ClientSnapshot, TableClient } from '@/session';

export function useTableClient(client: TableClient): ClientSnapshot {
  const subscribe = useCallback((cb: () => void) => client.subscribe(cb), [client]);
  const getSnapshot = useCallback(() => client.getSnapshot(), [client]);
  return useSyncExternalStore(subscribe, getSnapshot);
}
