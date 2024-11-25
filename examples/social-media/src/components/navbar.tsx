import { usePrivy } from '@privy-io/react-auth';
import { privateKeyToAccount } from 'viem/accounts';
import { Crypto } from '../crypto.ts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'react-toastify';
import { usePushContext } from '../hooks/usePushContext.tsx';
import { useSocialContext } from '../hooks/useSocialContext.tsx';
import { SignPayloadFriend } from '../types';

/**
 * Navbar only shows when user authenticated, so no need to check if user has connected
 */
export function Navbar() {
  const [friendsAddress, setFriendsAddress] = useState('');
  const { logout } = usePrivy();
  const { connectedAddress, socialSDK, pushSigner } = usePushContext();
  const { loggedInProfile } = useSocialContext();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['friends', connectedAddress],
    queryFn: () => socialSDK?.getFriends(connectedAddress!),
    enabled: !!connectedAddress && !!socialSDK
  });

  const sendFollowRequest = useMutation({
    mutationFn: async (address: string) => {
      if (!connectedAddress || !loggedInProfile || !pushSigner) throw new Error('Missing required data'); // This will trigger onError

      const followRequest: SignPayloadFriend = {
        from: connectedAddress,
        to: address
      };
      const account = privateKeyToAccount(loggedInProfile.decryptedProfilePrivateKey);
      const signPayload = Crypto.getSignPayloadFriendRequest(followRequest);
      const signature = await account.signMessage({ message: { raw: signPayload } });
      await socialSDK?.follow({ ...followRequest, signature }, pushSigner);
    },
    onSuccess: () => {
      toast.success('Added your friend');
      setFriendsAddress('');
      return queryClient.invalidateQueries({ queryKey: ['friends', connectedAddress] });
    },
    onError: () => toast.error('Error adding your friend, please try again')
  });

  async function addFriendHandler() {
    if (!friendsAddress.startsWith('solana:') && !friendsAddress.startsWith('eip155:')) {
      toast.error('Address should be in CAIP10 format');
      return;
    }
    if (!query.data?.iFollow.includes(friendsAddress)) {
      await sendFollowRequest.mutateAsync(friendsAddress);
    } else {
      toast.success('You are friends already :)');
    }
  }

  return (
    <div className="w-full mt-2 flex justify-end pr-2 items-center gap-2">
      <input className="bg-gray-200 rounded w-1/3 border border-gray-300 shadow py-1 px-2 hover:bg-gray-300"
             placeholder={'Add your friends :)'}
             value={friendsAddress}
             onChange={e => setFriendsAddress(e.target.value)}
      />
      <button className="bg-blue-500 px-2 py-1 rounded text-white hover:bg-blue-700"
              onClick={addFriendHandler}
              disabled={!query.isSuccess || sendFollowRequest.isPending}
      >{sendFollowRequest.isPending ? 'Sending request...' : 'Add'}
      </button>
      <div className="ml-2">Welcome {`${connectedAddress!.slice(0, 15)}...${connectedAddress!.slice(-6)}`}</div>
      <button
        className="bg-red-500 hover:bg-red-700 text-white p-2 rounded font-bold"
        onClick={logout}
      >
        Logout
      </button>
    </div>
  );
}
