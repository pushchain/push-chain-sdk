import { getFullCaipAddress, RewardsResponseData } from '@/common';
import { UniversalAddress } from '@pushprotocol/pushchain-ui-kit';
import axios from 'axios';

const baseUrl = 'https://us-east1-push-dev-apps.cloudfunctions.net/helloWorld';

const checkAndUpdateActivity = async (universalAddress: UniversalAddress) => {
  const account = getFullCaipAddress(universalAddress);
  axios({
    method: 'GET',
    url: `${baseUrl}/v2/user-app-xp/user/${account}/recent-activities`,
    params: { types: 'rumors_open_app' },
  }).then((res) => {
    const activity = (res.data as RewardsResponseData).activities
      .rumors_open_app;

    if (activity && !Object.keys(activity).length) {
      axios({
        method: 'POST',
        url: `${baseUrl}/v2/user-app-xp/user/${account}/activity/rumors_open_app`,
        data: {
          data: {},
          verificationProof: 'abc',
        },
      });
    }
  });
};

const checkAndUpdateVoteActivity = async (
  universalAddress: UniversalAddress,
  type: 'upvote' | 'downvote',
  txnHash: string
) => {
  const account = getFullCaipAddress(universalAddress);
  axios({
    method: 'GET',
    url: `${baseUrl}/v2/user-app-xp/user/${account}/recent-activities`,
    params: { types: ['rumors_upvote', 'rumors_downvote'].join(',') },
  }).then((res) => {
    const upvoteActivity = (res.data as RewardsResponseData).activities
      .rumors_upvote;
    const upvotedRumors = (upvoteActivity?.data?.txnHash as string[]) || [];
    const downvoteActivity = (res.data as RewardsResponseData).activities
      .rumors_downvote;
    const downvotedRumors = (downvoteActivity?.data?.txnHash as string[]) || [];

    if (
      upvoteActivity &&
      (!Object.keys(upvoteActivity).length ||
        !upvotedRumors.includes(txnHash)) &&
      downvoteActivity &&
      (!Object.keys(downvoteActivity).length ||
        !downvotedRumors.includes(txnHash))
    ) {
      axios({
        method: 'POST',
        url: `${baseUrl}/v2/user-app-xp/user/${account}/activity/${
          type === 'upvote' ? 'rumors_upvote' : 'rumors_downvote'
        }`,
        data: {
          data: {
            txnHash: [
              txnHash,
              ...(type === 'upvote' ? upvotedRumors : downvotedRumors),
            ],
            latestTxnHash: txnHash,
          },
          verificationProof: 'abc',
        },
      });
    }
  });
};

export { checkAndUpdateActivity, checkAndUpdateVoteActivity };
