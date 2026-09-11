/**
 * Minimal ABI for `UniversalCallback` on Push Chain (genesis predeploy at 0x…C2).
 *
 * Mirrors push-chain-core-contracts@feat-read-state (f8d1a0c), the version deployed
 * on Donut. Only what the SDK calls, decodes or parses is included.
 *
 * The `ReadRequested` event fragment MUST stay byte-identical to the node's decoder
 * (`x/ucallback/types/read_event.go:30-56`): `callbackGasLimit` sits fifth, between
 * `originalFunder` and `totalPaid`. Reordering changes topic0 and the SDK would
 * silently find zero logs. Pinned by `read-state/__tests__/abi-selectors.spec.ts`.
 */

const READ_SPEC_COMPONENTS = [
  {
    name: 'account',
    type: 'tuple',
    internalType: 'struct UniversalAccountId',
    components: [
      { name: 'chainNamespace', type: 'string', internalType: 'string' },
      { name: 'chainId', type: 'string', internalType: 'string' },
      { name: 'owner', type: 'bytes', internalType: 'bytes' },
    ],
  },
  { name: 'query', type: 'bytes', internalType: 'bytes' },
  { name: 'minConfirmations', type: 'uint16', internalType: 'uint16' },
  { name: 'blockNumber', type: 'uint64', internalType: 'uint64' },
  { name: 'expiryPushChainHeight', type: 'uint64', internalType: 'uint64' },
  { name: 'maxFee', type: 'uint256', internalType: 'uint256' },
  { name: 'revertRecipient', type: 'address', internalType: 'address' },
] as const;

