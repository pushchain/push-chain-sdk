/**
 * Event ABI fragments used by the universal-tx detector.
 *
 * Sourced from push-chain-gateway-contracts and push-chain-core-contracts:
 *   - UniversalTx, UniversalTxExecuted, RevertUniversalTx, FundsRescued
 *       → contracts/evm-gateway/src/interfaces/IUniversalGateway.sol
 *   - UniversalTxFinalized, UniversalTxReverted, FundsRescued (vault)
 *       → contracts/evm-gateway/src/interfaces/IVault.sol
 *   - UniversalTxOutbound
 *       → contracts/evm-gateway/src/interfaces/IUniversalGatewayPC.sol
 *
 * RevertInstructions is a struct `(address revertRecipient, bytes revertMsg)`
 * per contracts/evm-gateway/src/libraries/Types.sol.
 */

const REVERT_INSTRUCTIONS_COMPONENTS = [
  { internalType: 'address', name: 'revertRecipient', type: 'address' },
  { internalType: 'bytes', name: 'revertMsg', type: 'bytes' },
] as const;

// ── Source-chain UniversalGateway events ──────────────────────────────

/**
 * UniversalTx(
 *   address indexed sender,
 *   address indexed recipient,
 *   address token,
 *   uint256 amount,
 *   bytes payload,
 *   address revertRecipient,
 *   TX_TYPE txType,
 *   bytes signatureData,
 *   bool fromCEA
 * )
 *
 * Note: this event does NOT carry subTxId/universalTxId. The detector
 * derives universalTxId deterministically from (sourceChainId, txHash).
 */
export const EVENT_UNIVERSAL_TX = {
  anonymous: false,
  type: 'event',
  name: 'UniversalTx',
  inputs: [
    { indexed: true, internalType: 'address', name: 'sender', type: 'address' },
    { indexed: true, internalType: 'address', name: 'recipient', type: 'address' },
    { indexed: false, internalType: 'address', name: 'token', type: 'address' },
    { indexed: false, internalType: 'uint256', name: 'amount', type: 'uint256' },
    { indexed: false, internalType: 'bytes', name: 'payload', type: 'bytes' },
    { indexed: false, internalType: 'address', name: 'revertRecipient', type: 'address' },
    { indexed: false, internalType: 'uint8', name: 'txType', type: 'uint8' },
    { indexed: false, internalType: 'bytes', name: 'signatureData', type: 'bytes' },
    { indexed: false, internalType: 'bool', name: 'fromCEA', type: 'bool' },
  ],
} as const;

/**
 * UniversalTxExecuted(
 *   bytes32 indexed subTxId,
 *   bytes32 indexed universalTxId,
 *   address indexed pushAccount,
 *   address target,
 *   address token,
 *   uint256 amount,
 *   bytes data
 * )
 */
export const EVENT_UNIVERSAL_TX_EXECUTED = {
  anonymous: false,
  type: 'event',
  name: 'UniversalTxExecuted',
  inputs: [
    { indexed: true, internalType: 'bytes32', name: 'subTxId', type: 'bytes32' },
    { indexed: true, internalType: 'bytes32', name: 'universalTxId', type: 'bytes32' },
    { indexed: true, internalType: 'address', name: 'pushAccount', type: 'address' },
    { indexed: false, internalType: 'address', name: 'target', type: 'address' },
    { indexed: false, internalType: 'address', name: 'token', type: 'address' },
    { indexed: false, internalType: 'uint256', name: 'amount', type: 'uint256' },
    { indexed: false, internalType: 'bytes', name: 'data', type: 'bytes' },
  ],
} as const;

/**
 * RevertUniversalTx(
 *   bytes32 indexed subTxId,
 *   bytes32 indexed universalTxId,
 *   address indexed to,
 *   address token,
 *   uint256 amount,
 *   RevertInstructions revertInstruction
 * )
 */
export const EVENT_REVERT_UNIVERSAL_TX = {
  anonymous: false,
  type: 'event',
  name: 'RevertUniversalTx',
  inputs: [
    { indexed: true, internalType: 'bytes32', name: 'subTxId', type: 'bytes32' },
    { indexed: true, internalType: 'bytes32', name: 'universalTxId', type: 'bytes32' },
    { indexed: true, internalType: 'address', name: 'to', type: 'address' },
    { indexed: false, internalType: 'address', name: 'token', type: 'address' },
    { indexed: false, internalType: 'uint256', name: 'amount', type: 'uint256' },
    {
      indexed: false,
      internalType: 'struct RevertInstructions',
      name: 'revertInstruction',
      type: 'tuple',
      components: REVERT_INSTRUCTIONS_COMPONENTS,
    },
  ],
} as const;

/**
 * FundsRescued(
 *   bytes32 indexed subTxId,
 *   bytes32 indexed universalTxId,
 *   address indexed token,
 *   uint256 amount,
 *   RevertInstructions revertInstruction
 * )
 *
 * Emitted by both UniversalGateway and Vault.
 */
export const EVENT_FUNDS_RESCUED = {
  anonymous: false,
  type: 'event',
  name: 'FundsRescued',
  inputs: [
    { indexed: true, internalType: 'bytes32', name: 'subTxId', type: 'bytes32' },
    { indexed: true, internalType: 'bytes32', name: 'universalTxId', type: 'bytes32' },
    { indexed: true, internalType: 'address', name: 'token', type: 'address' },
    { indexed: false, internalType: 'uint256', name: 'amount', type: 'uint256' },
    {
      indexed: false,
      internalType: 'struct RevertInstructions',
      name: 'revertInstruction',
      type: 'tuple',
      components: REVERT_INSTRUCTIONS_COMPONENTS,
    },
  ],
} as const;

