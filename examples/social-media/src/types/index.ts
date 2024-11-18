export interface PushWalletSigner {
    account: string;
    signMessage: (dataToBeSigned: Uint8Array) => Promise<Uint8Array>;
}
