import { useQuery } from '@tanstack/react-query';
import { Social } from '../services/social.ts';

export function useGetProfile(connectedAddress: string | null, socialSDK: Social | null) {
  return useQuery({
    queryKey: ['profile'],
    queryFn: async () => socialSDK?.getProfile(connectedAddress!),
    enabled: !!connectedAddress && !!socialSDK
  });
}