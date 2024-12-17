export type UniversalAccount = {
  chain: string;
  chainId: string;
  /**
   * Not in CAIP-10 format
   */
  account: string;
};

export type UniversalSigner = UniversalAccount & {
  signMessage: (data: Uint8Array) => Promise<Uint8Array>;
};

export type ValidatedUniversalSigner = UniversalAccount & {
  signMessage: (data: Uint8Array) => Promise<Uint8Array>;
};
