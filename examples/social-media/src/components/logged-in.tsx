import { useQuery } from '@tanstack/react-query';
import { usePushContext } from '../usePushContext.tsx';

export function LoggedIn() {
  const { connectedAddress, socialSDK } = usePushContext();

  const { data: profile, isLoading } = useQuery({
    queryKey: ['profile'],
    queryFn: async () => socialSDK?.getProfile(connectedAddress!),
    enabled: !!connectedAddress && !!socialSDK
  });

  return (<>
    <div>Hello {connectedAddress}</div>
    {isLoading && <div>Fetching your profile...</div>}
    {profile && <div>Here is your profile data: {JSON.stringify(profile)}</div>}
    {!profile && !isLoading && <div>We didn't find your profile information :/</div>}
  </>);
}
