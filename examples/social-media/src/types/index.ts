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

export type SignPayloadProfile = Omit<Profile, 'signature'>;

export interface CipherText {
  cipherText: string;
  salt: string;
  nonce: string;
  preKey: string;
  version: string;
}

export interface Post {
  from: string;
  message: string;
  timestamp: number;
  messageType: string;
  /**
   * Signature from profile address
   */
  signature: string;
}

export type SignPayloadPost = Omit<Post, 'signature'>

export interface Friend {
  from: string;
  to: string;
  signature: string;
}

export type LoggedInProfile = Profile & { decryptedProfilePrivateKey: `0x${string}` };