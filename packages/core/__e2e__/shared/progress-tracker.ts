/**
 * Creates a progress event tracker for use in beforeAll/test blocks.
 */
export function createProgressTracker() {
  const events: { event: any; timestamp: number }[] = [];
  let startTime = Date.now();

  return {
    events,
    startTime,
    hook: (val: any) => {
      const now = Date.now();
      events.push({ event: val, timestamp: now });
      const elapsed = ((now - startTime) / 1000).toFixed(2);
      console.log(`[${elapsed}s] ${val.id}: ${val.title}`);
    },
    reset: () => {
      events.length = 0;
      startTime = Date.now();
    },
    hasEvent: (id: string) => events.some((e) => e.event.id === id),
    getIds: () => events.map((e) => e.event.id),
    getDurations: () => {
      const durations: {
        step: string;
        duration: number;
        from: string;
        to: string;
      }[] = [];
      for (let i = 1; i < events.length; i++) {
        const prev = events[i - 1];
        const curr = events[i];
        const duration = (curr.timestamp - prev.timestamp) / 1000;
        durations.push({
          step: `${prev.event.id} -> ${curr.event.id}`,
          duration,
          from: prev.event.title,
          to: curr.event.title,
        });
      }
      durations.sort((a, b) => b.duration - a.duration);
      return durations;
    },
  };
}

/**
 * Asserts that standard bridge hooks were emitted.
 */
export function expectBridgeHooks(
  hookIds: string[],
  opts?: { expectConfirmation?: boolean }
) {
  expect(hookIds).toContain('SEND-TX-01');
  if (opts?.expectConfirmation) {
    expect(hookIds).toContain('SEND-TX-06-04');
    expect(hookIds).toContain('SEND-TX-06-05');
    expect(hookIds).toContain('SEND-TX-06-06');
  }
  expect(hookIds).toContain('SEND-TX-99-01');
}
