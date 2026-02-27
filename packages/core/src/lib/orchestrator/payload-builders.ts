import { encodeFunctionData, encodeAbiParameters, isAddress } from 'viem';
import { PushChain } from '../push-chain/push-chain';
import { ERC20_EVM, UNIVERSAL_GATEWAY_V0 } from '../constants/abi';
import { MoveableToken } from '../constants/tokens';
import { ZERO_ADDRESS } from '../constants/selectors';
import type {
  ExecuteParams,
  MultiCall,
  UniversalOutboundTxRequest,
  ChainTarget,
} from './orchestrator.types';

export function buildExecuteMulticall({
  execute,
  ueaAddress,
  logger,
}: {
  execute: ExecuteParams;
  ueaAddress: `0x${string}`;
  logger?: (msg: string) => void;
}): MultiCall[] {
  const log = (msg: string) => logger?.(msg);

  log('buildExecuteMulticall — input: ' + JSON.stringify({
    to: execute.to,
    value: execute.value?.toString() ?? 'undefined',
    data: execute.data ? (Array.isArray(execute.data) ? `Array(${execute.data.length})` : execute.data.slice(0, 20) + '...') : 'undefined',
    hasData: !!execute.data,
    fundsAmount: execute.funds?.amount?.toString() ?? 'undefined',
    fundsTokenSymbol: (execute.funds as { token?: MoveableToken })?.token?.symbol ?? 'undefined',
    fundsTokenMechanism: (execute.funds as { token?: MoveableToken })?.token?.mechanism ?? 'undefined',
    ueaAddress,
  }, null, 2));

  const multicallData: MultiCall[] = [];

  // *** We will pass the value alongside with the data in a single message now ***
  const branch1 = !execute.data && execute.value;
  log(`buildExecuteMulticall — Branch 1 (!data && value): ${branch1} | !execute.data: ${!execute.data} | execute.value: ${execute.value?.toString() ?? 'undefined'}`);
  if (!execute.data && execute.value) {
    multicallData.push({
      to: execute.to,
      value: execute.value,
      data: '0x',
    });
    log(`buildExecuteMulticall — Branch 1 ENTERED: pushed native value transfer to ${execute.to}`);
  }

  if (execute.funds?.amount) {
    const token = (execute.funds as { token: MoveableToken }).token;
    const isArrayMulticall = Array.isArray(execute.data);
    const isNative = token.mechanism === 'native';
    log('buildExecuteMulticall — Branch 2 (funds): ' + JSON.stringify({
      amount: execute.funds.amount.toString(),
      mechanism: token.mechanism,
      isNative,
      isArrayMulticall,
      willAddErc20Transfer: !isNative && !isArrayMulticall,
      skippedReason: isNative ? 'native token — no PRC-20 transfer needed' : isArrayMulticall ? 'array multicall — user handles transfers' : 'none',
    }, null, 2));
    // Only add ERC-20 transfer for non-native tokens AND when NOT in array multicall mode
    // - Native tokens (ETH/SOL) are bridged as native PC on Push Chain, not as PRC-20
    // - When execute.data is an array (explicit multicall), user handles fund transfers in their calls
    if (!isArrayMulticall) {
      const erc20Transfer = encodeFunctionData({
        abi: ERC20_EVM,
        functionName: 'transfer',
        args: [execute.to, execute.funds?.amount],
      });
      const pushChainTo = PushChain.utils.tokens.getPRC20Address(token);
      multicallData.push({
        to: pushChainTo,
        value: BigInt(0),
        data: erc20Transfer,
      });
      log(`buildExecuteMulticall — Branch 2 ENTERED: pushed ERC-20 transfer to ${pushChainTo}`);
    }
    // For native tokens or array multicall: funds arrive in UEA, user's multicall handles distribution
  } else {
    log('buildExecuteMulticall — Branch 2 SKIPPED: no funds.amount');
  }

  log(`buildExecuteMulticall — Branch 3 (execute.data): ${!!execute.data}`);
  if (execute.data) {
    // *************************
    // Check for `execute.to`
    // *************************

    // For multicall, there is no validation for execute.to. Only if that's a valid EVM address
    if (Array.isArray(execute.data)) {
      if (!isAddress(execute.to))
        throw new Error(`Invalid EVM address at execute.to ${execute.to}`);
    } else {
      // We can't execute payload against our UEA.
      // if (execute.to === ueaAddress)
      //   throw new Error(`You can't execute data on the UEA address`);
    }

    if (Array.isArray(execute.data)) {
      multicallData.push(...(execute.data as MultiCall[]));
      log(`buildExecuteMulticall — Branch 3 ENTERED: pushed ${(execute.data as MultiCall[]).length} array multicall entries`);
    } else {
      multicallData.push({
        to: execute.to,
        value: execute.value ? execute.value : BigInt(0),
        data: execute.data as `0x${string}`,
      });
      log(`buildExecuteMulticall — Branch 3 ENTERED: pushed single calldata to ${execute.to}`);
    }
  }

  log('buildExecuteMulticall — result: multicallData.length: ' + multicallData.length + ' ' +
    JSON.stringify(multicallData, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
  return multicallData;
}

// ============================================================================
// Multi-Chain Payload Builders
// ============================================================================

/**
 * Multicall tuple type definition for ABI encoding
 */
const MULTICALL_TUPLE_TYPE = {
  type: 'tuple[]',
  components: [
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'data', type: 'bytes' },
  ],
} as const;

/**
 * Build CEA multicall payload for outbound transactions
 * Format: abi.encode(Multicall[]) - raw encoded, NO selector
 *
 * The CEA contract expects just the ABI-encoded Multicall[] array,
 * not a function call with selector.
 *
 * @param multicalls - Array of multicall operations to execute on external chain
 * @returns Raw ABI-encoded Multicall[] array
 */
export function buildCeaMulticallPayload(multicalls: MultiCall[]): `0x${string}` {
  if (multicalls.length === 0) {
    return '0x';
  }

  // Encode the multicall array (raw, no selector)
  return encodeAbiParameters(
    [MULTICALL_TUPLE_TYPE],
    [multicalls.map((m) => ({
      to: m.to,
      value: m.value,
      data: m.data,
    }))]
  );
}

/**
 * Build a single call as CEA multicall payload
 *
 * @param target - Target contract address
 * @param value - Native value to send
 * @param data - Calldata to execute
 * @returns Encoded payload with selector prefix
 */
export function buildSingleCeaCall(
  target: `0x${string}`,
  value: bigint,
  data: `0x${string}`
): `0x${string}` {
  return buildCeaMulticallPayload([{ to: target, value, data }]);
}

/**
 * Build approve + interact pattern for ERC20 operations on external chains
 *
 * @param tokenAddress - ERC20 token address
 * @param spender - Address to approve (e.g., DEX router)
 * @param amount - Amount to approve
 * @param interactCall - The interaction call (e.g., swap)
 * @returns Array of multicall operations
 */
export function buildApproveAndInteract(
  tokenAddress: `0x${string}`,
  spender: `0x${string}`,
  amount: bigint,
  interactCall: MultiCall
): MultiCall[] {
  const approveData = encodeFunctionData({
    abi: ERC20_EVM,
    functionName: 'approve',
    args: [spender, amount],
  });

  return [
    {
      to: tokenAddress,
      value: BigInt(0),
      data: approveData,
    },
    interactCall,
  ];
}

/**
 * Build sendUniversalTxFromCEA call for CEA → Push routing (Route 3)
 *
 * @param gatewayAddress - UniversalGateway address on external chain
 * @param recipient - Recipient on Push Chain (usually UEA)
 * @param token - Token address (address(0) for native)
 * @param amount - Amount to send
 * @param payload - Payload for Push Chain execution
 * @param revertRecipient - Address to receive funds on revert
 * @param signatureData - Signature data (usually empty for CEA calls)
 * @param nativeValue - Native value to send with the call
 * @returns MultiCall for sendUniversalTxFromCEA
 */
export function buildSendUniversalTxFromCEA(
  gatewayAddress: `0x${string}`,
  recipient: `0x${string}`,
  token: `0x${string}`,
  amount: bigint,
  payload: `0x${string}`,
  revertRecipient: `0x${string}`,
  signatureData: `0x${string}` = '0x',
  nativeValue = BigInt(0)
): MultiCall {
  const calldata = encodeFunctionData({
    abi: UNIVERSAL_GATEWAY_V0,
    functionName: 'sendUniversalTxFromCEA',
    args: [
      {
        recipient,
        token,
        amount,
        payload,
        revertInstruction: {
          fundRecipient: revertRecipient,
          revertMsg: '0x',
        },
        signatureData,
      },
    ],
  });

  return {
    to: gatewayAddress,
    value: nativeValue,
    data: calldata,
  };
}

/**
 * Build UniversalOutboundTxRequest for Push Chain outbound
 *
 * @param target - LEGACY/DUMMY: Any non-zero address for contract compatibility.
 *                 This value is NOT used by the relay to determine the actual destination.
 *                 The relay determines the destination from the PRC-20 token's SOURCE_CHAIN_NAMESPACE.
 *                 Will be removed in future contract upgrades.
 * @param prc20Token - PRC20 token address to burn (or address(0) for native)
 * @param amount - Amount to burn
 * @param gasLimit - Gas limit for fee calculation
 * @param payload - CEA multicall payload
 * @param revertRecipient - Address to receive funds on revert
 * @returns UniversalOutboundTxRequest object
 */
export function buildOutboundRequest(
  target: `0x${string}`,
  prc20Token: `0x${string}`,
  amount: bigint,
  gasLimit: bigint,
  payload: `0x${string}`,
  revertRecipient: `0x${string}`
): UniversalOutboundTxRequest {
  return {
    target,
    token: prc20Token,
    amount,
    gasLimit,
    payload,
    revertRecipient,
  };
}

/**
 * Build native transfer multicall
 *
 * @param to - Recipient address
 * @param value - Native value to transfer
 * @returns MultiCall for native transfer
 */
export function buildNativeTransfer(
  to: `0x${string}`,
  value: bigint
): MultiCall {
  return {
    to,
    value,
    data: '0x',
  };
}

/**
 * Build ERC20 transfer multicall
 *
 * @param tokenAddress - ERC20 token address
 * @param to - Recipient address
 * @param amount - Amount to transfer
 * @returns MultiCall for ERC20 transfer
 */
export function buildErc20Transfer(
  tokenAddress: `0x${string}`,
  to: `0x${string}`,
  amount: bigint
): MultiCall {
  const transferData = encodeFunctionData({
    abi: ERC20_EVM,
    functionName: 'transfer',
    args: [to, amount],
  });

  return {
    to: tokenAddress,
    value: BigInt(0),
    data: transferData,
  };
}

/**
 * Check if an address is the zero address
 */
export function isZeroAddress(address: `0x${string}`): boolean {
  return address.toLowerCase() === ZERO_ADDRESS.toLowerCase();
}
