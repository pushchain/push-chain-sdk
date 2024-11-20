export interface PushWalletSigner {
  account: string;
  signMessage: (dataToBeSigned: Uint8Array) => Promise<Uint8Array>;
}

export interface Profile {
  address: string;
  encryptedProfilePrivateKey: CipherText;
  bio: string;
  handle: string;
  signature: `0x${string}`;
}

export interface CipherText {
  cipherText: string;
  salt: string;
  nonce: string;
  version: string;
}
