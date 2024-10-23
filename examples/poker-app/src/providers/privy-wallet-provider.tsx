import { PrivyProvider } from '@privy-io/react-auth';
import { toSolanaWalletConnectors } from '@privy-io/react-auth/solana';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createConfig } from '@privy-io/wagmi';
import { mainnet } from 'viem/chains';
import { http } from 'wagmi';
import { WagmiProvider } from '@privy-io/wagmi';

const solanaConnectors = toSolanaWalletConnectors({
  shouldAutoConnect: false,
});

const config = createConfig({
  chains: [mainnet as any],
  transports: {
    [mainnet.id]: http(),
  },
});

export default function PrivyWalletProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const queryClient = new QueryClient();
  return (
    <PrivyProvider
      config={{
        appearance: {
          walletChainType: 'ethereum-and-solana',
        },
        externalWallets: {
          solana: {
            connectors: solanaConnectors,
          },
        },
      }}
      appId={'cm2a8x8r706xdbix5gm9z24f7'}
    >
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={config}>{children}</WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
