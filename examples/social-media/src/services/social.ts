import { ENV } from '@pushprotocol/node-core/src/lib/constants';
import { PushNetwork } from '@pushprotocol/node-core';
import { Transaction } from '@pushprotocol/node-core/src/lib/generated/tx';
import { Profile, PushWalletSigner } from '../types';

/**
 * Contains all utilities to interact with the Push Chain for this application
 */
export class Social {
  private TX_CATEGORY_PREFIX = 'SOCIAL:';
  private CREATE_PROFILE = `${this.TX_CATEGORY_PREFIX}CREATE_PROFILE`;

  private constructor(private pushNetwork: PushNetwork) {
  }

  /**
   * @param env - The environment to use. Defaults to `ENV.DEV`.
   */
  static async initialize(env: ENV = ENV.DEV) {
    const pushNetwork = await PushNetwork.initialize(env);
    return new Social(pushNetwork);
  }

  async getProfile(address: string): Promise<Profile | undefined> {
    const response = await this.pushNetwork.tx.get(
      Math.floor(Date.now()),
      'DESC',
      5,
      1,
      address,
      this.CREATE_PROFILE
    );

    if (response.blocks.length === 0) return undefined;
    const block = response.blocks[0];
    const transaction = block.blockDataAsJson.txobjList as { tx: Transaction };
    const decodedData = new TextDecoder().decode(
      new Uint8Array(
        Buffer.from(transaction.tx.data as unknown as string, 'base64')
      )
    );

    if (!decodedData) return undefined;

    try {
      return JSON.parse(decodedData) as Profile;
    } catch (error) {
      console.error('Invalid JSON: ', error);
      return undefined;
    }
  }

  async createProfile({ address, bio, encryptedProfilePrivateKey, signature, handle, signer }: Profile & {
                        signer: PushWalletSigner
                      }
  ): Promise<string> {
    if (
      !handle ||
      !encryptedProfilePrivateKey ||
      !bio ||
      !signer ||
      !signature ||
      !address
    ) {
      throw new Error('Invalid function input for createProfile function');
    }

    const data: Profile = {
      address,
      encryptedProfilePrivateKey,
      bio,
      signature,
      handle
    };
    const serializedData = new TextEncoder().encode(JSON.stringify(data));
    const unsignedTx = this.pushNetwork.tx.createUnsigned(
      this.CREATE_PROFILE,
      [signer.account],
      serializedData
    );
    const txHash = await this.pushNetwork.tx.send(unsignedTx, signer);
    return txHash;
  }
}
