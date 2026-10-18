import { getAddress, parseUnits } from 'viem';
import type { Address } from 'viem';
import type { RuleAsset } from '../agentic.types';
import { capabilityUnavailable } from '../errors';

/** Preset-only permission policy. Ordinary rule authoring retains zero defaults.
 * Amounts are token quantities, not USD valuations or destination lifetime caps.
 * Metadata verified read-only on October 18; evidence is retained under plan/agw/.
 */
export const PRESET_VALIDITY_SECONDS = 7 * 24 * 60 * 60;

// Explicit profiles keep future chains from inheriting an unreviewed budget.
// 20 PC is a ceiling, not the amount charged: execution obtains a fresh quote.
// This budget has testnet protocol-flow coverage; mainnet remains template-only.
export const PRESET_GAS_BUDGETS: Readonly<Record<string, bigint>> =
  Object.fromEntries(
    [
      'eip155:1',
      'eip155:8453',
      'eip155:42161',
      'eip155:56',
      'eip155:11155111',
      'eip155:84532',
      'eip155:421614',
      'eip155:97',
    ].map((chain) => [chain, parseUnits('20', 18)])
  );

type TokenBudget = { decimals: number; perCall: string; total: string };
const stable6: TokenBudget = { decimals: 6, perCall: '10', total: '100' };
const stable18: TokenBudget = { ...stable6, decimals: 18 };
const eth: TokenBudget = { decimals: 18, perCall: '0.001', total: '0.01' };
const bnb: TokenBudget = { decimals: 18, perCall: '0.01', total: '0.1' };
const link: TokenBudget = { decimals: 18, perCall: '1', total: '10' };

// Match by chain AND address. Never infer decimals or limits from a symbol,
// caller metadata, or the position of a token in an arbitrary selection.
const TOKEN_BUDGETS: Readonly<
  Record<string, readonly (readonly [Address, TokenBudget])[]>
> = {
  'eip155:1': [
    ['0x0000000000000000000000000000000000000000', eth],
    ['0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', eth],
    ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', stable6],
    ['0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84', eth],
    ['0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0', eth],
  ],
  'eip155:8453': [
    ['0x4200000000000000000000000000000000000006', eth],
    ['0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', stable6],
  ],
  'eip155:42161': [
    ['0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', eth],
    ['0xaf88d065e77c8cC2239327C5EDb3A432268e5831', stable6],
  ],
  'eip155:56': [
    ['0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', bnb],
    ['0x55d398326f99059fF775485246999027B3197955', stable18],
  ],
  'eip155:11155111': [
    ['0xfff9976782d46cc05630d1f6ebab18b2324d6b14', eth],
    ['0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', stable6],
    ['0xf8Fb3713D459D7C1018BD0A49D19b4C44290EBE5', link],
    ['0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9', eth],
  ],
  'eip155:84532': [
    ['0x4200000000000000000000000000000000000006', eth],
    ['0x036CbD53842c5426634e7929541eC2318f3dCF7e', stable6],
    ['0x810D46F9a9027E28F9B01F75E2bdde839dA61115', link],
    ['0x4616975f7E6045FD9737e95bC527e9e14c727BD2', stable6],
    ['0x663A6F02d547dFd639BF689FED298712f2FB69Fb', eth],
  ],
  'eip155:421614': [
    ['0x980B62Da83eFf3D4576C647993b0c1D7faf17c73', eth],
    ['0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d', stable6],
  ],
  'eip155:97': [
    ['0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd', bnb],
    ['0xA11c8D9DC9b66E209Ef60F0C8D969D3CD988782c', stable6],
    ['0x16227D60f7a0e586C66B005219dfc887D13C9531', stable6],
  ],
};

export function defaultPresetAsset(chain: string, token: Address): RuleAsset {
  const budget = TOKEN_BUDGETS[chain]?.find(
    ([address]) => getAddress(address) === getAddress(token)
  )?.[1];
  if (!budget)
    throw capabilityUnavailable(
      'presetPolicy',
      `No reviewed default spending policy for ${chain}:${token}`
    );
  return {
    token,
    maxPerCall: parseUnits(budget.perCall, budget.decimals),
    maxTotal: parseUnits(budget.total, budget.decimals),
  };
}
