import { parseAbi } from 'viem';
import { READ_SPEC_COMPONENTS } from './universalCallback.evm';

/** UniversalReadRegistry ABI supplied with the Donut proxy deployment. */
export const UNIVERSAL_READ_REGISTRY_EVM = [
  {
    type: 'function', name: 'read', stateMutability: 'payable',
    inputs: [
      { name: 'spec', type: 'tuple', components: READ_SPEC_COMPONENTS },
      { name: 'queryKey', type: 'bytes32' },
      { name: 'callbackGasLimit', type: 'uint64' },
    ],
    outputs: [{ name: 'requestId', type: 'uint256' }],
  },
  ...parseAbi([
    'constructor(address universalCallback_)',
    'function initialize()',
    'function getLocalContext(uint256 requestId) view returns (bytes)',
    'function hasResult(uint256 requestId) view returns (bool)',
    'function onUniversalData(uint256 requestId, bytes resultData)',
    'function queryKeyOf(uint256) view returns (bytes32)',
    'function readerOf(uint256) view returns (address)',
    'function requestOrderOf(uint256) view returns (uint256)',
    'function universalCallback() view returns (address)',
    'function resultByRequestId(uint256 requestId) view returns ((uint256 requestId, bytes resultData, uint64 updatedAtBlock))',
    'function latestResult(address reader, bytes32 queryKey) view returns ((uint256 requestId, bytes resultData, uint64 updatedAtBlock))',
    'event Initialized(uint64 version)',
    'event RegistryReadRequested(uint256 indexed requestId, address indexed reader, bytes32 indexed queryKey)',
    'event RegistryReadStored(uint256 indexed requestId, address indexed reader, bytes32 indexed queryKey)',
    'error InvalidInitialization()',
    'error NotInitializing()',
    'error UnauthorizedCaller()',
    'error ZeroAddressInit()',
  ]),
] as const;
