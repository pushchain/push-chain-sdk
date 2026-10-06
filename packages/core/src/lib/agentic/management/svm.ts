/** Internal explicit-wire operations. Not exported by the SDK entry point. */
import { getAddress, type Address, type Hex } from 'viem';
import type { AgenticRuntime } from '../runtime';
import {
  resolveWalletGeneration,
  verifyPolicyVersion,
  type AgenticGeneration,
} from '../deployments';
import { Snapshot } from '../reads/snapshot';
import { readSvmRule } from '../reads/svm';
import {
  assertCanSign,
  assertOwner,
  confirmedLogs,
  wrapSendError,
} from './common';
import { encodeSvmTerms, type SvmTermsWire } from '../codec/svm-terms';
import { buildSession, encodeEnvelope } from '../codec/session';
import { rulesId as predictRulesId } from '../codec/ids';
import { SEND_OUTBOUND_SELECTOR } from '../contracts/v4';
import { deriveAgwSvmCea } from '../codec/svm-accounts';
import { AGENTIC_ERROR_CODE, AgenticError } from '../errors';
import { PRC20_SOURCE_ABI } from '../contracts/prc20-metadata';

async function verifyAssets(snap: Snapshot, input: SvmWireGrant) {
  if (!/^solana:[1-9A-HJ-NP-Za-km-z]{32}$/.test(input.chainNamespace))
    throw new AgenticError(
      AGENTIC_ERROR_CODE.INVALID_RULE,
      'SVM chain must be a full Solana CAIP-2 namespace'
    );
  for (const cap of input.terms.assets) {
    if (
      (await snap.read<string>(
        cap.token,
        PRC20_SOURCE_ABI,
        'SOURCE_CHAIN_NAMESPACE'
      )) !== input.chainNamespace
    )
      throw new AgenticError(
        AGENTIC_ERROR_CODE.ASSET_CHAIN_MISMATCH,
        'SVM asset source-chain mismatch'
      );
  }
}

export interface SvmWireGrant {
  agent: Address;
  chainNamespace: `solana:${string}`;
  terms: SvmTermsWire;
}

export async function verifySvmWallet(
  runtime: AgenticRuntime,
  gen: AgenticGeneration,
  wallet: Address
) {
  const actual = await resolveWalletGeneration(
    runtime.reader,
    runtime.network,
    wallet
  );
  if (actual.addresses.factory !== gen.addresses.factory)
    throw new AgenticError(
      AGENTIC_ERROR_CODE.GENERATION_UNSUPPORTED,
      'SVM wallet generation mismatch'
    );
  await verifyPolicyVersion(runtime.reader, gen);
}

function session(
  gen: AgenticGeneration,
  wallet: Address,
  owner: Address,
  input: SvmWireGrant,
  now: number
) {
  const agent = getAddress(input.agent);
  if (agent === owner)
    throw new AgenticError(
      AGENTIC_ERROR_CODE.AGENT_IS_OWNER,
      'agent must differ from owner'
    );
  const cea = deriveAgwSvmCea(wallet, input.terms.gatewayProgram).address;
  if (cea.toLowerCase() !== input.terms.expectedCEA.toLowerCase())
    throw new AgenticError(
      AGENTIC_ERROR_CODE.INVALID_RULE,
      'SVM expectedCEA does not belong to this wallet/gateway'
    );
  return buildSession({
    validator: gen.addresses.sessionValidator,
    rulesPolicy: gen.addresses.rulesPolicy,
    agent,
    actions: [
      {
        target: gen.addresses.gateway,
        selector: SEND_OUTBOUND_SELECTOR,
        initData: encodeEnvelope(
          input.chainNamespace,
          encodeSvmTerms(input.terms, now)
        ),
      },
    ],
  });
}

