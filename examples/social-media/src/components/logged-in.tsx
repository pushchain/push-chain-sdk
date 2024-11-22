import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { usePushContext } from '../usePushContext.tsx';
import { CreateProfile } from './create-profile.tsx';
import { Feed } from './feed.tsx';

export function LoggedIn() {
  const { connectedAddress, socialSDK, pushSigner } = usePushContext();

  const { data: profile, isLoading } = useQuery({
    queryKey: ['profile'],
    queryFn: async () => socialSDK?.getProfile(connectedAddress!),
    enabled: !!connectedAddress && !!socialSDK
  });

  useEffect(() => {
    (async () => {
      if (profile && pushSigner) {
        // TODO: Verify signature
        // const validProfile = await pushSigner.verifySignature(profile.owner, Crypto.getSignPayload(profile), toBytes(profile.signature));
      }
    })();
  }, [profile, pushSigner]);

  return (
    <div className="flex flex-col w-full justify-center items-center">
      {isLoading && <div className={'text-center'}>Fetching your profile...</div>}
      {!profile && !isLoading &&
        <div>
          <CreateProfile/>
        </div>
      }
      {profile &&
        <div className="flex flex-col items-center">
          <h1>Welcome: {profile.handle}!</h1>
          <h2>Bio: {profile.bio}</h2>
          <Feed/>
        </div>
      }
    </div>
  );
}
