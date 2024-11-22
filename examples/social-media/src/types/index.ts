export interface PushWalletSigner {
  account: string;
  signMessage: (dataToBeSigned: Uint8Array) => Promise<Uint8Array>;
  verifySignature: (expectedAddress: string, hashedPayload: Uint8Array, signature: Uint8Array) => Promise<boolean>;
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

export interface Post {
  from: string;
  message: string;
  timestamp: number;
  messageType: string;
  signature: string;
}

export interface Friend {
  from: string;
  to: string;
  signature: string;
}