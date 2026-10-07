import { getAddress, type Address } from 'viem';
import { AgenticCapability, requireCapability } from './capabilities';
import { resolveWalletGeneration, type AgenticGeneration } from './deployments';
import { AGENTIC_ERROR_CODE, AgenticError } from './errors';
import {
  addRules,
  assertRevokeTarget,
  revokeRules,
  setLabel,
  updateRules,
} from './management/rules-write';
import { readCheckpoints } from './reads/checkpoints';
import { getRule, listRules } from './reads/rules';
import { Snapshot } from './reads/snapshot';
import { walletInfo, walletOwner } from './reads/wallets';
import type { AgenticRuntime } from './runtime';
import type {
  AgenticAddress,
  AgenticHex,
  AgenticProgressHook,
  AgenticWallet,
  Checkpoint,
  RulesRecord,
  WalletInfo,
} from './agentic.types';
import type { UniversalTxResponse } from '../orchestrator/orchestrator.types';
import { currentGeneration } from './deployments';
import { assertLabel } from './management/label';

/**
 * Management handle for one wallet (spec 1.d). Reads work for any wallet;
 * writes require the connected signer to be the owner. It never sends AS the
 * wallet — that is PushChain.initialize(signer, { agenticWallet }).
 */
export class AgenticWalletHandle implements AgenticWallet {
  readonly address: AgenticAddress;
  readonly rules: AgenticWallet['rules'];
  private generation?: Promise<AgenticGeneration>;

  constructor(private readonly runtime: AgenticRuntime, address: string) {
    try {
      this.address = getAddress(address) as AgenticAddress;
    } catch (cause) {
      throw new AgenticError(
        AGENTIC_ERROR_CODE.NOT_AGENTIC_WALLET,
        `"${address}" is not an address`,
        { cause }
      );
    }
    this.rules = {
      list: () => this.listRules(),
      get: (rulesId) => this.getRule(rulesId),
      add: async (rules, opts) =>
        addRules(
          this.runtime,
          await this.gen(),
          this.address,
          rules,
          opts?.progressHook
        ),
      update: async (params) =>
        updateRules(this.runtime, await this.gen(), this.address, params),
      revoke: (async (
        target:
          | AgenticHex[]
          | { all: true; progressHook?: AgenticProgressHook },
        opts?: { progressHook?: AgenticProgressHook }
      ) => {
        // Validate the target shape before any RPC so a bare revoke costs nothing.
        assertRevokeTarget(target);
        return revokeRules(
          this.runtime,
          await this.gen(),
          this.address,
          target,
          opts?.progressHook
        );
      }) as AgenticWallet['rules']['revoke'],
    };
  }

  /** Deployed wallets resolve their own generation; undeployed ones use the network's current one. */
  private gen(): Promise<AgenticGeneration> {
    if (!this.generation) {
      this.generation = resolveWalletGeneration(
        this.runtime.reader,
        this.runtime.network,
        this.address
      );
      this.generation.catch(() => {
        this.generation = undefined;
      });
    }
    return this.generation;
  }

  async info(): Promise<WalletInfo> {
    let gen: AgenticGeneration;
    try {
      gen = await this.gen();
    } catch (err) {
      if (
        err instanceof AgenticError &&
        err.code === AGENTIC_ERROR_CODE.WALLET_NOT_DEPLOYED
      ) {
        gen = currentGeneration(this.runtime.network);
      } else {
        throw err;
      }
    }
    requireCapability(gen.capabilities, AgenticCapability.WALLET_READS);
    return walletInfo(
      this.runtime.reader,
      gen,
      this.address,
      this.signerIdentity()
    );
  }

  async owner(): Promise<{ owner: AgenticAddress }> {
    const gen = await this.gen();
    return {
      owner: (await walletOwner(
        this.runtime.reader,
        gen,
        this.address
      )) as AgenticAddress,
    };
  }

  async setLabel(
    label: string,
    opts?: { progressHook?: AgenticProgressHook }
  ): Promise<UniversalTxResponse> {
    assertLabel(label);
    return setLabel(
      this.runtime,
      await this.gen(),
      this.address,
      label,
      opts?.progressHook
    );
  }

  async checkpoints(opts?: {
    sinceBlock?: bigint;
  }): Promise<{ checkpoints: Checkpoint[] }> {
    const gen = await this.gen();
    const { checkpoints } = await readCheckpoints(
      this.runtime.reader,
      gen,
      this.address,
      opts?.sinceBlock
    );
    return { checkpoints };
  }

  private async listRules(): Promise<{ rules: RulesRecord[] }> {
    const gen = await this.gen();
    const snap = await Snapshot.at(this.runtime.reader);
    return {
      rules: await listRules(
        snap,
        gen,
        this.address,
        this.runtime.pushChainNamespace
      ),
    };
  }

  private async getRule(rulesId: AgenticHex): Promise<RulesRecord> {
    if (typeof rulesId !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(rulesId)) {
      throw new AgenticError(
        AGENTIC_ERROR_CODE.INVALID_RULE,
        'rulesId must be a 32-byte hex string'
      );
    }
    const gen = await this.gen();
    const snap = await Snapshot.at(this.runtime.reader);
    return getRule(
      snap,
      gen,
      this.address,
      rulesId,
      this.runtime.pushChainNamespace
    );
  }

  private signerIdentity(): Address | undefined {
    try {
      return this.runtime.signerPushAccount();
    } catch {
      return undefined;
    }
  }
}
