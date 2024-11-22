import { useQuery } from '@tanstack/react-query';
import { usePushContext } from '../usePushContext.tsx';

export function Feed() {
  const { connectedAddress, socialSDK } = usePushContext();

  const { data: posts, isLoading: isLoadingPosts } = useQuery({
    queryKey: ['posts'],
    queryFn: async () => socialSDK?.getFeed(connectedAddress!),
    enabled: !!connectedAddress && !!socialSDK
  });

  if (isLoadingPosts) {
    return (
      <div>
        {isLoadingPosts && <div>Loading posts...</div>}
      </div>
    );
  }

  if (!isLoadingPosts && (!posts || posts?.length === 0)) return <div>There are no posts to be shown</div>;

  return <>
    posts && (
    {posts?.map(p => <div>{p.from}</div>)}
    )
  </>;
}

export function FeedElement() {
  return <div><h3></h3></div>;
}