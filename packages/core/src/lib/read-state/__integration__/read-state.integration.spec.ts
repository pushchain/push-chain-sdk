/**
 * Live read-state integration — read-only against Donut, no key, no writes.
 * Registered in jest.integration.config.ts; excluded from the unit run.
 *
 *   npx jest --config jest.integration.config.ts src/lib/read-state
 *
 * Fixtures are the reads made on 2026-09-09; they are settled forever, so every
 * assertion here is deterministic.
 */
import { bytesToHex } from 'viem';
import { PUSH_CHAIN_INFO } from '../../constants/chain';
import { CHAIN, PUSH_NETWORK } from '../../constants/enums';
import { WEB2_DESTINATION } from '../../constants/read-state';
import { ReadErrorCode, ReadStatus, UniversalReadStatus } from '../../generated/ucallback/v1';
import { PushClient } from '../../push-client/push-client';
import { ReadHeightUnavailableError } from '../errors';
import { preflightRead } from '../preflight';

const READ2_TX = '0x8329b6134cc622fb58a015e54ec11d5bb38b604f8a3d42e62133fc31047ae732';
const READ2_ID = '0xf3d62fb962c84259e728d184dd2e3199c4d6c39790e20d60f2bacf0c10eca168';
const READ1_ID = '0xeba3eb9efad8c867bd19a66d925b5febae02efb5151faaf20d9fa8ea799c0d71';
const READ3_TX = '0x0293d57e606d6fec8ce6364cad82a0c74b517aaaf294107b5a6e43fcc25e7ee9'; // UEA-originated
const EXPIRED_ID = '0x4a6e27e003a8801f7f5dffff3beb8af6836b9e68a99c94bbb22dc95b180857a9';

describe('read-state integration (Donut, read-only)', () => {
  let client: PushClient;
  beforeAll(() => {
    client = new PushClient({
      rpcUrls: PUSH_CHAIN_INFO[CHAIN.PUSH_TESTNET].defaultRPC,
      network: PUSH_NETWORK.TESTNET_DONUT,
    });
  });

  describe('PushClient.getReadsByTx / getUniversalRead', () => {
    it('finds the SUCCESS read by the tx hash that requested it', async () => {
      const { reads } = await client.getReadsByTx(READ2_TX);
      expect(reads).toHaveLength(1);
      const r = reads[0];
      expect(r.id).toBe(READ2_ID);
      expect(r.status).toBe(UniversalReadStatus.UNIVERSAL_READ_STATUS_FULFILLED);
      expect(r.result?.status).toBe(ReadStatus.READ_STATUS_SUCCESS);
      expect(bytesToHex(r.result?.resultData ?? new Uint8Array())).toBe(
        '0x000000000000000000000000000000000000000000000092b406e140cc2c8871',
      );
      expect(r.request?.destinationChain).toBe('eip155:11155111');
      expect(r.pcTx).toHaveLength(2);
    });

    it('is case-insensitive on the hash and finds the UEA-originated read by the SDK tx hash', async () => {
      const { reads } = await client.getReadsByTx(READ3_TX.toUpperCase().replace('0X', '0x'));
      expect(reads).toHaveLength(1);
      expect(reads[0].request?.revertRecipient.toLowerCase()).toBe('0x5c70c864cf1adfb04a0e107ffa248ba3600eab8d');
    });

    it('returns the ERROR read with its error code and empty result bytes', async () => {
      const { read } = await client.getUniversalRead(READ1_ID);
      expect(read?.status).toBe(UniversalReadStatus.UNIVERSAL_READ_STATUS_FULFILLED);
      expect(read?.result?.status).toBe(ReadStatus.READ_STATUS_ERROR);
      expect(read?.result?.errorCode).toBe(ReadErrorCode.READ_ERROR_INVALID_QUERY);
      expect(read?.result?.resultData.length).toBe(0);
    });

    it('returns the EXPIRED read with its single sweeper pc_tx', async () => {
      const { read } = await client.getUniversalRead(EXPIRED_ID);
      expect(read?.status).toBe(UniversalReadStatus.UNIVERSAL_READ_STATUS_EXPIRED);
      expect(read?.expiryAttempts).toBe(1);
      expect(read?.pcTx).toHaveLength(1);
    });

    it('unknown hash / id → empty, no throw', async () => {
      const zero = '0x' + '0'.repeat(64);
      expect((await client.getReadsByTx(zero)).reads).toEqual([]);
      expect((await client.getUniversalRead(zero)).read).toBeUndefined();
    });
  });

  describe('preflightRead', () => {
    const deps = () => ({ pushClient: client, pushNetwork: PUSH_NETWORK.TESTNET_DONUT });

    it('Sepolia: oracle height populated, fee 0 today, Push head and gas price live', async () => {
      const pf = await preflightRead(deps(), { chain: CHAIN.ETHEREUM_SEPOLIA });
      expect(pf.observedChainHeight).toBeGreaterThan(11_000_000n);
      expect(pf.protocolFee).toBe(0n);
      expect(pf.pushBlockNumber).toBeGreaterThan(22_000_000n);
      expect(pf.pushGasPrice).toBeGreaterThan(0n);
      expect(pf.universalCore.toLowerCase()).toBe('0x00000000000000000000000000000000000000c0');
      expect(pf.universalCallback.toLowerCase()).toBe('0x00000000000000000000000000000000000000c2');
    });

    it('Solana devnet: oracle slot populated', async () => {
      const pf = await preflightRead(deps(), { chain: CHAIN.SOLANA_DEVNET });
      expect(pf.observedChainHeight).toBeGreaterThan(400_000_000n);
      expect(pf.destination.namespace).toBe('solana');
    });

    it('web2: heightless, does not throw', async () => {
      const pf = await preflightRead(deps(), WEB2_DESTINATION);
      expect(pf.observedChainHeight).toBe(0n);
    });

    it('an unconfigured chain (Ethereum mainnet) is unreadable', async () => {
      await expect(preflightRead(deps(), { chain: CHAIN.ETHEREUM_MAINNET })).rejects.toBeInstanceOf(ReadHeightUnavailableError);
    });
  });
});
