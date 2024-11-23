import { useQuery } from '@tanstack/react-query';
import { usePushContext } from '../hooks/usePushContext.tsx';
import { Post } from '../types';
import { convertMillisecondsToDate } from '../utils/convert-date.ts';
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
      posts?.map(p => <SinglePost post={p}/>)
    )}
    <MakePost/>
  </>;
}

function SinglePost({ post }: { post: Post }) {
  return (<div className="w-full mt-2 rounded bg-gray-100 shadow p-2">
    <p className="text-xs">from: {post.from.slice(0, 20)}...</p>
    <p className="text-lg">{post.message}</p>
    <p className="text-xs text-right">{convertMillisecondsToDate(post.timestamp)}</p>
  </div>);
}