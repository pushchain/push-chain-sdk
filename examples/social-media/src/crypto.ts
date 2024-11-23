import { keccak256, toBytes, toHex } from 'viem';
import { CipherText, PushWalletSigner, SignPayloadPost, SignPayloadProfile } from './types';

export class Crypto {
  public constructor(private signer: PushWalletSigner) {
  }

  public async encrypt(plainText: string): Promise<CipherText> {
    const randomHexString = toHex(crypto.getRandomValues(new Uint8Array(32)));
    const messageToSign = 'Enable your profile \n' + randomHexString;
    const secret = await this.signer.signMessage(new TextEncoder().encode(messageToSign));
    return {
      ...await this.aesGcmEncryption(new TextEncoder().encode(plainText), secret),
      version: 'v0',
      preKey: randomHexString
    };
  }

  public async decrypt(encryptedMessage: CipherText): Promise<`0x${string}`> {
    const messageToSign = 'Enable your profile \n' + encryptedMessage.preKey;
    const secret = await this.signer.signMessage(toBytes(messageToSign));
    const encodedPrivateKey = await this.aesGcmDecryption(encryptedMessage, secret);
    return new TextDecoder().decode(encodedPrivateKey) as `0x${string}`;
  }

  private async aesGcmEncryption(plainText: Uint8Array, secret: Uint8Array): Promise<{
    cipherText: string;
    salt: string;
    nonce: string;
  }> {
    const KDFSaltSize = 32; // bytes
    const AESGCMNonceSize = 12; // property iv
    const salt = crypto.getRandomValues(new Uint8Array(KDFSaltSize));
    const nonce = crypto.getRandomValues(new Uint8Array(AESGCMNonceSize));
    const key = await this.hkdf(secret, salt);

    const aesGcmParams: AesGcmParams = {
      name: 'AES-GCM',
      iv: nonce
    };
    const encrypted: ArrayBuffer = await crypto.subtle.encrypt(
      aesGcmParams,
      key,
      plainText
    );
    return {
      cipherText: toHex(new Uint8Array(encrypted)),
      salt: toHex(salt),
      nonce: toHex(nonce)
    };
  }

  private aesGcmDecryption = async (
    encryptedData: CipherText,
    secret: Uint8Array,
    additionalData?: Uint8Array
  ): Promise<Uint8Array> => {
    const key = await this.hkdf(
      secret,
      toBytes(encryptedData.salt)
    );
    const aesGcmParams: AesGcmParams = {
      name: 'AES-GCM',
      iv: toBytes(encryptedData.nonce)
    };
    if (additionalData) {
      aesGcmParams.additionalData = additionalData;
    }
    try {

      const decrypted: ArrayBuffer = await crypto.subtle.decrypt(
        aesGcmParams,
        key,
        toBytes(encryptedData.cipherText)
      );
      return new Uint8Array(decrypted);
    } catch (error) {
      console.error(error);
      return new Uint8Array();
    }
  };

  /**
   * Derive AES-256-GCM key from a shared secret and salt
   */
  private async hkdf(
    secret: Uint8Array,
    salt: Uint8Array
  ): Promise<CryptoKey> {
    const key = await crypto.subtle.importKey('raw', secret, 'HKDF', false, [
      'deriveKey'
    ]);
    return crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt, info: new ArrayBuffer(0) },
      key,
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
  };

  public static getSignPayloadProfile(profile: SignPayloadProfile): Uint8Array {
    const payload: SignPayloadProfile = {
      owner: profile.owner,
      address: profile.address,
      encryptedProfilePrivateKey: profile.encryptedProfilePrivateKey,
      bio: profile.bio,
      handle: profile.handle
    };
    const hexPayload = toHex(new TextEncoder().encode(JSON.stringify(payload)));
    return keccak256(hexPayload, 'bytes');
  }

  public static getSignPayloadPost(post: SignPayloadPost): Uint8Array {
    const payload: SignPayloadPost = {
      from: post.from,
      message: post.message,
      messageType: post.messageType,
      timestamp: post.timestamp
    };
    const bytesPayload = new TextEncoder().encode(JSON.stringify(payload));
    return keccak256(bytesPayload, 'bytes');
  }
}