// ── Vault events ──────────────────────────────────────────────────────

/**
 * UniversalTxFinalized(
 *   bytes32 indexed subTxId,
 *   bytes32 indexed universalTxId,
 *   address indexed pushAccount,
 *   address recipient,
 *   address token,
 *   uint256 amount,
 *   bytes data
 * )
 */
export const EVENT_UNIVERSAL_TX_FINALIZED = {
  anonymous: false,
  type: 'event',
  name: 'UniversalTxFinalized',
  inputs: [
    { indexed: true, internalType: 'bytes32', name: 'subTxId', type: 'bytes32' },
    { indexed: true, internalType: 'bytes32', name: 'universalTxId', type: 'bytes32' },
    { indexed: true, internalType: 'address', name: 'pushAccount', type: 'address' },
    { indexed: false, internalType: 'address', name: 'recipient', type: 'address' },
    { indexed: false, internalType: 'address', name: 'token', type: 'address' },
    { indexed: false, internalType: 'uint256', name: 'amount', type: 'uint256' },
    { indexed: false, internalType: 'bytes', name: 'data', type: 'bytes' },
  ],
} as const;

/**
 * UniversalTxReverted(
 *   bytes32 indexed subTxId,
 *   bytes32 indexed universalTxId,
 *   address indexed token,
 *   uint256 amount,
 *   RevertInstructions revertInstruction
 * )
 */
export const EVENT_UNIVERSAL_TX_REVERTED = {
  anonymous: false,
  type: 'event',
  name: 'UniversalTxReverted',
  inputs: [
    { indexed: true, internalType: 'bytes32', name: 'subTxId', type: 'bytes32' },
    { indexed: true, internalType: 'bytes32', name: 'universalTxId', type: 'bytes32' },
    { indexed: true, internalType: 'address', name: 'token', type: 'address' },
    { indexed: false, internalType: 'uint256', name: 'amount', type: 'uint256' },
    {
      indexed: false,
      internalType: 'struct RevertInstructions',
      name: 'revertInstruction',
      type: 'tuple',
      components: REVERT_INSTRUCTIONS_COMPONENTS,
    },
  ],
} as const;

// ── Push-chain GatewayPC event ────────────────────────────────────────

/**
 * UniversalTxOutbound(
 *   bytes32 indexed subTxId,
 *   address indexed sender,
 *   string chainNamespace,
 *   address indexed token,
 *   bytes recipient,
 *   uint256 amount,
 *   address gasToken,
 *   uint256 gasFee,
 *   uint256 gasLimit,
 *   bytes payload,
 *   uint256 protocolFee,
 *   address revertRecipient,
 *   TX_TYPE txType,
 *   uint256 gasPrice
 * )
 */
export const EVENT_UNIVERSAL_TX_OUTBOUND = {
  anonymous: false,
  type: 'event',
  name: 'UniversalTxOutbound',
  inputs: [
    { indexed: true, internalType: 'bytes32', name: 'subTxId', type: 'bytes32' },
    { indexed: true, internalType: 'address', name: 'sender', type: 'address' },
    { indexed: false, internalType: 'string', name: 'chainNamespace', type: 'string' },
    { indexed: true, internalType: 'address', name: 'token', type: 'address' },
    { indexed: false, internalType: 'bytes', name: 'recipient', type: 'bytes' },
    { indexed: false, internalType: 'uint256', name: 'amount', type: 'uint256' },
    { indexed: false, internalType: 'address', name: 'gasToken', type: 'address' },
    { indexed: false, internalType: 'uint256', name: 'gasFee', type: 'uint256' },
    { indexed: false, internalType: 'uint256', name: 'gasLimit', type: 'uint256' },
    { indexed: false, internalType: 'bytes', name: 'payload', type: 'bytes' },
    { indexed: false, internalType: 'uint256', name: 'protocolFee', type: 'uint256' },
    { indexed: false, internalType: 'address', name: 'revertRecipient', type: 'address' },
    { indexed: false, internalType: 'uint8', name: 'txType', type: 'uint8' },
    { indexed: false, internalType: 'uint256', name: 'gasPrice', type: 'uint256' },
  ],
} as const;

/** Aggregated ABI handed to viem's parseEventLogs. */
export const UNIVERSAL_TX_EVENT_ABI = [
  EVENT_UNIVERSAL_TX,
  EVENT_UNIVERSAL_TX_EXECUTED,
  EVENT_REVERT_UNIVERSAL_TX,
  EVENT_FUNDS_RESCUED,
  EVENT_UNIVERSAL_TX_FINALIZED,
  EVENT_UNIVERSAL_TX_REVERTED,
  EVENT_UNIVERSAL_TX_OUTBOUND,
] as const;

/** Event names the detector knows about (for classify.ts). */
export type KnownEventName =
  | 'UniversalTx'
  | 'UniversalTxExecuted'
  | 'RevertUniversalTx'
  | 'FundsRescued'
  | 'UniversalTxFinalized'
  | 'UniversalTxReverted'
  | 'UniversalTxOutbound';
