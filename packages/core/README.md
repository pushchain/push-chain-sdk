# Push Network Core

This package provides access to the Push Network. Visit the [Developer Docs](https://push.org/docs) or [Push.org](https://push.org) to learn more.

# Index

- [How to use in your app?](#how-to-use-in-your-app)
  - [Installation](#installation)
  - [Import SDK](#import-sdk)
  - [Initialize SDK](#initialize-sdk)
  - [About Blockchain-Agnostic Address Format](#about-blockchain-agnostic-address-format)
- [SDK Features](#sdk-features)
  - [For PushNetwork Blocks](#for-pushnetwork-blocks)
    - [Fetch Blocks](#fetch-blocks)
    - [Search Block by Hash](#search-block-by-hash)
    - [Serialize Block](#serialize-block)
    - [Deserialize Block](#deserialize-block)
  - [For PushNetwork Transactions](#for-pushnetwork-transactions)
    - [Fetch Transactions](#fetch-transactions)
    - [Search Transaction by Hash](#search-transaction-by-hash)
    - [Serialize Transaction](#serialize-transaction)
    - [Deserialize Transaction](#deserialize-transaction)
    - [Serialize Transaction Payload Data](#serialize-transaction-payload-data)
    - [Deserialize Transaction Payload Data](#deserialize-transaction-payload-data)

# How to use in your app?

## Installation

```bash
yarn add @pushprotocol/node-core@latest
```

or

```bash
npm install @pushprotocol/node-core@latest
```

## Import SDK

```typescript
import { PushNetwork } from '@pushprotocol/node-core';
```

## Initialize SDK

```typescript
// Initialize PushNetwork class instance
const userAlice = await PushNetwork.initialize('staging');
```

**Parameters**

| Param    | Type  | Default   | Remarks                     |
| -------- | ----- | --------- | --------------------------- |
| `env` \* | `ENV` | `staging` | API env - 'prod', 'staging' |

\* - Optional

---

## About blockchain agnostic address format

In any of the below methods (unless explicitly stated otherwise) we accept -

- [CAIP format](https://github.com/ChainAgnostic/CAIPs/blob/master/CAIPs/caip-10.md#test-cases): for any on chain addresses **_We strongly recommend using this address format_**. [Learn more about the format and examples](https://docs.push.org/developers/concepts/web3-notifications).
  (Example : `eip155:1:0xab16a96d359ec26a11e2c2b3d8f8b8942d5bfcdb`)

# SDK Features

## For PushNetwork Blocks

> Initializing PushNetwork class is the first step before proceeding to Block APIs. Please refer [Initialize SDK Section](#initialize-sdk)

### **Fetch Blocks**

```tsx
// get block data
const blockRes = await PushNetwork.block.get(
  Math.floor(Date.now() / 1000),
  'DESC',
  true,
  10,
  2
);
```

**Parameters:**

| Parameter       | Type         | Default            | Description                                                              |
| --------------- | ------------ | ------------------ | ------------------------------------------------------------------------ |
| `startTime` \*  | `number`     | Current Local Time | A number represting current time epoch                                   |
| `direction`\*   | `ASC` `DESC` | `ASC`              | A string represting direction in which blocks are fetched                |
| `showDetails`\* | `boolean`    | `false`            | A boolean represting whether tx Data shoudl be fetched or not            |
| `page`\*        | `number`     | 1                  | A number representing the page of results to retrieve.                   |
| `pageSize`\*    | `number`     | 30                 | A number representing the maximum number of blocks to retrieve per page. |

\* - Optional

---

### **Search Block By Hash**

```tsx
// search block with a given block hash
const blockRes = await PushNetwork.block.search('block-hash');
```

**Parameters:**

| Parameter   | Type     | Default | Description                     |
| ----------- | -------- | ------- | ------------------------------- |
| `blockHash` | `string` | -       | An string represting block hash |

\* - Optional

---

### **Serialize Block**

```tsx
import { Block } from '@pushprotocol/node-core';
const serializedBlock = Block.serialize(blockData);
```

ts: number;
txObj: TransactionObj[];
signers: Signer[];
attestToken: Uint8Array;

**Parameters:**

| Parameter     | Type         | Default | Description             |
| ------------- | ------------ | ------- | ----------------------- |
| `ts`          | `number`     | -       | Block timestamp         |
| `txObj`       | `object[]`   | -       | Block Transactions      |
| `signers`     | `object[]`   | -       | Block Signers           |
| `attestToken` | `Uint8Array` | -       | Block Attestation Token |

\* - Optional

---

### **Deserialize Block**

```tsx
import { Block } from '@pushprotocol/node-core';
const deserializedBlock = Block.deserialize(blockDataBytes);
```

**Parameters:**

| Parameter | Type         | Default | Description                   |
| --------- | ------------ | ------- | ----------------------------- |
| `block`   | `Uint8Array` | -       | Block encoded in bytes format |

\* - Optional

---

## For PushNetwork Transactions

> Initializing PushNetwork class is the first step before proceeding to Transaction APIs. Please refer [Initialize SDK Section](#initialize-sdk)

### **Fetch Transactions**

```tsx
// fetch transactions
const txRes = await PushNetwork.tx.get(
  Math.floor(Date.now() / 1000),
  'DESC',
  10,
  2
);
```

**Parameters:**

| Parameter      | Type         | Default            | Description                                                                    |
| -------------- | ------------ | ------------------ | ------------------------------------------------------------------------------ |
| `startTime` \* | `number`     | Current Local Time | A number represting current time epoch                                         |
| `direction`\*  | `ASC` `DESC` | `ASC`              | A string represting direction in which transactions are fetched                |
| `page`\*       | `number`     | 1                  | A number representing the page of results to retrieve.                         |
| `pageSize`\*   | `number`     | 30                 | A number representing the maximum number of transactions to retrieve per page. |
| `category`\*   | `string`     | -                  | A string representing the transaction category to be fetched                   |

\* - Optional

---

### **Search Transaction By Hash**

```tsx
// search transaction with a given tx hash
const txRes = await PushNetwork.tx.search('tx-hash');
```

**Parameters:**

| Parameter | Type     | Default | Description                           |
| --------- | -------- | ------- | ------------------------------------- |
| `txHash`  | `string` | -       | An string represting transaction hash |

\* - Optional

---

### **Create Unsigned Transaction**

```typescript
// create an unsigned transaction
const unsignedTx = PushNetwork.tx.createUnsigned(
  'CATEGORY',
  ['RECIPIENT1', 'RECIPIENT2'],
  serializedData
);
```

**Parameters:**

| Parameter    | Type         | Default | Description                         |
| ------------ | ------------ | ------- | ----------------------------------- |
| `category`   | `string`     | -       | Transaction category                |
| `recipients` | `string[]`   | -       | Array of recipient addresses        |
| `data`       | `Uint8Array` | -       | Serialized transaction payload data |

\* - Optional

---

### **Send Transaction**

```typescript
// send a transaction
const txHash = await PushNetwork.tx.send(unsignedTx, {
  sender: 'SENDER_ADDRESS',
  privKey: 'PRIVATE_KEY',
});
```

**Parameters:**

| Parameter    | Type          | Default | Description                         |
| ------------ | ------------- | ------- | ----------------------------------- |
| `unsignedTx` | `Transaction` | -       | Unsigned transaction object         |
| `session` \* | `Object`      | -       | Optional session object for signing |

\* - Optional

---

### **Serialize Transaction**

```typescript
import { Tx } from '@pushprotocol/node-core';
const serializedTx = Tx.serialize(txObject);
```

**Parameters:**

| Parameter | Type          | Default | Description        |
| --------- | ------------- | ------- | ------------------ |
| `tx`      | `Transaction` | -       | Transaction object |

\* - Optional

---

### **Deserialize Transaction**

```tsx
import { Tx } from '@pushprotocol/node-core';
const deserializedTx = Tx.deserialize(txDataBytes);
```

**Parameters:**

| Parameter | Type         | Default | Description                |
| --------- | ------------ | ------- | -------------------------- |
| `tx`      | `Uint8Array` | -       | Tx encoded in bytes format |

\* - Optional

---

### **Serialize Transaction Payload Data**

```typescript
import { Tx, TxCategory } from '@pushprotocol/node-core';
const serializedData = Tx.serializeData(txData, TxCategory.INIT_DID);
```

**Parameters:**

| Parameter  | Type                           | Default | Description                     |
| ---------- | ------------------------------ | ------- | ------------------------------- |
| `txData`   | `InitDid \| InitSessionKey Tx` | -       | Transaction payload data object |
| `category` | `TxCategory`                   | -       | Transaction category            |

\* - Optional

---

### **Deserialize Transaction Payload Data**

```typescript
import { Tx, TxCategory } from '@pushprotocol/node-core';
const deserializedData = Tx.deserializeData(
  serializedData,
  TxCategory.INIT_DID
);
```

**Parameters:**

| Parameter  | Type         | Default | Description                                        |
| ---------- | ------------ | ------- | -------------------------------------------------- |
| `txData`   | `Uint8Array` | -       | Serialized transaction payload                     |
| `category` | `TxCategory` | -       | Transaction category supported for Deserialization |

\* - Optional

---