export const UNIVERSAL_CALLBACK_EVM = [
  // ---- functions ----
  {
    type: 'function',
    name: 'requestExternalReadSelf',
    inputs: [
      { name: 'spec', type: 'tuple', internalType: 'struct ReadSpec', components: READ_SPEC_COMPONENTS },
      { name: 'callbackSelector', type: 'bytes4', internalType: 'bytes4' },
      { name: 'callbackGasLimit', type: 'uint64', internalType: 'uint64' },
    ],
    outputs: [{ name: 'requestId', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'estimateFee',
    inputs: [
      { name: 'chainNamespace', type: 'string', internalType: 'string' },
      { name: 'chainId', type: 'string', internalType: 'string' },
    ],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'statusOf',
    inputs: [{ name: 'requestId', type: 'uint256', internalType: 'uint256' }],
    outputs: [{ name: '', type: 'uint8', internalType: 'enum RequestStatus' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isFulfilled',
    inputs: [{ name: 'requestId', type: 'uint256', internalType: 'uint256' }],
    outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getPendingRead',
    inputs: [{ name: 'requestId', type: 'uint256', internalType: 'uint256' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        internalType: 'struct PendingRead',
        components: [
          { name: 'callbackTarget', type: 'address', internalType: 'address' },
          { name: 'callbackSelector', type: 'bytes4', internalType: 'bytes4' },
          { name: 'callbackGasLimit', type: 'uint64', internalType: 'uint64' },
          { name: 'originalFunder', type: 'address', internalType: 'address' },
          { name: 'expiryHeight', type: 'uint64', internalType: 'uint64' },
          { name: 'revertRecipient', type: 'address', internalType: 'address' },
          { name: 'callbackBudget', type: 'uint256', internalType: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'totalEscrowed',
    inputs: [],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'blockedDomains',
    inputs: [
      { name: 'chainNamespace', type: 'string', internalType: 'string' },
      { name: 'chainId', type: 'string', internalType: 'string' },
    ],
    outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
    stateMutability: 'view',
  },

  // ---- events ----
  {
    type: 'event',
    name: 'ReadRequested',
    anonymous: false,
    inputs: [
      { name: 'requestId', type: 'uint256', indexed: true, internalType: 'uint256' },
      { name: 'readSpec', type: 'tuple', indexed: false, internalType: 'struct ReadSpec', components: READ_SPEC_COMPONENTS },
      { name: 'callbackTarget', type: 'address', indexed: true, internalType: 'address' },
      { name: 'originalFunder', type: 'address', indexed: true, internalType: 'address' },
      { name: 'callbackGasLimit', type: 'uint64', indexed: false, internalType: 'uint64' },
      { name: 'totalPaid', type: 'uint256', indexed: false, internalType: 'uint256' },
      { name: 'protocolFee', type: 'uint256', indexed: false, internalType: 'uint256' },
      { name: 'callbackBudget', type: 'uint256', indexed: false, internalType: 'uint256' },
    ],
  },
  {
    type: 'event',
    name: 'ReadFulfilled',
    anonymous: false,
    inputs: [
      { name: 'requestId', type: 'uint256', indexed: true, internalType: 'uint256' },
      { name: 'resultData', type: 'bytes', indexed: false, internalType: 'bytes' },
    ],
  },
  {
    type: 'event',
    name: 'CallbackFailed',
    anonymous: false,
    inputs: [
      { name: 'requestId', type: 'uint256', indexed: true, internalType: 'uint256' },
      { name: 'reason', type: 'bytes', indexed: false, internalType: 'bytes' },
    ],
  },
  {
    type: 'event',
    name: 'CallbackGasReported',
    anonymous: false,
    inputs: [
      { name: 'requestId', type: 'uint256', indexed: true, internalType: 'uint256' },
      { name: 'gasReported', type: 'uint256', indexed: false, internalType: 'uint256' },
      { name: 'burned', type: 'uint256', indexed: false, internalType: 'uint256' },
      { name: 'refunded', type: 'uint256', indexed: false, internalType: 'uint256' },
    ],
  },
  {
    type: 'event',
    name: 'RefundSent',
    anonymous: false,
    inputs: [
      { name: 'requestId', type: 'uint256', indexed: true, internalType: 'uint256' },
      { name: 'recipient', type: 'address', indexed: true, internalType: 'address' },
      { name: 'amount', type: 'uint256', indexed: false, internalType: 'uint256' },
    ],
  },
  {
    type: 'event',
    name: 'RefundFailed',
    anonymous: false,
    inputs: [
      { name: 'requestId', type: 'uint256', indexed: true, internalType: 'uint256' },
      { name: 'recipient', type: 'address', indexed: true, internalType: 'address' },
      { name: 'amount', type: 'uint256', indexed: false, internalType: 'uint256' },
    ],
  },
  {
    type: 'event',
    name: 'RequestExpired',
    anonymous: false,
    inputs: [
      { name: 'requestId', type: 'uint256', indexed: true, internalType: 'uint256' },
      { name: 'revertRecipient', type: 'address', indexed: true, internalType: 'address' },
      { name: 'refunded', type: 'uint256', indexed: false, internalType: 'uint256' },
    ],
  },
  {
    type: 'event',
    name: 'ProtocolFeeDistributed',
    anonymous: false,
    inputs: [
      { name: 'requestId', type: 'uint256', indexed: true, internalType: 'uint256' },
      { name: 'vaultPC', type: 'address', indexed: true, internalType: 'address' },
      { name: 'amount', type: 'uint256', indexed: false, internalType: 'uint256' },
    ],
  },

  // ---- custom errors (decoded by simulate() into actionable messages) ----
  { type: 'error', name: 'InvalidAccountId', inputs: [] },
  { type: 'error', name: 'EmptyQuery', inputs: [] },
  { type: 'error', name: 'InvalidMinConfirmations', inputs: [] },
  {
    type: 'error',
    name: 'DomainBlocked',
    inputs: [
      { name: 'chainNamespace', type: 'string', internalType: 'string' },
      { name: 'chainId', type: 'string', internalType: 'string' },
    ],
  },
  { type: 'error', name: 'InvalidBlockNumber', inputs: [] },
  { type: 'error', name: 'InvalidExpiryHeight', inputs: [] },
  { type: 'error', name: 'ZeroRevertRecipient', inputs: [] },
  { type: 'error', name: 'ZeroCallbackGasLimit', inputs: [] },
  {
    type: 'error',
    name: 'CallbackGasLimitExceeded',
    inputs: [
      { name: 'provided', type: 'uint64', internalType: 'uint64' },
      { name: 'max', type: 'uint64', internalType: 'uint64' },
    ],
  },
  {
    type: 'error',
    name: 'InsufficientFee',
    inputs: [
      { name: 'provided', type: 'uint256', internalType: 'uint256' },
      { name: 'required', type: 'uint256', internalType: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'ExcessiveFee',
    inputs: [
      { name: 'provided', type: 'uint256', internalType: 'uint256' },
      { name: 'maxFee', type: 'uint256', internalType: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'InvalidRequestStatus',
    inputs: [
      { name: 'requestId', type: 'uint256', internalType: 'uint256' },
      { name: 'actual', type: 'uint8', internalType: 'uint8' },
      { name: 'expected', type: 'uint8', internalType: 'uint8' },
    ],
  },
  { type: 'error', name: 'ContractIsPaused', inputs: [] },
  { type: 'error', name: 'CallerIsNotUCallbackModule', inputs: [] },
  { type: 'error', name: 'UnauthorizedCaller', inputs: [] },
] as const;
