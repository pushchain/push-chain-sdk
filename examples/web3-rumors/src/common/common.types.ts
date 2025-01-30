enum TABS {
  LATEST = 'latest-rumors',
  MY_RUMORS = 'my-rumors',
}

type ConfessionType = {
  post: string;
  address: string;
  isVisible: boolean;
  timestamp: string;
};

type RumorType = ConfessionType & {
  markdownPost: string;
  txnHash: string;
  upvoteWallets: string[];
  downvoteWallets: string[];
};

export type { ConfessionType, RumorType };

export { TABS };
