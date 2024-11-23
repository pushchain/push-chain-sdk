import { useEffect } from 'react';
import { useGetProfile } from '../hooks/useGetProfile.tsx';
import { usePushContext } from '../hooks/usePushContext.tsx';
import { CreateProfile } from './create-profile.tsx';
import { Feed } from './feed.tsx';

export function LoggedIn() {
  const { connectedAddress, socialSDK, pushSigner } = usePushContext();

  const { data: profile, isLoading } = useGetProfile(connectedAddress, socialSDK);

  useEffect(() => {
    (async () => {
      if (profile && pushSigner) {
        // TODO: Verify signature
        // const validProfile = await pushSigner.verifySignature(profile.owner, Crypto.getSignPayloadProfile(profile), toBytes(profile.signature));
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
