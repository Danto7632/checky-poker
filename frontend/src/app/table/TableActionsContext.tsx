// Commands for table components (design-handoff 4.1): children get data as props and commands from this one context,
// so no component below TableScreen holds the client itself. Practice adds pause/resume/setOption.
import { createContext, useContext } from 'react';
import type { EngineAction } from '@checky/engine/protocol';
import type { Ack } from '@/session';

export interface TableActions {
  act(action: EngineAction): Promise<Ack>;
  sit(mode: 'out' | 'in'): void;
  refill(): void;
  pause(): void;
  resume(): void;
  setOption(opt: { liveEquity?: boolean; botChatter?: boolean }): void;
  /** Leave flow owned by the screen (confirm dialog when in a hand, then leave + dispose + /app). */
  requestLeave(): void;
}

export const TableActionsContext = createContext<TableActions | null>(null);

export function useTableActions(): TableActions {
  const value = useContext(TableActionsContext);
  if (value === null) throw new Error('useTableActions must be used inside TableActionsContext');
  return value;
}
