import { encodeFunctionData } from 'viem';
import { PushChain } from '../push-chain/push-chain';
import { ERC20_EVM } from '../constants/abi';
import { MoveableToken } from '../constants/tokens';
import { ExecuteParams, MultiCall } from './orchestrator.types';

export function buildExecuteMulticall({
  execute,
  ueaAddress,
}: {
  execute: ExecuteParams;
  ueaAddress: `0x${string}`;
}): MultiCall[] {
  const multicallData: MultiCall[] = [];
  if (execute.value) {
    multicallData.push({
      to: execute.to,
      value: execute.value,
      data: '0x',
    });
  }
  if (execute.funds?.amount) {
    const erc20Transfer = encodeFunctionData({
      abi: ERC20_EVM,
      functionName: 'transfer',
      args: [execute.to, execute.funds?.amount],
    });
    const token = (execute.funds as { token: MoveableToken }).token;
    const pushChainTo = PushChain.utils.tokens.toSyntheticAddress(
      token as MoveableToken
    );
    multicallData.push({
      to: pushChainTo,
      value: BigInt(0),
      data: erc20Transfer,
    });
  }
  if (execute.data) {
    if (execute.to === ueaAddress)
      throw new Error(`You can't execute data on the UEA address`);
    if (Array.isArray(execute.data)) {
      multicallData.push(...(execute.data as MultiCall[]));
    } else {
      multicallData.push({
        to: execute.to,
        value: BigInt(0),
        data: execute.data as `0x${string}`,
      });
    }
  }
  return multicallData;
}