export async function grantSvmWire(
  runtime: AgenticRuntime,
  gen: AgenticGeneration,
  wallet: Address,
  input: SvmWireGrant
) {
  assertCanSign(runtime, 'internal SVM grant');
  await verifySvmWallet(runtime, gen, wallet);
  const snap = await Snapshot.at(runtime.reader);
  const owner = await assertOwner(runtime, gen, wallet, snap);
  await verifyAssets(snap, input);
  const s = session(gen, wallet, owner, input, runtime.nowSeconds());
  const nonce = await snap.read<bigint>(
    wallet,
    gen.contracts.abis.wallet,
    'grantNonce'
  );
  const expected = predictRulesId({
    validator: gen.addresses.sessionValidator,
    agent: getAddress(input.agent),
    grantNonce: nonce,
  });
  let tx;
  try {
    tx = await runtime.execute({
      to: wallet,
      value: BigInt(0),
      data: gen.contracts.encodeGrantRules(s),
    });
  } catch (error) {
    throw wrapSendError(error);
  }
  const { logs } = await confirmedLogs(runtime, tx);
  const granted = gen.contracts.parseRulesGranted(logs, wallet);
  if (
    granted.length !== 1 ||
    granted[0].mode !== 0 ||
    granted[0].chainNamespace !== input.chainNamespace
  )
    throw new AgenticError(
      AGENTIC_ERROR_CODE.RECEIPT_MISMATCH,
      'SVM grant receipt did not match this operation',
      { details: { txHash: tx.hash, expected } }
    );
  // Another owner grant can advance grantNonce between read and inclusion.
  // The sole matching event from this receipt is the authoritative ID.
  return { rulesId: granted[0].rulesId, tx };
}

/** Snapshot -> all-asset assertion -> revoke -> grant. No sequential fallback. */
export async function prepareSvmReplacement(
  runtime: AgenticRuntime,
  gen: AgenticGeneration,
  wallet: Address,
  oldId: Hex,
  input: SvmWireGrant
) {
  assertCanSign(runtime, 'internal SVM replacement');
  await verifySvmWallet(runtime, gen, wallet);
  const snap = await Snapshot.at(runtime.reader);
  const owner = await assertOwner(runtime, gen, wallet, snap);
  await verifyAssets(snap, input);
  const old = await readSvmRule(
    snap,
    gen,
    wallet,
    oldId,
    runtime.pushChainNamespace
  );
  const s = session(gen, wallet, owner, input, runtime.nowSeconds());
  const nonce = await snap.read<bigint>(
    wallet,
    gen.contracts.abis.wallet,
    'grantNonce'
  );
  const rulesId = predictRulesId({
    validator: gen.addresses.sessionValidator,
    agent: getAddress(input.agent),
    grantNonce: nonce,
  });
  const calls = [
    {
      target: gen.addresses.rulesPolicy,
      value: BigInt(0),
      data: gen.contracts.encodeAssertSpentUniversal(
        old.configId,
        wallet,
        old.config.assets.map((a) => a.spent)
      ),
    },
    {
      target: wallet,
      value: BigInt(0),
      data: gen.contracts.encodeRevokeRules(oldId),
    },
    {
      target: wallet,
      value: BigInt(0),
      data: gen.contracts.encodeGrantRules(s),
    },
  ];
  return {
    rulesId,
    oldId,
    snapshotBlock: snap.blockNumber,
    data: gen.contracts.encodeExecute(calls),
  };
}

export async function replaceSvmWire(
  runtime: AgenticRuntime,
  gen: AgenticGeneration,
  wallet: Address,
  oldId: Hex,
  input: SvmWireGrant
) {
  const prepared = await prepareSvmReplacement(
    runtime,
    gen,
    wallet,
    oldId,
    input
  );
  let tx;
  try {
    tx = await runtime.execute({
      to: wallet,
      value: BigInt(0),
      data: prepared.data,
    });
  } catch (error) {
    throw wrapSendError(error);
  }
  const { logs } = await confirmedLogs(runtime, tx);
  const grants = gen.contracts.parseRulesGranted(logs, wallet);
  const revokes = gen.contracts.parseRulesRevoked(logs, wallet);
  if (
    grants.length !== 1 ||
    grants[0].mode !== 0 ||
    grants[0].chainNamespace !== input.chainNamespace ||
    !revokes.some((r) => r.rulesId.toLowerCase() === oldId.toLowerCase())
  )
    throw new AgenticError(
      AGENTIC_ERROR_CODE.RECEIPT_MISMATCH,
      'SVM replacement receipt mismatch',
      { details: { txHash: tx.hash } }
    );
  return { rulesId: grants[0].rulesId, replaced: oldId, tx };
}
