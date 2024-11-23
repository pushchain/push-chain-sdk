import { useQuery } from '@tanstack/react-query';
import React, { useState } from 'react';
import { privateKeyToAccount } from 'viem/accounts';
import { Crypto } from '../crypto.ts';
import { usePushContext } from '../hooks/usePushContext.tsx';
import { useSocialContext } from '../hooks/useSocialContext.tsx';
import { SignPayloadPost } from '../types';

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
  const { socialSDK, connectedAddress, pushSigner } = usePushContext();
  const { loggedInProfile } = useSocialContext();

  async function handleSubmitPost(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const formData = new FormData(event.target as HTMLFormElement);
    const message = formData.get('message')?.toString();
    if (!message || !socialSDK || !loggedInProfile || !connectedAddress || !pushSigner) return;
    // Sign Payload
    const account = privateKeyToAccount(loggedInProfile.decryptedProfilePrivateKey);
    const post: SignPayloadPost = {
      from: connectedAddress,
      message,
      timestamp: Date.now(),
      messageType: 'text'
    };
    const signaturePayload = Crypto.getSignPayloadPost(post);
    const signature = await account.signMessage({ message: { raw: signaturePayload } });
    await socialSDK.postMessage({ ...post, signature }, pushSigner);
  }

  function Modal() {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50">
        <div className="relative bg-white shadow-xl rounded p-4 w-96 flex flex-col items-end">
          <button
            className="text-gray-500 hover:text-gray-700 text-xl"
            onClick={() => setOpenModal(false)}
          >
            &times;
          </button>
          <form onSubmit={handleSubmitPost} className="w-full">
          <textarea
            id="message"
            name="message"
            placeholder="What are you thinking?"
            rows={3}
            maxLength={140}
            required
            title="Post should have less than 140 characters"
            className="w-full p-2 border border-gray-300 rounded mb-4"
          ></textarea>
            <button
              type="submit"
              className="bg-blue-500 text-white p-2 rounded hover:bg-blue-700 w-full"
            >
              Send
            </button>
          </form>
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
