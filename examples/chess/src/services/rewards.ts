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
    params: { types: 'chess_open_app' },
  }).then((res) => {
    const activity = (res.data as RewardsResponseData).activities
      .chess_open_app;

    if (activity && !Object.keys(activity).length) {
      axios({
        method: 'POST',
        url: `${baseUrl}/v2/user-app-xp/user/${account}/activity/chess_open_app`,
        data: {
          data: {},
          verificationProof: 'abc',
        },
      });
    }
  });
};

export { checkAndUpdateActivity };
