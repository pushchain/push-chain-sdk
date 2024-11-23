import { useQuery } from '@tanstack/react-query';
import { usePushContext } from '../hooks/usePushContext.tsx';
import { MakePost } from './make-post.tsx';

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

  if (!isLoadingPosts && (!posts || posts?.length === 0)) return (
    <div className="flex flex-col">
      <h3>There are no posts to be shown</h3>
      <MakePost/>
    </div>
  );

  return <>
    {posts && (
      posts?.map(p => <div>{p.from}</div>)
    )}
    <MakePost/>
  </>;
}

