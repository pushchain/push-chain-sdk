import { useQuery } from '@tanstack/react-query';
import { randomBytes } from 'crypto';
import React from 'react';
import { keccak256, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { Crypto } from '../crypto.ts';
import { usePushContext } from '../usePushContext.tsx';

export function LoggedIn() {
  const { connectedAddress, socialSDK } = usePushContext();

  const { data: profile, isLoading } = useQuery({
    queryKey: ['profile'],
    queryFn: async () => socialSDK?.getProfile(connectedAddress!),
    enabled: !!connectedAddress && !!socialSDK
  });

  return (<div className="flex flex-col w-full justify-center items-center">
    {isLoading && <div className={'text-center'}>Fetching your profile...</div>}
    {profile && <div className={'text-center'}>Here is your profile data: {JSON.stringify(profile)}</div>}
    {!profile && !isLoading && <div>
      <CreateProfile/>
    </div>}
  </div>);
}

function CreateProfile() {
  const { socialSDK, pushSigner } = usePushContext();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); // Prevent the default form submission behavior
    if (!socialSDK) return;
    const formData = new FormData(event.target as HTMLFormElement);

    // Extracting form data
    const handle = formData.get('handle')?.toString();
    const bio = formData.get('bio')?.toString();

    if (!handle || !bio || !pushSigner) return;

    // Generate profile keys
    const privateKey = toHex(new Uint8Array(randomBytes(32)));
    const account = privateKeyToAccount(privateKey);

    const encryptedSecret = await new Crypto(pushSigner).encrypt(privateKey);

    // Sign message
    const hexPayload = toHex(JSON.stringify({ handle, bio, encryptedSecret, account }));
    const hashPayload = keccak256(hexPayload, 'bytes');
    const signature = toHex(await pushSigner.signMessage(hashPayload));

    await socialSDK.createProfile({
      address: account.address,
      encryptedProfilePrivateKey: encryptedSecret,
      bio,
      handle,
      signature,
      signer: pushSigner
    });
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
              Submit
            </button>
          </div>
        </form>
      </div>
    </>
  );
}