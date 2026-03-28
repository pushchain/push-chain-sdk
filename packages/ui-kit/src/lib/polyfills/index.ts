// import { Buffer as PolyBuffer } from 'buffer';
// import type { Buffer as BufferType } from 'buffer';

// declare global {
//   // eslint-disable-next-line no-var
//   var Buffer: BufferType;
// }

// const g: any = globalThis;
// if (!g.Buffer || !g.Buffer.from || !g.Buffer.alloc) g.Buffer = PolyBuffer;

// if (typeof globalThis.process === 'undefined') {
//   (globalThis as any).process = { env: {} };
// }

// if (typeof globalThis.global === 'undefined') {
//   (globalThis as any).global = globalThis;
// }