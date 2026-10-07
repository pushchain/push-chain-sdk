import {
  concat,
  encodeAbiParameters,
  encodePacked,
  getAddress,
  getContractAddress,
  keccak256,
  numberToHex,
  type Address,
  type Hex,
} from 'viem';
import { AGENTIC_ERROR_CODE, AgenticError } from '../errors';

/**
 * Pure identity helpers mirroring the pinned AGW generation (v5):
 *   smartsessions IdLib.toActionId / toConfigId / toPermissionId and
 *   AGWFactory._predict (OZ Clones immutable-args CREATE2).
 * Every input that changes the result is explicit — validator, factory and
 * implementation are internal generation context.
 */

/** keccak256(abi.encodePacked(address target, bytes4 selector)). */
export function actionId(target: Address, selector: Hex): Hex {
  return keccak256(encodePacked(['address', 'bytes4'], [target, selector]));
}

/** keccak256(abi.encodePacked(wallet, keccak256(abi.encodePacked(rulesId, actionId)))). */
export function configId(wallet: Address, rulesId: Hex, action: Hex): Hex {
  const inner = keccak256(
    encodePacked(['bytes32', 'bytes32'], [rulesId, action])
  );
  return keccak256(encodePacked(['address', 'bytes32'], [wallet, inner]));
}

/** sessionValidatorInitData for the agent validator: abi.encode(address agent). */
export function agentConfig(agent: Address): Hex {
  return encodeAbiParameters([{ type: 'address' }], [agent]);
}

/**
 * The rules ID a grant produces:
 *   keccak256(abi.encode(validator, bytes abi.encode(agent), bytes32(grantNonce))).
 * Chain is NOT part of the hash; records are keyed by wallet + rulesId.
 */
export function rulesId(ctx: {
  validator: Address;
  agent: Address;
  grantNonce: bigint;
}): Hex {
  if (ctx.grantNonce < BigInt(0) || ctx.grantNonce >= BigInt(2) ** BigInt(64)) {
    throw new AgenticError(
      AGENTIC_ERROR_CODE.INVALID_RULE,
      'grantNonce must fit uint64'
    );
  }
  return keccak256(
    encodeAbiParameters(
      [{ type: 'address' }, { type: 'bytes' }, { type: 'bytes32' }],
      [
        ctx.validator,
        agentConfig(ctx.agent),
        numberToHex(ctx.grantNonce, { size: 32 }),
      ]
    )
  );
}

const UINT96_MAX = BigInt(2) ** BigInt(96) - BigInt(1);

/**
 * Counterfactual wallet address: CREATE2 by the factory proxy of an OZ clone
 * of `walletImplementation` with immutable args (owner ‖ factory), salt
 * keccak256(abi.encode(owner, uint96 index)).
 */
export function deriveWallet(ctx: {
  factory: Address;
  walletImplementation: Address;
  owner: Address;
  index: bigint | number;
}): Address {
  const index = BigInt(ctx.index);
  if (index < BigInt(0) || index > UINT96_MAX) {
    throw new AgenticError(
      AGENTIC_ERROR_CODE.INVALID_RULE,
      'wallet index must fit uint96'
    );
  }
  const salt = keccak256(
    encodeAbiParameters(
      [{ type: 'address' }, { type: 'uint96' }],
      [ctx.owner, index]
    )
  );
  const args = encodePacked(['address', 'address'], [ctx.owner, ctx.factory]);
  const argsLength = (args.length - 2) / 2;
  const initCode = concat([
    '0x61',
    numberToHex(argsLength + 0x2d, { size: 2 }),
    '0x3d81600a3d39f3363d3d373d3d3d363d73',
    ctx.walletImplementation,
    '0x5af43d82803e903d91602b57fd5bf3',
    args,
  ]);
  return getAddress(
    getContractAddress({
      opcode: 'CREATE2',
      from: ctx.factory,
      salt,
      bytecodeHash: keccak256(initCode),
    })
  );
}
