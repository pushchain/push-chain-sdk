import { resolveModalTrigger } from './modalTrigger';

type Rect = { left: number; top: number; width: number; height: number };

const el = ({ left, top, width, height }: Rect) =>
  ({
    getBoundingClientRect: () => ({
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
    }),
  }) as unknown as HTMLElement;

// Viewport narrowed to 1300px by a docked browser side panel.
beforeAll(() => {
  (globalThis as { window?: unknown }).window = { innerWidth: 1300, innerHeight: 900 };
});

const header = el({ left: 1060, top: 20, width: 200, height: 44 });
// Same button inside a closed drawer at translateX(-100%).
const drawer = el({ left: -270, top: 16, width: 200, height: 44 });

describe('resolveModalTrigger', () => {
  it('uses the active trigger when it is on screen', () => {
    expect(resolveModalTrigger('header', { header, drawer })).toBe(header);
  });

  it('falls back to an on-screen trigger when the active one is off-canvas', () => {
    expect(resolveModalTrigger('drawer', { header, drawer })).toBe(header);
  });

  it('skips triggers hidden with display: none', () => {
    const hidden = el({ left: 0, top: 0, width: 0, height: 0 });
    expect(resolveModalTrigger('hidden', { hidden, header })).toBe(header);
  });

  it('skips triggers past the right edge of the viewport', () => {
    const offRight = el({ left: 1400, top: 20, width: 200, height: 44 });
    expect(resolveModalTrigger('offRight', { offRight, header })).toBe(header);
  });

  it('falls back to the active trigger when nothing is on screen', () => {
    expect(resolveModalTrigger('drawer', { drawer })).toBe(drawer);
  });

  it('uses any on-screen trigger when none is active yet', () => {
    expect(resolveModalTrigger(null, { drawer, header })).toBe(header);
  });

  it('returns null with no triggers', () => {
    expect(resolveModalTrigger('missing', {})).toBeNull();
  });
});
