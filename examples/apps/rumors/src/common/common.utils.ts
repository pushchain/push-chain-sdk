import { UniversalAddress } from '@pushprotocol/pushchain-ui-kit';
import { FC } from 'react';
import {
  IconProps,
  EthereumMonotone,
  PolygonMonotone,
  BnbMonotone,
  ArbitrumMonotone,
  OptimismMonotone,
  SolanaMonotone,
  PushMonotone,
} from 'shared-components';
import { RumorType } from './common.types';

export function trimAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function formatTimestamp(
  timestamp: string,
  showAgo: boolean = false
): string {
  const date = new Date(parseInt(timestamp, 10));
  const now = new Date();

  if (isNaN(date.getTime())) {
    return 'Invalid Date';
  }

  const timeDiff = now.getTime() - date.getTime();
  const seconds = Math.floor(timeDiff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  let agoText = '';
  if (showAgo) {
    if (seconds < 60) {
      agoText = `(${seconds} seconds ago)`;
    } else if (minutes < 60) {
      agoText = `(${minutes} minutes ago)`;
    } else if (hours < 24) {
      agoText = `(${hours} hours ago)`;
    } else if (days < 30) {
      agoText = `(${days} days ago)`;
    } else if (months < 12) {
      agoText = `(${months} months ago)`;
    } else {
      agoText = `(${years} years ago)`;
    }
  }

  if (
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear()
  ) {
    return (
      date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      }) + (showAgo ? ` ${agoText}` : '')
    );
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear()
  ) {
    return 'Yesterday' + (showAgo ? ` ${agoText}` : '');
  }

  if (date.getFullYear() === now.getFullYear()) {
    return (
      date.toLocaleDateString('en-US', {
        month: 'short',
        day: '2-digit',
      }) + (showAgo ? ` ${agoText}` : '')
    );
  }

  return (
    date.toLocaleDateString('en-US', {
      month: 'short',
      day: '2-digit',
      year: 'numeric',
    }) + (showAgo ? ` ${agoText}` : '')
  );
}

export const extractWalletAddress = (address: string) => {
  if (address.includes(':')) {
    const parts = address.split(':');
    return parts[parts.length - 1];
  }
  return address;
};

export const getChainFromCAIP = (caip: string) => {
  const chainId = caip.split(':')[1];
  if (chainId === '1') return 'eth';
  if (chainId === '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp') return 'sol';
  return 'push';
};

export const getInCAIP = (address: string, chain: string) => {
  return `${
    chain === 'eth'
      ? 'eip155:1'
      : chain === 'sol'
      ? 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
      : chain === 'bnb'
      ? 'eip155:56'
      : 'push:devnet'
  }:${address}`;
};

export const convertCaipToObject = (
  addressinCAIP: string
): {
  result: {
    chainId: string | null;
    chain: string | null;
    address: string | null;
  };
} => {
  // Check if the input is a valid non-empty string
  if (!addressinCAIP || typeof addressinCAIP !== 'string') {
    return {
      result: {
        chain: null,
        chainId: null,
        address: null,
      },
    };
  }

  const addressComponent = addressinCAIP.split(':');

  // Handle cases where there are exactly three components (chain, chainId, address)
  if (addressComponent.length === 3) {
    return {
      result: {
        chain: addressComponent[0],
        chainId: addressComponent[1],
        address: addressComponent[2],
      },
    };
  }
  // Handle cases where there are exactly two components (chain, address)
  else if (addressComponent.length === 2) {
    return {
      result: {
        chain: addressComponent[0],
        chainId: null,
        address: addressComponent[1],
      },
    };
  }
  // If the input doesn't match the expected format, return the address only
  else {
    return {
      result: {
        chain: null,
        chainId: null,
        address: addressinCAIP,
      },
    };
  }
};

export const markdownToPlainText = (markdown: string) => {
  return markdown
    .replace(/\*\*(.*?)\*\*/g, '$1') // Bold (**text**)
    .replace(/_(.*?)_/g, '$1') // Italic (_text_)
    .replace(/~~(.*?)~~/g, '$1') // Strikethrough (~~text~~)
    .replace(/>\s(.*?)(\r\n|\r|\n)?/g, '$1') // Blockquote (> text)
    .replace(/\[(.*?)\]\(.*?\)/g, '$1'); // Links ([text](url))
};

