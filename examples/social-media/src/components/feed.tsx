import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { toast, ToastContainer } from 'react-toastify';
import { usePostMessage } from '../hooks/usePostMessage.tsx';
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

  const sendPost = usePostMessage();

  // TODO: Fix: This is not getting called
  useEffect(() => {
    if (sendPost.isSuccess)
      toast.success('Submitted post');
  }, [sendPost.isSuccess]);

  // TODO: Fix: This is not getting called
  useEffect(() => {
    if (sendPost.isError) {
      toast.error('Error submitting your post, please try again');
    }
  }, [sendPost.isError]);


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
      posts?.map((p, id) => <SinglePost post={p} key={id}/>)
    )}
    <MakePost/>
    <ToastContainer/>
  </>;
}

function SinglePost({ post }: { post: Post }) {
  return (<div className="w-full mt-2 rounded bg-gray-100 shadow p-2">
    <p className="text-xs">from: {post.from.slice(0, 20)}...</p>
    <p className="text-lg">{post.message}</p>
    <p className="text-xs text-right">{convertMillisecondsToDate(post.timestamp)}</p>
  </div>);
}