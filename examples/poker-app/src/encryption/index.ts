import { curve, ec as EC } from 'elliptic';
import BN from 'bn.js';
import BasePoint = curve.base.BasePoint;

// Initialize the elliptic curve
const ec = new EC('secp256k1');

/**
 * Generate key pair for a user
 */
export function generateKeyPair(): { privateKey: BN; publicKey: BasePoint } {
  const keyPair = ec.genKeyPair();
  return {
    privateKey: keyPair.getPrivate(), // Private key as BN
    publicKey: keyPair.getPublic(), // Public key as EC point
  };
}

/**
 * Commutative encryption function
 * @param message
 * @param publicKey for the next player in players array
 * @param privateKey connected user private key
 */
export function commutativeEncrypt(
  message: BN,
  publicKey: BasePoint,
  privateKey: BN
): BN {
  // Calculate shared key as (publicKey * privateKey)
  const sharedKey = publicKey.mul(privateKey);
  // Encrypt by multiplying the message with sharedKey.x
  return message.mul(sharedKey.getX()).mod(ec.curve.n);
}

/**
 * Commutative decryption function
 * @param encryptedMessage
 * @param publicKey for the next player in players array
 * @param privateKey
 */
export function commutativeDecrypt(
  encryptedMessage: BN,
  publicKey: BasePoint,
  privateKey: BN
): BN {
  // Calculate shared key as (publicKey * privateKey)
  const sharedKey = publicKey.mul(privateKey);
  // Decrypt by dividing the message by sharedKey.x
  return encryptedMessage
    .mul(sharedKey.getX().invm(ec.curve.n))
    .mod(ec.curve.n);
}

export function publicKeyToString(publicKey: BasePoint): string {
  return publicKey.encode('hex', true);
}

export function stringToPublicKey(publicKeyString: string): BasePoint {
  return ec.curve.decodePoint(publicKeyString,'hex');
}
