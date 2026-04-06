export const UNIVERSAL_GATEWAY_V0 = [
  {
    "inputs": [
      {
        "components": [
          {
            "internalType": "address",
            "name": "recipient",
            "type": "address"
          },
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
            "components": [
              {
                "internalType": "address",
                "name": "fundRecipient",
                "type": "address"
              },
              {
                "internalType": "bytes",
                "name": "revertMsg",
                "type": "bytes"
              }
            ],
            "internalType": "struct RevertInstructions",
            "name": "revertInstruction",
            "type": "tuple"
          },
          {
            "internalType": "bytes",
            "name": "signatureData",
            "type": "bytes"
          }
        ],
        "internalType": "struct UniversalTxRequest",
        "name": "req",
        "type": "tuple"
      }
    ],
    "name": "sendUniversalTxFromCEA",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  },
] as const;
