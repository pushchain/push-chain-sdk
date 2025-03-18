import { getFullCaipAddress, RewardsResponseData } from '@/common';
import { UniversalAddress } from '@pushprotocol/pushchain-ui-kit';
import axios from 'axios';

const baseUrl =
  'https://us-east1-push-prod-apps.cloudfunctions.net/pushpointsrewardsystem';

const checkAndUpdateActivity = async (universalAddress: UniversalAddress) => {
  const account = getFullCaipAddress(universalAddress);
  axios({
    method: 'GET',
    url: `${baseUrl}/v2/user-app-xp/user/${account}/recent-activities`,
    params: { types: 'email_open_app' },
  }).then((res) => {
    const activity = (res.data as RewardsResponseData).activities
      .email_open_app;

    if (activity && !Object.keys(activity).length) {
      axios({
        method: 'POST',
        url: `${baseUrl}/v2/user-app-xp/user/${account}/activity/email_open_app`,
        data: {
          data: {},
          verificationProof: 'abc',
        },
      });
    }
  });
};

const checkAndUpdateReceiveEmailActivity = async (
  universalAddress: UniversalAddress,
  txnHash: string
) => {
  const account = getFullCaipAddress(universalAddress);
  axios({
    method: 'GET',
    url: `${baseUrl}/v2/user-app-xp/user/${account}/recent-activities`,
    params: { types: 'email_view_email' },
  }).then((res) => {
    const activity = (res.data as RewardsResponseData).activities
      .email_view_email;
    const viewedEmails = (activity?.data?.txnHash as string[]) || [];

    if (
      activity &&
      (!Object.keys(activity).length || !viewedEmails.includes(txnHash))
    ) {
      axios({
        method: 'POST',
        url: `${baseUrl}/v2/user-app-xp/user/${account}/activity/email_view_email`,
        data: {
          data: {
            txnHash: [txnHash, ...viewedEmails],
            latestTxnHash: txnHash,
          },
          verificationProof: 'abc',
        },
      });
    }
  });
};

export { checkAndUpdateActivity, checkAndUpdateReceiveEmailActivity };
