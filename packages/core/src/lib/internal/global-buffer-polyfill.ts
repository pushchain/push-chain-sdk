import { Buffer as PolyBuffer } from './buffer';

const g: any = globalThis;
if (!g.Buffer || !g.Buffer.from || !g.Buffer.alloc) {
  g.Buffer = PolyBuffer;
}
