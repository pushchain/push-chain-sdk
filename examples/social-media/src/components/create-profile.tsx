import { randomBytes } from 'crypto';
import React, { useState } from 'react';
import { toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { Crypto } from '../crypto.ts';
import { usePushContext } from '../hooks/usePushContext.tsx';
import { useSocialContext } from '../hooks/useSocialContext.tsx';

export function CreateProfile() {
  const { socialSDK, pushSigner, connectedAddress } = usePushContext();
  const { setLoggedInProfile } = useSocialContext();
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    try {
      event.preventDefault(); // Prevent the default form submission behavior
      setLoading(true);
      if (!socialSDK || !connectedAddress) return;
      const formData = new FormData(event.target as HTMLFormElement);

      // Extracting form data
      const handle = formData.get('handle')?.toString();
      const bio = formData.get('bio')?.toString();

      if (!handle || !bio || !pushSigner) return;

      // Generate profile keys
      const privateKey = toHex(new Uint8Array(randomBytes(32)));
      const account = privateKeyToAccount(privateKey);

      const encryptedProfilePrivateKey = await new Crypto(pushSigner).encrypt(privateKey);

      // Sign message
      const signPayload = Crypto.getSignPayloadProfile({
        owner: connectedAddress,
        handle,
        bio,
        encryptedProfilePrivateKey,
        address: account.address
      });
      const signature = toHex(await pushSigner.signMessage(signPayload));

      const profile = {
        owner: connectedAddress,
        address: account.address,
        encryptedProfilePrivateKey,
        bio,
        handle,
        signature,
        signer: pushSigner
      };

      await socialSDK.createProfile(profile);
      setLoggedInProfile({ ...profile, decryptedProfilePrivateKey: privateKey });
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className={'text-center'}>We didn't find your profile information</div>
      <div className="text-center">But don't worry, let's create your profile</div>
      <div className="bg-white shadow-md rounded-lg p-8 w-full max-w-md">
        <h1 className="text-2xl font-bold mb-6 text-gray-700 text-center">Create Profile</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="handle" className="block text-sm font-medium text-gray-700">Handle</label>
            <input
              type="text"
              id="handle"
              name="handle"
              placeholder="Enter your handle"
              pattern="^[^\s]+\.push$"
              minLength={8}
              title="Handle must end with '.push' and can't contain white spaces"
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              required
            />
          </div>

          <div>
            <label htmlFor="bio" className="block text-sm font-medium text-gray-700">Bio</label>
            <textarea
              id="bio"
              name="bio"
              placeholder="Tell us about yourself"
              minLength={20}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              rows={3}
              required
            ></textarea>
          </div>

          <div>
            <button
              type="submit"
              className="w-full bg-blue-600 text-white py-2 px-4 rounded-md shadow hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              {loading ? 'Loading...' : 'Submit'}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}