export const CHAIN_LOGO: {
  [x: number | string]: FC<IconProps>;
} = {
  1: EthereumMonotone,
  11155111: EthereumMonotone,
  137: PolygonMonotone,
  80002: PolygonMonotone,
  97: BnbMonotone,
  56: BnbMonotone,
  42161: ArbitrumMonotone,
  421614: ArbitrumMonotone,
  11155420: OptimismMonotone,
  10: OptimismMonotone,
  2442: PolygonMonotone,
  1101: PolygonMonotone,
  '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp': SolanaMonotone, //mainnet
  '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z': SolanaMonotone, //testnet
  EtWTRABZaYq6iMfeYKouRu166VU2xqa1: SolanaMonotone, //devnet
  devnet: PushMonotone,
};

export const getFullCaipAddress = (universalAddress: UniversalAddress) => {
  const { chain, chainId, address } = universalAddress;

  if (chain && chainId) {
    return `${chain}:${chainId}:${address}`;
  }
  if (chain) {
    return `${chain}:${address}`;
  }
  return address;
};

export const RPC_URL = (!process.env.NODE_ENV || process.env.NODE_ENV === 'development')
  ? 'https://eth-sepolia.g.alchemy.com/v2/skgdTbmOr9TCA8QTNb4y1PFfDW1iPn8y'
  : 'https://sepolia.infura.io/v3/4e4c307950b3459ab22a024f7304156c';


export const easterRumor: RumorType = (
  {
    address: 'eip155:1:0xFaE3594C68EDFc2A61b7527164BDAe80bC302108',
    post: '',
    isVisible: true,
    timestamp: '1744941195950',
    markdownPost: `**PUSH CHAIN EASTER HUNT is LIVE!!🕵️‍♂️✨**

A few eggs have slipped into the **Push Chain** universe 🌌 — hidden across blogs, docs, and pages that define what we're building. Can you find them?

Follow the riddles, uncover the eggs, and win big from a portion of **1,000,000** **Push Points!**

💠 There are **9 riddles**.

💠 Each riddle leads to **1 hidden egg**.

💠 Each egg reveals **one letter** from the word: **PUSHCHAIN** 

💠 Crack all 9 to complete the chain and win big!

🔔 **Winners will be announced after the hunt ends on 23rd April**

Let the hunt begin, anon — and may your Easter be _egg-stra_ rewarding! 🥚

Hoppy Easter!

---

🔍 **How to Play:**

**1.** **Register to [Devnet Drop Points Program S2](https://portal.push.org/rewards) to become eligible**

**2.** Solve the riddles shared below — each one leads to a hidden Easter egg somewhere across **[push.org](https://push.org/).**

**3.** Once you find an egg, **take a screenshot📸** showing the egg's location.

**4.** 📧 Email the screenshot to **[0x24b46FDC49210ca5466A14f48ea0428557B2fbAA]** with the subject line: **_Easter Egg Hunt - [Your Wallet Address]_** **using [AnyChain Email](https://email.push.org)!**

**5.** **Top 100 correct entries will receive a solid 10,000 Push Points drop!🤑**

---
---

**HERE ARE THE RIDDLES👇**


**1️⃣** **_One Spider-Man? Two? Are they both the same?👀
Is Push Chain just another L1? Nope — that's not its game🤭_**

---

**2️⃣** **_Extra Slice of the Reward 🍰
Refer a friend, earn your slice.
20 and 5 — numbers that sound real nice. 🥚_**

---

**3️⃣** _**Universal  DeFi?  Any chain Socials? Any chain NFTs in flight?
The egg hides where *use cases* shine bright☀️**_

---

**4️⃣** **_What, Why's, and How's Push Chain ??  — many web3 curious ask🤔.
The answer lies in one common page where answers to all questions are unmasked.**

---

**5️⃣** **_Class is in Session📚
New to Push and don't know where to begin?
Start at 101 — that's where the clues kick in._**

---

**6️⃣** **_No User Left Behind
From socials to sign-ins, EVMs to mail,
The Developer Docs reveal a lot about._**

---

**7️⃣** **_⚒️ Want to build your own cross-chain email?
👩‍🍳 The legendary Push docs hold the recipe,
🧙For sending mail across chains with some epic Push Chain SDK sorcery._**

---

**8️⃣** **_🪄Want to know the Math Behind the Magic?
How is the Push Chain token being forged?
One page holds the secrets — utility, supply, airdrops, and the allocation lore._**

---

**9️⃣** **_The Loyal Shall Be Rewarded🫡
In Discord's halls, where updates flow,
The egg awaits for those who know. 🥚_**

---
---

**HAPPY EASTER - GOOD LUCK🤞**`,
    txnHash: '87681871029479faf68b604bf543064352d902a572c874c144443f2993eabf25',
    upvoteWallets: [],
    downvoteWallets: [],
  }
)