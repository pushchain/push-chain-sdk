import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
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

  if (!isLoadingPosts && (!posts || posts?.length === 0)) return (
    <div className="flex flex-col">
      <h3>There are no posts to be shown</h3>
      <MakePost/>
    </div>
  );

  return <>
    posts && (
    {posts?.map(p => <div>{p.from}</div>)}
    )
  </>;
}

function MakePost() {
  const [openModal, setOpenModal] = useState(false);

  function Modal() {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50">
        <div className="relative bg-white shadow-xl rounded p-4 w-96 flex flex-col items-end">
          <button
            className="bg-yellow-50 text-gray-500 hover:text-gray-700 text-xl"
            onClick={() => setOpenModal(false)}
          >
            &times;
          </button>
          <textarea
            placeholder="What are you thinking?"
            rows={3}
            className="w-full p-2 border border-gray-300 rounded mb-4"
          ></textarea>
          <button
            type="submit"
            className="bg-blue-500 text-white p-2 rounded hover:bg-blue-700 w-full"
          >
            Send
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <button
        className="bg-blue-500 p-2 text-white text-xl rounded hover:bg-blue-700"
        onClick={() => setOpenModal(!openModal)}
      >
        Create post
      </button>
      {openModal && <Modal/>}
    </>
  );
}
