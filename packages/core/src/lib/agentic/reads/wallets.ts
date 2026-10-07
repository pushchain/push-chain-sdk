import { getAddress, type Address } from 'viem';
import type { AgenticGeneration } from '../deployments';
import type { ChainReader } from '../contracts/reader';
import { deriveWallet } from '../codec/ids';
import { AGENTIC_ERROR_CODE, AgenticError } from '../errors';
import type { WalletInfo, WalletSummary } from '../agentic.types';
import { Snapshot } from './snapshot';

/** Factory-predicted address for (owner, index), cross-checked against the pure mirror. */
async function predict(
  snap: Snapshot,
  gen: AgenticGeneration,
  owner: Address,
  index: bigint
): Promise<{ address: Address; deployed: boolean }> {
  const [address, deployed] = await snap.read<readonly [Address, boolean]>(
    gen.addresses.factory,
    gen.contracts.abis.factory,
    'predictWallet',
    [owner, index]
  );
  const mirror = deriveWallet({
    factory: gen.addresses.factory,
    walletImplementation: gen.addresses.walletImplementation,
    owner,
    index,
  });
  if (getAddress(address) !== mirror) {
    // Derivation drift between the SDK mirror and the factory (obligation 13).
    throw new AgenticError(
      AGENTIC_ERROR_CODE.INCONSISTENT_READ,
      `factory predicted ${address} for (${owner}, ${index}) but the SDK derives ${mirror}`,
      { details: { generation: gen.id } }
    );
  }
  return { address: getAddress(address), deployed };
}

export async function walletCount(
  snap: Snapshot,
  gen: AgenticGeneration,
  owner: Address
): Promise<bigint> {
  return BigInt(
    await snap.read<bigint>(
      gen.addresses.factory,
      gen.contracts.abis.factory,
      'walletCount',
      [owner]
    )
  );
}

/** client.agentic.derive: default index is the owner's next unused slot. */
export async function deriveForOwner(
  reader: ChainReader,
  gen: AgenticGeneration,
  owner: Address,
  index?: number
): Promise<{ address: Address; index: number; deployed: boolean }> {
  const snap = await Snapshot.at(reader);
  const next = await walletCount(snap, gen, owner);
  let target = next;
  if (index !== undefined) {
    if (!Number.isInteger(index) || index < 0) {
      throw new AgenticError(
        AGENTIC_ERROR_CODE.INVALID_RULE,
        'index must be a non-negative integer'
      );
    }
    target = BigInt(index);
    if (target > next) {
      throw new AgenticError(
        AGENTIC_ERROR_CODE.INVALID_RULE,
        `index ${index} is beyond the owner's next unused index ${next}; the factory only predicts up to the next slot`
      );
    }
  }
  const p = await predict(snap, gen, owner, target);
  return { address: p.address, index: Number(target), deployed: p.deployed };
}

export async function rulesCount(
  snap: Snapshot,
  gen: AgenticGeneration,
  wallet: Address
): Promise<number> {
  const ids = await snap.read<readonly `0x${string}`[]>(
    gen.addresses.sessionEngine,
    gen.contracts.abis.engine,
    'getPermissionIDs',
    [wallet]
  );
  return ids.length;
}

/**
 * client.agentic.list: every deployed slot plus the next undeployed slot
 * (deployed=false, rulesCount=0), as in the spec example.
 */
export async function listForOwner(
  reader: ChainReader,
  gen: AgenticGeneration,
  owner: Address
): Promise<WalletSummary[]> {
  const snap = await Snapshot.at(reader);
  const count = await walletCount(snap, gen, owner);
  const out: WalletSummary[] = [];
  for (let i = BigInt(0); i <= count; i++) {
    const p = await predict(snap, gen, owner, i);
    const deployed = i < count;
    if (deployed !== p.deployed) {
      throw new AgenticError(
        AGENTIC_ERROR_CODE.INCONSISTENT_READ,
        `factory reports slot ${i} deployed=${p.deployed} but walletCount is ${count}`
      );
    }
    const label = deployed
      ? await snap.read<string>(p.address, gen.contracts.abis.wallet, 'label')
      : '';
    out.push({
      address: p.address,
      index: Number(i),
      label,
      deployed,
      rulesCount: deployed ? await rulesCount(snap, gen, p.address) : 0,
    });
  }
  return out;
}

/** w.owner(): the owner as the wallet stores it. */
export async function walletOwner(
  reader: ChainReader,
  gen: AgenticGeneration,
  wallet: Address
): Promise<Address> {
  const snap = await Snapshot.at(reader);
  return getAddress(
    await snap.read<Address>(wallet, gen.contracts.abis.wallet, 'owner')
  );
}

/**
 * w.info(). A deployed wallet is read from chain. An undeployed address is
 * only describable when it is `signerIdentity`'s next predicted slot.
 */
export async function walletInfo(
  reader: ChainReader,
  gen: AgenticGeneration,
  wallet: Address,
  signerIdentity?: Address
): Promise<WalletInfo> {
  const snap = await Snapshot.at(reader);
  const deployed = await snap.code(wallet);
  if (!deployed) {
    if (signerIdentity) {
      const next = await walletCount(snap, gen, signerIdentity);
      const p = await predict(snap, gen, signerIdentity, next);
      if (p.address === getAddress(wallet)) {
        return {
          address: p.address,
          label: '',
          index: Number(next),
          owner: getAddress(signerIdentity),
          deployed: false,
          rulesCount: 0,
        };
      }
    }
    throw new AgenticError(
      AGENTIC_ERROR_CODE.WALLET_NOT_DEPLOYED,
      `${wallet} is not deployed and is not the connected owner's next wallet slot`
    );
  }
  const [owner, index] = await Promise.all([
    snap.read<Address>(wallet, gen.contracts.abis.wallet, 'owner'),
    snap.read<bigint>(
      gen.addresses.factory,
      gen.contracts.abis.factory,
      'indexOf',
      [wallet]
    ),
  ]);
  const label = await snap.read<string>(
    wallet,
    gen.contracts.abis.wallet,
    'label'
  );
  return {
    address: getAddress(wallet),
    label,
    index: Number(index),
    owner: getAddress(owner),
    deployed: true,
    rulesCount: await rulesCount(snap, gen, wallet),
  };
}
