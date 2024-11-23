import { ReactNode, useEffect, useState } from 'react';
import { Crypto } from '../crypto.ts';
import { SocialContext } from '../context/social-context.tsx';
import { useGetProfile } from '../hooks/useGetProfile.tsx';
import { usePushContext } from '../hooks/usePushContext.tsx';
import { LoggedInProfile } from '../types';

export function SocialProvider({ children }: { children: ReactNode }) {
  const [loggedInProfile, setLoggedInProfile] = useState<LoggedInProfile | null>(null);
  const { connectedAddress, socialSDK, pushSigner } = usePushContext();

  const { data: profile } = useGetProfile(connectedAddress, socialSDK);

  /**
   * When the user refreshes the page, we have to decrypt the user profile private key
   */
  useEffect(() => {
    (async () => {
      if (profile && !loggedInProfile) {
        if (!pushSigner) return;
        const decryptedProfilePrivateKey = await new Crypto(pushSigner).decrypt(profile.encryptedProfilePrivateKey);
        setLoggedInProfile({ ...profile, decryptedProfilePrivateKey });
      }
    })();
  }, [profile, loggedInProfile]);

  return (
    <SocialContext.Provider
      value={{ loggedInProfile, setLoggedInProfile }}
    >
      {children}
    </SocialContext.Provider>
  );
}
