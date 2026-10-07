import { AgenticCapability, requireCapability } from './capabilities';
import { currentGeneration } from './deployments';
import { createWallet } from './management/create';
import { emitAgentic } from './management/common';
import { deriveForOwner, listForOwner } from './reads/wallets';
import { AgenticWalletHandle } from './wallet';
import { PROGRESS_HOOK } from '../progress-hook/progress-hook.types';
import type { AgenticRuntime } from './runtime';
import type {
  AgenticAddress,
  AgenticNamespace,
  AgenticWallet,
  CreateOptions,
  CreateResult,
  WalletSummary,
} from './agentic.types';

/**
 * client.agentic — owner-side AGW management (spec section 1). Ownership is
 * always the connected signer's Push identity (EOA, or the UEA for its origin
 * chain), never the AGW an agentic client exposes as universal.account.
 */
export class AgenticNamespaceImpl implements AgenticNamespace {
  constructor(private readonly runtime: AgenticRuntime) {}

  async derive(opts?: { index?: number }): Promise<{ address: AgenticAddress; index: number; deployed: boolean }> {
    const gen = currentGeneration(this.runtime.network);
    requireCapability(gen.capabilities, AgenticCapability.WALLET_READS);
    const owner = this.runtime.signerPushAccount();
    const r = await deriveForOwner(this.runtime.reader, gen, owner, opts?.index);
    emitAgentic(this.runtime, undefined, PROGRESS_HOOK.AGENTIC_TX_101, r.address, r.index, r.deployed);
    return { address: r.address as AgenticAddress, index: r.index, deployed: r.deployed };
  }

  create(label: string, options: CreateOptions): Promise<CreateResult> {
    return createWallet(this.runtime, label, options);
  }

  async list(): Promise<{ wallets: WalletSummary[] }> {
    const gen = currentGeneration(this.runtime.network);
    requireCapability(gen.capabilities, AgenticCapability.WALLET_READS);
    const wallets = await listForOwner(this.runtime.reader, gen, this.runtime.signerPushAccount());
    return { wallets };
  }

  wallet(address: AgenticAddress): AgenticWallet {
    return new AgenticWalletHandle(this.runtime, address);
  }
}
