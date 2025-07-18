import { EthereumProvider } from '@walletconnect/ethereum-provider';
import { getAddress } from 'ethers';
import { BaseWalletProvider } from '../BaseWalletProvider';
import { ChainType, ITypedData } from '../../../types/wallet.types';
import * as chains from 'viem/chains';
import { bytesToHex, hexToBytes, parseTransaction, toHex } from 'viem';
import { HexString } from 'ethers/lib.commonjs/utils/data';

export class WalletConnectProvider extends BaseWalletProvider {
  private provider: InstanceType<typeof EthereumProvider> | null = null;

  constructor() {
    super('WalletConnect', 'https://walletconnect.com/walletconnect-logo.svg', [
      ChainType.WALLET_CONNECT,
    ]);
  }

  isInstalled = async (): Promise<boolean> => {
    return true; // WalletConnect doesn't require installation
  };

  getProvider = () => {
    if (!this.provider) {
      throw new Error('WalletConnect provider not initialized');
    }
    return this.provider;
  };

  private async initProvider(chainId: number) {
    console.log('Provder >>', this.provider);

    if (this.provider) {
      return;
    }

    this.provider = await EthereumProvider.init({
      projectId: '575a3e339ad56f54669c32264c133172',
      chains: [chainId],
      methods: ['eth_sendTransaction', 'personal_sign', 'eth_signTypedData_v4', 'eth_requestAccounts', 'eth_chainId', 'eth_accounts'],
      showQrModal: true,
      rpcMap: {
        '11155111': 'https://sepolia.gateway.tenderly.co/',
      },
      optionalChains: [],
    });

    await this.provider.enable();
  }

  async connect(): Promise<{ caipAddress: string }> {
    try {
      const chain = chains['sepolia'] as chains.Chain;
      const chainId = chain.id;

      await this.initProvider(chainId);

      const accounts = (await this.provider!.request({
        method: 'eth_requestAccounts',
      })) as string[];

      if (!accounts || accounts.length === 0) {
        throw new Error('No connected account');
      }

      const rawAddress = accounts[0];
      const checksumAddress = getAddress(rawAddress);

      const caipAddress = this.formatAddress(
        checksumAddress,
        ChainType.ETHEREUM,
        chainId
      );
      return caipAddress;
    } catch (error) {
      console.error('Failed to connect to MetaMask:', error);
      throw error;
    }
  }

  getChainId = async (): Promise<number> => {
    const provider = this.getProvider();
    if (!provider) {
      throw new Error('Provider is undefined');
    }
    const hexChainId = (await provider.request({
      method: 'eth_chainId',
      params: [],
    })) as HexString;

    const chainId = parseInt(hexChainId.toString(), 16);
    return chainId;
  };

  signAndSendTransaction = async (txn: Uint8Array): Promise<Uint8Array> => {
    try {
      const provider = this.getProvider();
      if (!provider) {
        throw new Error('Provider is undefined');
      }
      const accounts = (await provider.request({
        method: 'eth_accounts',
      })) as string[];

      if (!accounts || accounts.length === 0) {
        throw new Error('No connected account');
      }

      const hex = bytesToHex(txn);
      const parsed = parseTransaction(hex);

      const txParams = {
        from: accounts[0],
        to: parsed.to,
        value: parsed.value ? '0x' + parsed.value.toString(16) : undefined,
        data: parsed.data,
        gas: parsed.gas ? '0x' + parsed.gas.toString(16) : undefined,
        maxPriorityFeePerGas: parsed.maxPriorityFeePerGas
          ? '0x' + parsed.maxPriorityFeePerGas.toString(16)
          : undefined,
        maxFeePerGas: parsed.maxFeePerGas
          ? '0x' + parsed.maxFeePerGas.toString(16)
          : undefined,
      };

      const signature = await provider.request({
        method: 'eth_sendTransaction',
        params: [txParams],
      });

      return hexToBytes(signature as `0x${string}`);
    } catch (error) {
      console.error('MetaMask signing error:', error);
      throw error;
    }
  };

  signMessage = async (message: Uint8Array): Promise<Uint8Array> => {
    try {
      const provider = this.getProvider();
      if (!provider) {
        throw new Error('Provider is undefined');
      }
      const accounts = (await provider.request({
        method: 'eth_accounts',
      })) as string[];

      if (!accounts || accounts.length === 0) {
        throw new Error('No connected account');
      }

      const hexMessage = bytesToHex(message);

      const signature = await provider.request({
        method: 'personal_sign',
        params: [hexMessage, accounts[0]],
      });

      return hexToBytes(signature as `0x${string}`);
    } catch (error) {
      console.error('MetaMask signing error:', error);
      throw error;
    }
  };

  signTypedData = async (typedData: ITypedData): Promise<Uint8Array> => {
    try {
      const provider = this.getProvider();
      if (!provider) {
        throw new Error('Provider is undefined');
      }
      const accounts = (await provider.request({
        method: 'eth_accounts',
      })) as string[];

      if (!accounts || accounts.length === 0) {
        throw new Error('No connected account');
      }

      typedData.types = {
        EIP712Domain: [
          { name: 'version', type: 'string' },
          { name: 'chainId', type: 'uint256' },
          { name: 'verifyingContract', type: 'address' },
        ],
        UniversalPayload: typedData.types['UniversalPayload'],
      }

      const signature = await provider.request({
        method: 'eth_signTypedData_v4',
        params: [accounts[0], JSON.stringify(typedData)],
      });

      return hexToBytes(signature as `0x${string}`);
    } catch (error) {
      console.error('MetaMask signing error:', error);
      throw error;
    }
  };

  disconnect = async () => {
    const provider = this.getProvider();
    if (provider && typeof provider.disconnect === 'function') {
      await provider.disconnect();
    }
    this.provider = null;
  };
}
