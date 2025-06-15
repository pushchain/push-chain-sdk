# Push Chain Core

This package provides access to the Push Chain. Visit the [Developer Docs](https://push.org/docs)  
or [Push.org](https://push.org) to learn more.

- [How to use in your app?](#how-to-use-in-your-app)
  - [Installation](#installation)
  - [Import SDK](#import-sdk)
  - [Initialize SDK](#initialize-sdk)
    - [Read-only mode (without signer)](#read-only-mode-without-signer)
    - [With signer](#with-signer)
      - [UniversalSigner structure](#universalsigner-structure)
      - [Example using `viem` to create a UniversalSigner](#example-using-viem-to-create-a-universalsigner)
  - [Execute Cross-Chain Transaction](#execute-cross-chain-transaction)
- [Utilities](#utilities)
  - [Converts CAIP-10 address to UniversalAccount](#converts-caip-10-address-to-universalaccount)
  - [Converts UniversalAccount to CAIP-10 address](#converts-universalaccount-to-caip-10-address)
  - [Convert viem account or walletClient to UniversalSigner](#convert-viem-account-or-walletclient-to-universalsigner)
  - [Convert Solana keypair to UniversalSigner](#convert-solana-keypair-to-universalsigner)

---

## How to use in your app?

### Installation

```bash
yarn add @pushchain/core
```

or

```bash
npm install @pushchain/core
```

---

### Import SDK

```ts
import { PushChain } from '@pushchain/core';
```

---

### Initialize SDK

#### Read-only mode (without signer)

> 🟡 Coming soon  
> You will be able to use the SDK in read-only mode for querying without attaching a signer.

---

#### With signer

To send cross-chain transactions or perform signature-based validations, you need to initialize the SDK with a `UniversalSigner`.

The `UniversalSigner` abstracts signing across different chains and VMs (EVM, Solana, etc.), allowing Push Chain to use a unified interface for signing messages and transactions on the **source chain**.

> 💡 You can use `PushChain.utils.signer` to wrap native EVM or Solana signers into a compatible `UniversalSigner`.

---

##### UniversalSigner structure

```ts
/**
 * A chain-agnostic account representation.
 * Used to represent a wallet address along with its chain context.
 */
export interface UniversalAccount {
  /**
   * Fully qualified chain (e.g., CHAIN.ETHEREUM_SEPOLIA, CHAIN.SOLANA_DEVNET)
   */
  chain: CHAIN;

  /**
   * The address on the respective chain (EVM: checksummed, Solana: base58, etc.)
   */
  address: string;
}

/**
 * A signer capable of signing messages for a specific chain.
 * Used to abstract away signing across multiple VM types.
 */
export interface UniversalSigner extends UniversalAccount {
  /**
   * Signs an arbitrary message as a Uint8Array.
   * Use UTF-8 encoding for strings before signing.
   */
  signMessage: (data: Uint8Array) => Promise<Uint8Array>;

  /**
   * Signs EIP-712 typed data.
   * Optional. Only required for EVM signers.
   */
  signTypedData?: ({
    domain,
    types,
    primaryType,
    message,
  }: {
    domain: TypedDataDomain;
    types: TypedData;
    primaryType: string;
    message: Record<string, any>;
  }) => Promise<Uint8Array>;

  /**
   * Signs and sends a transaction (unsigned transaction bytes).
   * Used for direct on-chain sending when necessary.
   */
  signAndSendTransaction: (unsignedTx: Uint8Array) => Promise<Uint8Array>;
}
```

---

##### Example using `viem` to create a UniversalSigner

```ts
import { hexToBytes } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { CHAIN } from '@pushchain/core/constants/enums';
import { PushChain } from '@pushchain/core';

const privateKey = generatePrivateKey();
const account = privateKeyToAccount(privateKey);

const signer: UniversalSigner = PushChain.utils.signer.toUniversalFromViem(
  account,
  CHAIN.ETHEREUM_SEPOLIA
);

const pushChain = await PushChain.initialize(signer);
```

**Parameters:**

| Param             | Type              | Default   | Description                                                                    |
| ----------------- | ----------------- | --------- | ------------------------------------------------------------------------------ |
| `universalSigner` | `UniversalSigner` | `null`    | Required for sending transactions or verifying signatures on the source chain. |
| `options.network` | `PUSH_NETWORK`    | `testnet` | Push Chain environment. Can be `testnet`, or `mainnet`.                        |

---

### Execute Cross-Chain Transaction

```ts
pushchain.execute({
  // Target to execute on Push Chain - Can be EOA or smart contract address
  target: '0x2FE70447492307108Bdc7Ff6BaB33Ff37Dacc479',
  // Amount to send to the target in npush
  value: BigInt(0),
  // Data to send to the target - contract function call data
  data: '0x2ba2ed980000000000000000000000000000000000000000000000000000000000000312',
  // Gas limit for the transaction on Push Chain
  gasLimit: BigInt(50000000000000000),
  // Max fee per gas on Push Chain
  maxFeePerGas: BigInt(50000000000000000),
  // Max priority fee per gas on Push Chain
  maxPriorityFeePerGas: BigInt(200000000),
  // Deadline for the transaction to be executed on Push Chain
  deadline: BigInt(9999999999),
});
```

**Parameters:**

| Param                  | Type     | Default                       | Description                                                                      |
| ---------------------- | -------- | ----------------------------- | -------------------------------------------------------------------------------- |
| `target`               | `string` | —                             | Target address on Push Chain to execute the transaction. Can be EOA or contract. |
| `value`                | `bigint` | -                             | Amount in **npush** (smallest unit) to transfer to the target address.           |
| `data`                 | `string` | -                             | Hex-encoded calldata for the contract method to execute.                         |
| `gasLimit`             | `bigint` | 21000000                      | Max gas allowed for the transaction execution on Push Chain.                     |
| `maxFeePerGas`         | `bigint` | 10000000000000000             | Maximum fee per unit of gas the sender is willing to pay.                        |
| `maxPriorityFeePerGas` | `bigint` | 2                             | Priority tip for validators to include this tx (like EIP-1559).                  |
| `nonce`                | `bigint` | Taken automatically from NMSC | Transaction execution order on Push Chain.                                       |
| `deadline`             | `bigint` | 9999999999                    | Timestamp (in seconds) by which the tx must be included on Push Chain.           |

---

## Utilities

### Converts CAIP-10 address to UniversalAccount

Converts a chain-agnostic address (e.g. `eip155:1:0xabc...`) into a UniversalAccount.

```typescript
const universalAccount = PushChain.utils.account.fromChainAgnostic(
  'eip155:11155111:0x35B84d6848D16415177c64D64504663b998A6ab4'
);
// => { chain: 'ETHEREUM_SEPOLIA', address: '0x35B84d6848D16415177c64D64504663b998A6ab4' }
```

### Converts UniversalAccount to CAIP-10 address

Converts a UniversalAccount into a chain-agnostic address (CAIP) string.

```typescript
const chainAgnosticStr = PushChain.utils.account.toChainAgnostic({
  chain: 'ETHEREUM_SEPOLIA',
  address: '0x35B84d6848D16415177c64D64504663b998A6ab4',
});
// => 'eip155:11155111:0x35B84d6848D16415177c64D64504663b998A6ab4'
```

### Convert viem account or walletClient to UniversalSigner

```ts
import { PushChain } from '@pushchain/core';
import { CHAIN } from '@pushchain/core/constants/enums';
import { privateKeyToAccount } from 'viem/accounts';

const account = privateKeyToAccount('0x...');
const universalSigner = PushChain.utils.signer.toUniversalFromViem(
  account,
  CHAIN.ETHEREUM_SEPOLIA
);
```

You can also use this with viem’s `walletClient`.

---

### Convert Solana keypair to UniversalSigner

```ts
import { Keypair } from '@solana/web3.js';
import { PushChain } from '@pushchain/core';
import { CHAIN } from '@pushchain/core/constants/enums';

const keypair = Keypair.generate();
const signer = PushChain.utils.signer.toUniversalFromSolanaKeypair(
  keypair,
  CHAIN.SOLANA_DEVNET
);
```
