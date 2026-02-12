import { encodeFunctionData, isAddress } from 'viem';
import { PushChain } from '../push-chain/push-chain';
import { ERC20_EVM } from '../constants/abi';
import { MoveableToken } from '../constants/tokens';
import { ExecuteParams, MultiCall } from './orchestrator.types';

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
      if (execute.to === ueaAddress)
        throw new Error(`You can't execute data on the UEA address`);
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
