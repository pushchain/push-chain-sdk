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
      }
    ],
    "name": "sendUniversalTxToUEA",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
] as const;
