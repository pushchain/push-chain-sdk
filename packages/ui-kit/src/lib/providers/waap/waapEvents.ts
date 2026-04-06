type Waap = {
  on: (event: string, cb: (data: any) => void) => void;
  off?: (event: string, cb: (data: any) => void) => void;
};

type TxPendingPayload = { pendingTxId: string; txHash: `0x${string}` };
type TxFailedPayload = { pendingTxId: string; error: string; stage?: string };

const inflight = new Map<
  string,
  { resolve: (hash: `0x${string}`) => void; reject: (e: Error) => void; timer: any }
>();

let listenersAttached = false;

const isHexHash = (v: any): v is `0x${string}` =>
  typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v);

export const ensureWaapTxListeners = (waap: Waap) => {
  if (listenersAttached) return;
  listenersAttached = true;

  waap.on("waap_tx_pending", (data: TxPendingPayload) => {
    if (!data?.pendingTxId || !isHexHash(data.txHash)) return;
    const entry = inflight.get(data.pendingTxId);
    if (!entry) return;

    clearTimeout(entry.timer);
    inflight.delete(data.pendingTxId);
    entry.resolve(data.txHash);
  });

  waap.on("waap_tx_failed", (data: TxFailedPayload) => {
    if (!data?.pendingTxId) return;
    const entry = inflight.get(data.pendingTxId);
    if (!entry) return;

    clearTimeout(entry.timer);
    inflight.delete(data.pendingTxId);
    entry.reject(new Error(`WaaP tx failed${data.stage ? ` (${data.stage})` : ""}: ${data.error}`));
  });
};

export const waitForTxHashFromPendingTxId = (
  waap: Waap,
  pendingTxId: string,
  timeoutMs = 90_000
): Promise<`0x${string}`> => {
  ensureWaapTxListeners(waap);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      inflight.delete(pendingTxId);
      reject(new Error(`Timed out waiting for txHash (pendingTxId=${pendingTxId})`));
    }, timeoutMs);

    inflight.set(pendingTxId, { resolve, reject, timer });
  });
};
