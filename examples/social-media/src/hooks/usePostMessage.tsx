import { useMutation, useQueryClient } from '@tanstack/react-query';
import { privateKeyToAccount } from 'viem/accounts';
import { Crypto } from '../crypto.ts';
import { SignPayloadPost } from '../types';
import { usePushContext } from './usePushContext.tsx';
import { useSocialContext } from './useSocialContext.tsx';

export function usePostMessage() {
  const { socialSDK, connectedAddress, pushSigner } = usePushContext();
  const { loggedInProfile } = useSocialContext();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (message: string) => {
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
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['posts'] }),
    onError: (error) => {
      console.error(error);
    }
  });
}