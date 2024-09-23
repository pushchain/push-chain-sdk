# core

This package gives access to Push Network. Visit [Developer Docs](https://push.org/docs) or [Push.org](https://push.org) to learn more.

# Index

- [How to use in your app?](#how-to-use-in-your-app)
  - [Installation](#installation)
  - [Import SDK](#import-sdk)
  - [Initialize SDK](#initialize-sdk)
  - [About blockchain agnostic address format](#about-blockchain-agnostic-address-format)
- [SDK Features](#sdk-features)
  - [For PushNetwork Blocks](#for-pushnetwork-blocks)
    - [Fetch Blocks](#fetch-blocks)
    - [Search Block By Hash](#search-block-by-hash)

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

| Parameter       | Type         | Default            | Description                                                             |
| --------------- | ------------ | ------------------ | ----------------------------------------------------------------------- |
| `startTime` \*  | `number`     | Current Local Time | A number represting current time epoch                                  |
| `direction`\*   | `ASC` `DESC` | `ASC`              | A string represting direction in which blocks are fetched               |
| `showDetails`\* | `boolean`    | `false`            | A boolean represting whether tx Data shoudl be fetched or not           |
| `page`\*        | `number`     | 1                  | A number representing the page of results to retrieve.                  |
| `pageSize`\*    | `number`     | 30                 | A number representing the maximum number of feeds to retrieve per page. |

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

### **Deserialize Block**

## For PushNetwork Transactions

> Initializing PushNetwork class is the first step before proceeding to Transaction APIs. Please refer [Initialize SDK Section](#initialize-sdk)

### **Fetch Transactions**

### **Search Transaction By Hash**

```tsx
// search block with a given block hash
const txRes = await PushNetwork.tx.search('tx-hash');
```

**Parameters:**

| Parameter | Type     | Default | Description                           |
| --------- | -------- | ------- | ------------------------------------- |
| `txHash`  | `string` | -       | An string represting transaction hash |

\* - Optional

---

### Create Unsigned Transaction

### Send Transaction

### **Serialize Transaction**

### **Deserialize Transaction**

### **Serialize Transaction Payload Data**

### **Deserialize Transaction Payload Data**
