import { Buffer as PolyBuffer } from 'buffer';

export const Buffer: typeof PolyBuffer =
  (globalThis as any).Buffer ?? PolyBuffer;
