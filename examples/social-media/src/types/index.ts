export interface PushWalletSigner {
  account: string;
  signMessage: (dataToBeSigned: Uint8Array) => Promise<Uint8Array>;
}

export interface Profile {
  owner: string;
  address: string;
  encryptedProfilePrivateKey: CipherText;
  bio: string;
  handle: string;
  signature: `0x${string}`;
}

export type SignPayload = Omit<Profile, 'signature'>;

export interface CipherText {
  cipherText: string;
  salt: string;
  nonce: string;
  version: string;
}
