import { Buffer as NodeBuffer } from 'buffer';

if (typeof globalThis.process === 'undefined') {
  (globalThis as any).process = { env: {} };
}

if (typeof globalThis.global === 'undefined') {
  (globalThis as any).global = globalThis;
}

// if (typeof globalThis.Buffer === 'undefined') {
//   (globalThis as any).Buffer = NodeBuffer;
// }