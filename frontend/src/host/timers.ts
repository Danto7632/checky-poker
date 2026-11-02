// Timer port for the shell: executes the reducer's TIMER_START / TIMER_CANCEL effects with setTimeout.
// Starting an id that is already running replaces it, so a re-scheduled timer can never fire twice.
// ponytail: plain setTimeout, hidden-tab throttling can delay turn timers by >1 s (WR4); W.TICK correction is
// reserved for that case and needs lead approval.
export interface TimerPort {
  start(id: string, ms: number, fire: () => void): void;
  cancel(id: string): void;
  cancelAll(): void;
}

export function createTimers(): TimerPort {
  const running = new Map<string, ReturnType<typeof setTimeout>>();
  return {
    start(id, ms, fire) {
      const prev = running.get(id);
      if (prev !== undefined) clearTimeout(prev);
      running.set(
        id,
        setTimeout(() => {
          running.delete(id);
          fire();
        }, ms),
      );
    },
    cancel(id) {
      const h = running.get(id);
      if (h !== undefined) clearTimeout(h);
      running.delete(id);
    },
    cancelAll() {
      for (const h of running.values()) clearTimeout(h);
      running.clear();
    },
  };
}
