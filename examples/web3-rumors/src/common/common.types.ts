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

type RewardsResponseData = {
  activities: {
    [key: string]: {
      activityId: string;
      userWallet: string;
      activityTypeId: string;
      appName: string;
      timestamp: string;
      verificationProof: string;
      data: {
        [key: string]: any;
      };
      createdAt: string;
      updatedAt: string;
    };
  };
};

export type { ConfessionType, RumorType, RewardsResponseData };

export { TABS };
