import { UniversalSigner, ValidatedUniversalSigner } from './signer.types';

export class Signer {
  static create(universalSigner: UniversalSigner): ValidatedUniversalSigner {
    // check if possible to get function arguments types -> check this
    // check in compile time the function arguments
    // get its type
    // convert to Uint8Array if necessary

    // return {
    //   ...universalSigner,
    //   signMessage: async (data: Uint8Array) => {
    //     // Call the original signMessage function with a Uint8Array
    //     const result = await universalSigner.signMessage(data);
    //
    //     // If the result is a string (likely hex), convert it to Uint8Array
    //     if (typeof result === 'string') {
    //       // Ensure the result is prefixed with '0x'
    //       const hexResult = result.startsWith('0x') ? result : `0x${result}`;
    //       return hexToBytes(hexResult as `0x${string}`);
    //     }
    //
    //     // If it's already a Uint8Array, just return it
    //     return result;
    //   },
    // };
    return universalSigner;
  }
}
