import { Connection, PublicKey } from '@solana/web3.js';
import { svmKey } from '../codec/svm-accounts';
import { svmInvalid } from '../codec/svm-terms';
import type { SvmMetadataProvider } from './svm-context';
import { AgenticError, AGENTIC_ERROR_CODE } from '../errors';

export interface SvmClusterConfig {
  gatewayProgram: string;
  rpcUrls: readonly string[];
}
type MintRpc = Pick<Connection, 'getGenesisHash' | 'getAccountInfo'>;
const SPL = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

/** Explicit cluster configuration; HTTP reads only, no signing/subscriptions. */
export function createSvmMetadataProvider(
  clusters: Readonly<Partial<Record<`solana:${string}`, SvmClusterConfig>>>,
  connect: (url: string) => MintRpc = (url) => new Connection(url, 'confirmed')
): SvmMetadataProvider {
  function config(chain: `solana:${string}`) {
    const c = clusters[chain];
    if (!c || !c.rpcUrls.length)
      throw svmInvalid(`no SVM registry/RPC configuration for ${chain}`);
    svmKey(c.gatewayProgram);
    return c;
  }
  async function read<T>(
    chain: `solana:${string}`,
    fn: (rpc: MintRpc) => Promise<T>
  ): Promise<T> {
    const c = config(chain);
    let last: unknown;
    for (const url of c.rpcUrls) {
      try {
        const rpc = connect(url);
        // CAIP-2 Solana references are the first 32 characters of genesisHash.
        if (`solana:${(await rpc.getGenesisHash()).slice(0, 32)}` !== chain)
          throw svmInvalid('SVM RPC genesis/cluster mismatch');
        return await fn(rpc);
      } catch (error) {
        last = error;
      }
    }
    throw new AgenticError(
      AGENTIC_ERROR_CODE.INVALID_RULE,
      `SVM metadata lookup failed for ${chain}`,
      { cause: last }
    );
  }
  return {
    gateway: async (chain) =>
      read(chain, async () => ({
        chainNamespace: chain,
        program: config(chain).gatewayProgram,
      })),
    mint: async (chain, address) =>
      read(chain, async (rpc) => {
        const mint = new PublicKey(
          Buffer.from(svmKey(address).slice(2), 'hex')
        );
        const info = await rpc.getAccountInfo(mint, 'confirmed');
        if (!info || info.executable)
          throw svmInvalid('mint account missing or executable');
        const owner = info.owner.toBase58(),
          data = info.data;
        const legacy = owner === SPL && data.length === 82;
        const extended =
          owner === TOKEN_2022 &&
          (data.length === 82 || (data.length >= 166 && data[165] === 1));
        if ((!legacy && !extended) || data[45] !== 1)
          throw svmInvalid('account is not an initialized supported SPL mint');
        return { mint: mint.toBase58(), tokenProgram: owner };
      }),
  };
}
