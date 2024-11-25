import { useQuery } from '@tanstack/react-query';
import { usePushContext } from '../hooks/usePushContext.tsx';

export function FriendList() {
  const { connectedAddress, socialSDK } = usePushContext();

  const query = useQuery({
    queryKey: ['friends', connectedAddress],
    queryFn: () => socialSDK?.getFriends(connectedAddress!),
    enabled: !!connectedAddress && !!socialSDK
  });

  if (query.isPending) return <div>Fetching your friends list...</div>;

  if (!query.data || !query.data.iFollow || query.data.iFollow.length === 0) return <div>You have no friends</div>;

  else {
    return <div>
      <h2>Your friends</h2>
      {query.data.iFollow.map((address, key) => {
        return <div key={key}><p className="text-xs my-2">{address}</p></div>;
      })}
    </div>;
  }
}