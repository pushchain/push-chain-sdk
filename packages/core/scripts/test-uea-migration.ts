/**
 * Manual test: UEA Migration via MsgMigrateUEA
 *
 * Signs MigrationPayload using EIP-712 signTypedData, sends MsgMigrateUEA,
 * then verifies payload execution still works.
 *
 * Usage:
 *   EVM_PRIVATE_KEY=0x... npx ts-node packages/core/scripts/test-uea-migration.ts
 */
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { createWalletClient, http, Hex, bytesToHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { PushChain } from '../src';
import { PUSH_NETWORK, CHAIN } from '../src/lib/constants/enums';
import { CHAIN_INFO, VM_NAMESPACE } from '../src/lib/constants/chain';
import { PushClient } from '../src/lib/push-client/push-client';

const originChain = CHAIN.ETHEREUM_SEPOLIA;
const pushNetwork = PUSH_NETWORK.TESTNET_DONUT;

// UEAMigration contract address (deployed by Nilesh)
const UEA_MIGRATION_CONTRACT = '0xaFCaC16b882a490FC71ADabA6D7Ac3cae8C6729d';

async function main() {
  const privateKey = process.env['EVM_PRIVATE_KEY'] as Hex;
  if (!privateKey) throw new Error('Set EVM_PRIVATE_KEY in .env');

  const account = privateKeyToAccount(privateKey);
  console.log('Account:', account.address);

  const walletClient = createWalletClient({
    account,
    transport: http(CHAIN_INFO[originChain].defaultRPC[0]),
  });

  const universalSigner = await PushChain.utils.signer.toUniversalFromKeypair(
    walletClient,
    {
      chain: originChain,
      library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
    }
  );

  console.log('Initializing PushChain...');
  const pushClient = await PushChain.initialize(universalSigner, {
    network: pushNetwork,
    progressHook: (event) => {
      console.log(`  [${event.id}] ${event.title}: ${event.message}`);
    },
  });

  await pushClient.accountStatusReady;
  const ueaAddress = pushClient.universal.account;
  console.log('UEA:', ueaAddress);
  console.log('Account Status:', JSON.stringify(pushClient.accountStatus, null, 2));

  // =========================================================================
  // STEP 1: Send MsgMigrateUEA with EIP-712 signed MigrationPayload
  // =========================================================================
  console.log('\n=== STEP 1: UEA Migration via MsgMigrateUEA ===');

  const { chainId } = CHAIN_INFO[originChain];
  const { vm } = CHAIN_INFO[originChain];

  // Read UEA nonce
  const pushChainRPCs = CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC;
  const directPushClient = new PushClient({
    rpcUrls: pushChainRPCs,
    network: pushNetwork,
  });

  let ueaNonce = BigInt(0);
  try {
    ueaNonce = await directPushClient.readContract<bigint>({
      address: ueaAddress,
      abi: [{ type: 'function', name: 'nonce', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' }] as any,
      functionName: 'nonce',
    });
    console.log('UEA nonce:', ueaNonce.toString());
  } catch {
    console.log('Could not read nonce, using 0');
  }

  const deadline = BigInt(9999999999);
  const ueaVersion = pushClient.accountStatus.uea.version || '0.1.0';

  // Sign MigrationPayload using EIP-712 signTypedData (same approach as signUniversalPayload)
  if (!universalSigner.signTypedData) {
    throw new Error('signTypedData not available on signer');
  }

  console.log('Signing MigrationPayload via EIP-712...');
  console.log('  version:', ueaVersion);
  console.log('  chainId:', chainId);
  console.log('  verifyingContract:', ueaAddress);
  console.log('  migration:', UEA_MIGRATION_CONTRACT);
  console.log('  nonce:', ueaNonce.toString());
  console.log('  deadline:', deadline.toString());

  const signatureBytes = await universalSigner.signTypedData({
    domain: {
      version: ueaVersion,
      chainId: Number(chainId),
      verifyingContract: ueaAddress,
    },
    types: {
      MigrationPayload: [
        { name: 'migration', type: 'address' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    primaryType: 'MigrationPayload',
    message: {
      migration: UEA_MIGRATION_CONTRACT,
      nonce: ueaNonce,
      deadline: deadline,
    },
  });

  const signature = bytesToHex(signatureBytes);
  console.log('Signature:', signature);

  // Build MigrationPayload for the Cosmos message
  const migrationPayload = {
    migration: UEA_MIGRATION_CONTRACT,
    nonce: ueaNonce.toString(),
    deadline: deadline.toString(),
  };

  const universalAccountId = {
    chainNamespace: VM_NAMESPACE[vm],
    chainId: chainId,
    owner: universalSigner.account.address,
  };

  const { cosmosAddress: signer } = directPushClient.getSignerAddress();
  const msg = directPushClient.createMsgMigrateUEA({
    signer,
    universalAccountId,
    migrationPayload,
    signature,
  });

  console.log('\nBroadcasting MsgMigrateUEA...');
  const txBody = await directPushClient.createCosmosTxBody([msg]);
  const txRaw = await directPushClient.signCosmosTx(txBody);
  const tx = await directPushClient.broadcastCosmosTx(txRaw);

  if (tx.code !== 0) {
    console.error('\nMIGRATION FAILED');
    console.error('TX Code:', tx.code);
    console.error('Raw Log:', tx.rawLog);
    console.error('Cosmos Hash:', tx.transactionHash);
  } else {
    console.log('\nMIGRATION SUCCESS!');
    console.log('Cosmos Hash:', tx.transactionHash);

    // Check for EVM tx hashes in events
    const ethTxHashes = tx.events
      ?.filter((e: any) => e.type === 'ethereum_tx')
      .flatMap((e: any) =>
        e.attributes
          ?.filter((attr: any) => attr.key === 'ethereumTxHash')
          .map((attr: any) => attr.value)
      ) ?? [];
    if (ethTxHashes.length > 0) {
      console.log('EVM TX Hashes:', ethTxHashes);
    }
  }

  // =========================================================================
  // STEP 2: Test payload execution after migration
  // =========================================================================
  console.log('\n=== STEP 2: Test Payload Execution ===');
  const testTo = '0x35B84d6848D16415177c64D64504663b998A6ab4';

  try {
    const txResult = await pushClient.universal.sendTransaction({
      to: testTo,
      value: BigInt(1),
    });
    console.log('TX hash:', txResult.hash);
    const receipt = await txResult.wait();
    console.log('Receipt status:', receipt.status);
    console.log('Payload execution works after migration!');
  } catch (err: any) {
    console.error('Payload execution FAILED:', err.message);
  }

  // =========================================================================
  // STEP 3: Check version after migration
  // =========================================================================
  console.log('\n=== STEP 3: Post-Migration Version Check ===');
  const status = await pushClient.getAccountStatus({ forceRefresh: true });
  console.log('Account Status:', JSON.stringify(status, null, 2));

  console.log('\nDone.');
}

main().catch(console.error);
