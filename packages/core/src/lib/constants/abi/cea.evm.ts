export const CEA_EVM = [
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "token",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "internalType": "bytes",
        "name": "payload",
        "type": "bytes"
      },
      {
        "internalType": "address",
        "name": "revertRecipient",
        "type": "address"
      }
    ],
    "name": "sendUniversalTxToUEA",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    inputs: [],
    name: 'AlreadyInitialized',
    type: 'error',
  },
  {
    inputs: [],
    name: 'ZeroAddress',
    type: 'error',
  },
  {
    inputs: [],
    name: 'NotVault',
    type: 'error',
  },
  {
    inputs: [],
    name: 'InvalidTarget',
    type: 'error',
  },
  {
    inputs: [],
    name: 'InsufficientBalance',
    type: 'error',
  },
  {
    inputs: [],
    name: 'PayloadExecuted',
    type: 'error',
  },
  {
    inputs: [],
    name: 'InvalidUEA',
    type: 'error',
  },
  {
    inputs: [],
    name: 'InvalidInput',
    type: 'error',
  },
  {
    inputs: [],
    name: 'ExecutionFailed',
    type: 'error',
  },
  {
    inputs: [],
    name: 'InvalidCall',
    type: 'error',
  },
  {
    inputs: [],
    name: 'InvalidRecipient',
    type: 'error',
  },
  {
    inputs: [],
    name: 'InvalidImplementation',
    type: 'error',
  },
  {
    inputs: [],
    name: 'CEAAlreadyDeployed',
    type: 'error',
  },
] as const;
