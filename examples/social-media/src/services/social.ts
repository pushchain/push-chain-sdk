import PushNetwork from '@pushprotocol/node-core';
import {ENV} from '@pushprotocol/node-core/src/lib/constants';
import {PushWalletSigner} from "../types";

/**
 * Contains all utilities to interact with the Push Chain for this application
 */
export class Social {
    TX_CATEGORY_PREFIX = 'SOCIAL:';
    CREATE_PROFILE = `${this.TX_CATEGORY_PREFIX}CREATE_PROFILE`;

    private constructor(private pushNetwork: PushNetwork) {
    }

    /**
     * @param env - The environment to use. Defaults to `ENV.DEV`.
     */
    static async initialize(env: ENV = ENV.DEV) {
        const pushNetwork = await PushNetwork.initialize(env);
        return new Social(pushNetwork);
    };

    async createProfile(
        handle: string,
        encryptedProfilePrivateKey: string,
        pfp: string,
        bio: string,
        signature: string,
        signer: PushWalletSigner
    ): Promise<string> {
        if (handle || !encryptedProfilePrivateKey || !pfp || !bio || !signer || !signature) {
            throw new Error('Invalid function input for createProfile function');
        }

        const data = {address: signer.account, encryptedProfilePrivateKey, pfp, bio}
        const serializedData = new TextEncoder().encode(JSON.stringify(data))
        const unsignedTx = this.pushNetwork.tx.createUnsigned(
            this.CREATE_PROFILE,
            [signer.account],
            serializedData
        );
        return await this.pushNetwork.tx.send(unsignedTx, signer);
    };
}