export interface PushWalletSigner {
  account: string;
  signMessage: (dataToBeSigned: Uint8Array) => Promise<Uint8Array>;
}

export interface Profile {
  address: string;
  encryptedProfilePrivateKey: string;
  pfp: string;
  bio: string;
  signature: string;
}
