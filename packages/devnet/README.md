# Push Chain Devnet

> ⚠️ **Deprecated package**
>
> `@pushchain/devnet` is deprecated and will no longer receive updates. For interacting with Push Chain, please use one of the actively maintained packages instead:
>
> - `@pushchain/core` — Core TypeScript SDK for programmatic access
> - `@pushchain/ui-kit` — React UI kit and helpers for app integrations
>
> See the Developer Docs at `https://pushchain.github.io/push-chain-website/pr-preview/pr-1067/docs/chain/` for up-to-date guidance.

This package provides access to the Push Chain's Devnet. Visit the [Developer Docs](https://push.org/docs)
or [Push.org](https://push.org) to learn more.

- [Push Chain Devnet](#push-chain-devnet)
  - [How to use in your app?](#how-to-use-in-your-app)
    - [Installation](#installation)
    - [Import SDK](#import-sdk)
    - [Initialize SDK](#initialize-sdk)
      - [Read-only mode (without signer)](#read-only-mode-without-signer)
      - [With signer](#with-signer)
  - [Transactions](#transactions)
    - [Fetch Transactions](#fetch-transactions)
      - [Example: Retrieving by hash](#example-retrieving-by-hash)
      - [Example: Retrieving by category](#example-retrieving-by-category)
      - [Example: Retrieving by sender address](#example-retrieving-by-sender-address)
      - [Example: Retrieving by receiver address](#example-retrieving-by-receiver-address)
    - [Send Transaction](#send-transaction)
      - [Example: Send an email to a Solana address](#example-send-an-email-to-a-solana-address)
  - [Blocks](#blocks)
    - [Fetch Blocks](#fetch-blocks)
      - [Example: Fetch block by hash](#example-fetch-block-by-hash)
      - [Example: Retrieving by time](#example-retrieving-by-time)
  - [Utilities](#utilities)
    - [Converts CAIP-10 address to UniversalAccount](#converts-caip-10-address-to-universalaccount)
    - [Converts UniversalAccount to CAIP-10 address](#converts-universalaccount-to-caip-10-address)
    - [Converts an EVM (Ethereum) address to a Push (bech32m) address](#converts-an-evm-ethereum-address-to-a-push-bech32m-address)
    - [Converts a Push (bech32m) address back to an EVM (Ethereum) address in checksum format](#converts-a-push-bech32m-address-back-to-an-evm-ethereum-address-in-checksum-format)
    - [Serialize Transaction](#serialize-transaction)
    - [Deserialize Transaction](#deserialize-transaction)
    - [Serialize Transaction Payload Data](#serialize-transaction-payload-data)
    - [Deserialize Transaction Payload Data](#deserialize-transaction-payload-data)
    - [Serialize Block](#serialize-block)
    - [Deserialize Block](#deserialize-block)

## How to use in your app?

### Installation

```bash
yarn add @pushchain/devnet
```

or

```bash
npm install @pushchain/devnet
```

### Import SDK

```typescript
import { PushChain } from '@pushchain/devnet';
```

### Initialize SDK

#### Read-only mode (without signer)

Here below we will initialize the SDK without the signer. This is useful when you only need to read data from the Push
Chain.

```typescript
// Initialize PushChain class instance. Defaults to devnet.
const pushChain = await PushChain.initialize();
```

#### With signer

The `UniversalSigner` is only required when sending transactions. You can instantiate PushChain without a signer if you
only need read-only operations like fetching transactions or blocks.

In the example below we are using viem to sign the transaction.

```typescript
import { hexToBytes } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const randomPrivateKey = generatePrivateKey();
const account = privateKeyToAccount(randomPrivateKey);

const signer: UniversalSigner = {
  chain: CONSTANTS.CHAIN.PUSH,
  chainId: CONSTANTS.CHAIN_ID.PUSH.DEVNET,
  address: account.address,
  signMessage: async (data: Uint8Array) => {
    const signature = await account.signMessage({
      message: { raw: data },
    });
    return hexToBytes(signature);
  },
};

const pushChain = await PushChain.initialize(signer);
```

**Parameters:**

| Param               | Type              | Default  | Remarks                                                                                 |
| ------------------- | ----------------- | -------- | --------------------------------------------------------------------------------------- |
| _`universalSigner`_ | `UniversalSigner` | null     | Signer responsible for signing when sending transactions. Only used for `send` function |
| `options.network`   | `ENV`             | `devnet` | Push Chain environment                                                                  |

---

## Transactions

> Initializing PushChain class is the first step before proceeding to Transaction APIs. Please
> refer [Initialize SDK Section](#initialize-sdk)

### Fetch Transactions

Fetch transactions by hash, category, or address. You can also fetch all transactions and filter them by various
parameters like timestamp, category, etc.

```typescript
// pushChain.tx.get(reference, {options?})
const transaction = await pushChain.tx.get(
  '177482c5a504f3922875c216f71a2b236f344cfbf334f97c8f59547e1e21fb23'
);
```

**Parameters:**

| Param                | Type                                | Remarks                                                                                                                                | Default           |
| -------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `reference`          | `UniversalAccount`, `string`, `'*'` | Specifies the query target: `'*'` for all transactions, a transaction hash, or a UniversalAccount.                                     | `*`               |
| `options.raw`        | `boolean`                           | If `true`, returns the raw `BlockResponse`. If `false`, returns a `SimplifiedBlockResponse`. For most cases use default `raw = false`. | `false`           |
| `options.category`   | `string`                            | Filters transactions by category (e.g., application-specific tags).                                                                    | `undefined`       |
| `options.startTime`  | `number` (timestamp)                | Fetches transactions starting from this timestamp.                                                                                     | Current timestamp |
| `options.order`      | `ORDER` (`'ASC'` or `'DESC'`)       | Determines the sort order of transactions (`'ASC'` for ascending, `'DESC'` for descending).                                            | `'DESC'`          |
| `options.page`       | `number`                            | Specifies the page number for paginated results.                                                                                       | `1`               |
| `options.limit`      | `number`                            | Sets the maximum number of transactions to fetch per page.                                                                             | `30`              |
| `options.filterMode` | `'both'`, `'sender'`, `'recipient'` | Determines the query type: `'both'` fetches all, `'sender'` fetches sent, `'recipient'` fetches received.                              | `'both'`          |

---

#### Example: Retrieving by hash

Fetch a transaction that has the hash `177482c5a504f3922875c216f71a2b236f344cfbf334f97c8f59547e1e21fb23`.

```typescript
const transaction = await pushChain.tx.get(
  '177482c5a504f3922875c216f71a2b236f344cfbf334f97c8f59547e1e21fb23'
);
```

#### Example: Retrieving by category

```typescript
const transactionByCategory = await pushChain.tx.get('*', {
  category: 'CUSTOM:SAMPLE_TX',
});
```

#### Example: Retrieving by sender address

We will fetch transactions sent by this CAIP-10 address:
`push:devnet:pushconsumer1l8wd6ucrwf43stuavxwfc9jmr5emlkr66guml6`.

```typescript
const transctionBySender = await pushChain.tx.get(
  {
    chain: CONSTANTS.Chain.Push.devnet.name,
    chainId: CONSTANTS.Chain.Push.devnet.chainId,
    account: 'pushconsumer1l8wd6ucrwf43stuavxwfc9jmr5emlkr66guml6',
  },
  { filterMode: 'sender' }
);
```

#### Example: Retrieving by receiver address

We will fetch transactions received by this CAIP-10 address:
`push:devnet:pushconsumer1l8wd6ucrwf43stuavxwfc9jmr5emlkr66guml6`.

```typescript
const transctionBySender = await pushChain.tx.get(
  {
    chain: CONSTANTS.Chain.Push.devnet.name,
    chainId: CONSTANTS.Chain.Push.devnet.chainId,
    account: 'pushconsumer1l8wd6ucrwf43stuavxwfc9jmr5emlkr66guml6',
  },
  { filterMode: 'recipient' }
);
```

---

### Send Transaction

Send a transaction to one or more recipients. You can specify the transaction category and data payload.

```typescript
const tx = await pushChain.tx.send(
  [
    {
      chain: CONSTANTS.CHAIN.SOLANA,
      chainId: CONSTANTS.CHAIN_ID.SOLANA.DEVNET,
      account: 'ySYrGNLLJSK9hvGGpoxg8TzWfRe8ftBtDSMECtx2eJR',
    },
  ],
  {
    category: 'MY_CUSTOM_CATEGORY',
    data: 'Hello old friend from Solana!',
  }
);
```

**Parameters:**

| **Param**          | **Type**             | **Remarks**                                                                                                             |
| ------------------ | -------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `recipients`       | `UniversalAccount[]` | An array of recipient addresses in a chain-agnostic format. Each address specifies the destination for the transaction. |
| `options.category` | `string`             | The category of the transaction, used to classify or tag the transaction (e.g., `example-category`).                    |
| `options.data`     | `Uint8Array`         | Serialized data payload for the transaction.                                                                            |

#### Example: Send an email to a Solana address

Here below is an example of sending an Email to a Solana address. The payload is a simply JSON object with a title and
message.

```typescript
const email = {
  title: 'Hello from Ethereum!',
  message: 'This is a cross-chain email to Solana.',
};

const recipients = [
  {
    chain: CONSTANTS.CHAIN.SOLANA,
    chainId: CONSTANTS.CHAIN_ID.SOLANA.DEVNET,
    account: 'ySYrGNLLJSK9hvGGpoxg8TzWfRe8ftBtDSMECtx2eJR',
  },
];

const tx = await pushChain.tx.send(recipients, {
  category: 'MY_EMAIL_APP',
  data: JSON.stringify(email),
});
```

---

## Blocks

> Initializing PushChain class is the first step before proceeding to Block APIs. Please
> refer [Initialize SDK Section](#initialize-sdk)

### Fetch Blocks

Fetch blocks by hash or timestamp.

```typescript
// pushChain.block.get(reference, {options?})
const block = await pushChain.block.get(
  '36939148bee59c6e1a9d4e6e6fb4e72d407f8667324714c206e64e1485f0f5ee'
);
```

**Parameters:**

| Param               | Type                          | Remarks                                                                                                                                | Default           |
| ------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `reference`         | `string`, `'*'`               | Specifies the query target: `'*'` for all blocks or a block hash.                                                                      | `*`               |
| `options.raw`       | `boolean`                     | If `true`, returns the raw `BlockResponse`. If `false`, returns a `SimplifiedBlockResponse`. For most cases use default `raw = false`. | `false`           |
| `options.startTime` | `number` (timestamp)          | Fetches blocks starting from this timestamp.                                                                                           | Current timestamp |
| `options.order`     | `ORDER` (`'ASC'` or `'DESC'`) | Determines the sort order of blocks (`'ASC'` for ascending, `'DESC'` for descending).                                                  | `'DESC'`          |
| `options.page`      | `number`                      | Specifies the page number for paginated results.                                                                                       | `1`               |
| `options.limit`     | `number`                      | Sets the maximum number of transactions to fetch per page.                                                                             | `30`              |

#### Example: Fetch block by hash

Fetch a Block that has the hash `36939148bee59c6e1a9d4e6e6fb4e72d407f8667324714c206e64e1485f0f5ee`.

```typescript
const block = await pushChain.block.get(
  '36939148bee59c6e1a9d4e6e6fb4e72d407f8667324714c206e64e1485f0f5ee'
);
```

#### Example: Retrieving by time

```typescript
const yesterday = Math.floor(Date.now() - 24 * 60 * 60 * 1000);
const blockByTime = await pushChain.block.get('*', {
  startTime: yesterday,
});
```

---

## Utilities

### Converts CAIP-10 address to UniversalAccount

Converts a chain-agnostic address (e.g. `eip155:1:0xabc...`) into a UniversalAccount.

```typescript
const universalAccount = PushChain.utils.account.toUniversal(
  'push:devnet:push1xkuy...'
);
// => { chain: 'PUSH', chainId: 'DEVNET', address: 'push1xkuy...' }
```

### Converts UniversalAccount to CAIP-10 address

Converts a UniversalAccount into a chain-agnostic address (CAIP) string.

```typescript
const chainAgnosticStr = PushChain.utils.account.toChainAgnostic({
  chain: 'ETHEREUM',
  chainId: '1',
  address: '0xabc123...',
});
// => 'eip155:1:0xabc123...'
```

### Converts an EVM (Ethereum) address to a Push (bech32m) address

Converts an EVM (Ethereum) address to a Push (bech32m) address.

```typescript
const pushAddr = PushChain.utils.account.evmToPush(
  '0x35B84d6848D16415177c64D64504663b998A6ab4'
);
// => 'push1xkuy66zg69jp29muvnty2prx8wvc5645f9y5ux'
```

### Converts a Push (bech32m) address back to an EVM (Ethereum) address in checksum format

```typescript
const evmAddr = PushChain.utils.account.pushToEvmAddress(
  'push1xkuy66zg69jp29muvnty2prx8wvc5645f9y5ux'
);
// => '0x35B84d6848D16415177c64D64504663b998A6ab4'
```

### Serialize Transaction

Serializes a Transaction into a Uint8Array. Note: The SDK handles transaction serialization automatically - this utility
is only needed for an advanced use case where manual serialization is required.

```typescript
const serializedTx = PushChain.utils.tx.serialize(myTx);
```

### Deserialize Transaction

Deserializes a Uint8Array back into a Transaction object. Note: The SDK handles transaction deserialization
automatically - this utility is only needed for an advanced use case where manual deserialization is required.

```typescript
const deserializedTx = PushChain.utils.tx.deserialize(serializedTx);
```

### Serialize Transaction Payload Data

Serializes transaction data (e.g. `InitDid`) based on the transaction category. Note: The SDK handles transaction data
serialization automatically - this utility is only needed for an advanced use case where manual serialization is
required.

```typescript
const initDidData = {
  /* ...  */
};
const serializedData = PushChain.utils.tx.serializeData(
  initDidData,
  TxCategory.INIT_DID
);
```

### Deserialize Transaction Payload Data

Deserializes transaction data (e.g. `InitDid`) from a Uint8Array based on the transaction category. Note: The SDK
handles transaction data deserialization automatically - this utility is only needed for an advanced use case where
manual deserialization is required.

```typescript
const deserializedData = PushChain.utils.tx.deserializeData(
  serializedData,
  TxCategory.INIT_DID
);
```

### Serialize Block

Serializes a GeneratedBlock into a Uint8Array. Note: The SDK handles block serialization automatically - this utility is
only needed for an advanced use case where manual serialization is required.

```typescript
const encodedBlock = PushChain.utils.block.serialize(myBlock);
```

### Deserialize Block

Deserializes a Uint8Array back into a GeneratedBlock object. Note: The SDK handles block deserialization automatically -
this utility is only needed for an advanced use case where manual deserialization is required.

```typescript
const decodedBlock = PushChain.utils.block.deserialize(encodedBlock);
```
