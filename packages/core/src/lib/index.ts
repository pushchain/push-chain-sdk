import { PushChain } from './push-chain/push-chain';
export type { ConversionQuote } from './constants/tokens';
export type {
  UniversalSigner,
  UniversalAccount,
  UniversalSignerSkeleton,
  SignAuthorizationParams,
  SignedAuthorization,
  DerivedExecutorAccount,
  ResolvedAccount,
  ResolvedControllerAccounts,
  AccountType,
  AccountRole,
} from './universal/universal.types';

// PC20
export type {
  PC20TokenReference,
  FundsToken,
  PC20RegistryEntry,
  PC20AddressResult,
} from './orchestrator/orchestrator.types';
export { isPC20Reference } from './orchestrator/orchestrator.types';
export {
  PC20Error,
  InvalidPC20AddressError,
  PC20TokenChainMismatchError,
  PC20WrapperNotRegisteredError,
  PC20RegistryMismatchError,
  PC20FactoryMismatchError,
  InvalidPC20MetadataError,
  PC20ExpectedButPRC20Error,
  PC20AmbiguousAddressError,
  UnsupportedPC20DestinationError,
  InsufficientPC20BalanceError,
  PC20UnknownChainNamespaceError,
  PC20WrapperPredictionUnavailableError,
  PC20ExportRevertedError,
  PC20UnsafeEmptyPayloadError,
} from './orchestrator/internals/pc20/errors';

// Multi-chain types
export type {
  ChainTarget,
  ChainSource,
  UniversalTo,
  TransactionRouteType,
  UniversalExecuteParams,
  UniversalOutboundTxRequest,
  PreparedUniversalTx,
  CascadedTxResponse,
  CascadeHopInfo,
  CascadeTrackOptions,
  CascadeProgressEvent,
  CascadeCompletionResult,
  MultiChainTxResponse,
  OutboundTxDetails,
  WaitForOutboundOptions,
  // SVM (Solana) — internal-only types (SvmExecuteParams removed; callers now pass `data`)
  SvmGatewayAccountMeta,
  SvmExecutePayloadFields,
  // Account status types (UEA Migration)
  AccountStatus,
  UEAStatus,
  // Rescue funds
  RescueFundsParams,
} from './orchestrator/orchestrator.types';

// UEA version utility
export { parseUEAVersion } from './orchestrator/orchestrator.types';

// Route detection utilities
export { TransactionRoute, detectRoute, isChainTarget } from './orchestrator/route-detector';

// Outbound gas cap helpers
export {
  DEFAULT_MAX_PC_FOR_GAS_BUFFER_BPS,
  MAX_PC_FOR_GAS_BUFFER_BPS_LIMIT,
  quoteMaxPCForGasCap,
  quoteMaxPCForGasCapFromNativeValue,
} from './orchestrator/max-pc-for-gas';
export type {
  MaxPCForGasCapInput,
  MaxPCForGasCapFromNativeValueInput,
  MaxPCForGasCapQuote,
} from './orchestrator/max-pc-for-gas';

// CEA utilities
export {
  getCEAAddress,
  getPushAccountForCEA,
  isCEA,
  chainSupportsCEA,
  chainSupportsOutbound,
  getCEAFactoryAddress,
  getAllCEAAddresses,
} from './orchestrator/cea-utils';

// Payload builder utilities (SVM + EVM outbound helpers)
export {
  encodeSvmExecutePayload,
  isSvmChain,
  isValidSolanaHexAddress,
  buildMigrationPayload,
  buildErc20WithdrawalMulticall,
} from './orchestrator/payload-builders';

// Read state (cross-chain reads)
export type {
  ReadDestination,
  ResolvedDestination,
  ReadQuery,
  EvmReadQuery,
  SvmReadQuery,
  Web2ReadQuery,
  Web2Extract,
  Web2ValueType,
  EncodedReadQuery,
  ReadResultShape,
  DecodedReadResult,
  ReadPreflight,
  ReadSpec,
  ReadSpecTuple,
  BuildReadSpecParams,
  PreparedRead,
  SimulateReadResult,
  ParsedReadRequest,
  FulfilOutcome,
  ReceiptLike,
  ReadRef,
  ReadLifecycleOptions,
  ReadFees,
  UniversalReadResponse,
} from './read-state/read-state.types';
export type { ReadChain, ReadOptions, ReadWeb2Options, ReadTrackOptions } from './read-state/read-params';
export {
  UNIVERSAL_READ_STATUS,
  READ_STATUS,
  READ_ERROR_CODE,
  CONTRACT_REQUEST_STATUS,
  TERMINAL_READ_STATUSES,
} from './read-state/read-state.types';
export {
  ReadStateError,
  InvalidReadQueryError,
  InvalidReadSpecError,
  ReadHeightUnavailableError,
  UnsupportedReadDestinationError,
  ReadDecodeError,
  ReadTimeoutError,
  ReadNotFoundError,
  ReadRegistryUnavailableError,
} from './read-state/errors';
export type { ReadSpecViolation } from './read-state/errors';
export {
  resolveDestination,
  encodeReadQuery,
  decodeReadResult,
  parseReadRequestsFromReceipt,
  parseFulfilOutcome,
  buildReadSpecFromPreflight,
  validateReadSpec,
  toCallData,
  sizeCallbackBudget,
  inferResultShape,
  toRequestIdHex,
  READ_CHAIN_WEB2,
  toReadQuery,
} from './read-state';
export { UNIVERSAL_CALLBACK_EVM } from './constants/abi/universalCallback.evm';

export { PushChain };
