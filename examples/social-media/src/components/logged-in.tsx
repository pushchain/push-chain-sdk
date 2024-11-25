import { useEffect } from 'react';
import { Slide, toast, ToastContainer } from 'react-toastify';
import { useGetProfile } from '../hooks/useGetProfile.tsx';
import { usePushContext } from '../hooks/usePushContext.tsx';
import { useSocialContext } from '../hooks/useSocialContext.tsx';
import { CreateProfile } from './create-profile.tsx';
import { Feed } from './feed.tsx';
import { FriendList } from './friend-list.tsx';

export function LoggedIn() {
  const { connectedAddress, socialSDK, pushSigner } = usePushContext();
  const { data: profile, isLoading } = useGetProfile(connectedAddress, socialSDK);
  const { showSignToaster, showErrorToaster } = useSocialContext();

  useEffect(() => {
    (async () => {
      if (profile && pushSigner) {
        // TODO: Verify signature
        // const validProfile = await pushSigner.verifySignature(profile.owner, Crypto.getSignPayloadProfile(profile), toBytes(profile.signature));
      }
    })();
  }, [profile, pushSigner]);

  useEffect(() => {
    if (showSignToaster) {
      toast.info(
        <div className="flex items-center gap-4">
          {/* Tailwind spinner */}
          <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-blue-500"></div>
          <span>Please sign message on your wallet</span>
        </div>,
        {
          autoClose: false, // Keeps the toast open until manually closed
          closeOnClick: false,
          draggable: false,
          className: 'custom-toast',
          transition: Slide
        }
      );
    }
  }, [showSignToaster]);

  useEffect(() => {
    if (showErrorToaster) {
      toast.error('Error when signing message. Please reload the page.');
    }
  }, [showErrorToaster]);

  return (
    <div className="flex flex-col w-full justify-center items-center">
      <ToastContainer/>
      {isLoading && <div className={'text-center'}>Fetching your profile...</div>}
      {!profile && !isLoading &&
        <div>
          <CreateProfile/>
        </div>
      }
      {profile &&
        <div className="flex flex-col items-center w-full">
          <h1>Welcome: {profile.handle}!</h1>
          <h2>Bio: {profile.bio}</h2>
          <div className="flex flex-row w-full justify-center p-3">
            <div className="w-1/3">
              <FriendList/>
            </div>
            <div className="w-2/3 max-w-4xl">
              <Feed/>
            </div>
          </div>
        </div>
      }
    </div>
  );
}
