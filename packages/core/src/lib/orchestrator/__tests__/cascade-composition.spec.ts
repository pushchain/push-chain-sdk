/**
 * Unit tests for cascade composition logic:
 * - classifyIntoSegments
 *
 * Tests import the pure function directly from cascade.ts
 * (no Orchestrator instance needed).
 */
import { CHAIN } from '../../constants/enums';
import { classifyIntoSegments } from '../internals/cascade';
import type {
  HopDescriptor,
  MultiCall,
  UniversalExecuteParams,
} from '../orchestrator.types';

// ============================================================================
// Test data helpers
// ============================================================================

const ALICE = '0xABCDEF1234567890ABCDEF1234567890ABCDEF12' as `0x${string}`;
const BOB = '0x1111111111111111111111111111111111111111' as `0x${string}`;
const TOKEN_A = '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' as `0x${string}`;
const UEA = '0x2222222222222222222222222222222222222222' as `0x${string}`;
const CEA_BNB = '0x3333333333333333333333333333333333333333' as `0x${string}`;
const CEA_ETH = '0x4444444444444444444444444444444444444444' as `0x${string}`;

function makeBaseHop(overrides: Partial<HopDescriptor> = {}): HopDescriptor {
  return {
    params: { to: ALICE, value: BigInt(100) } as UniversalExecuteParams,
    route: 'UOA_TO_PUSH',
    gasLimit: BigInt(200000),
    ueaAddress: UEA,
    revertRecipient: UEA,
    ...overrides,
  };
}

function makeRoute1Hop(
  pushMulticalls: MultiCall[] = [{ to: ALICE, value: BigInt(100), data: '0x' }]
): HopDescriptor {
  return makeBaseHop({
    route: 'UOA_TO_PUSH',
    pushMulticalls,
  });
}

function makeRoute2Hop(
  targetChain: CHAIN,
  ceaMulticalls: MultiCall[] = [{ to: BOB, value: BigInt(50), data: '0xdeadbeef' }],
  opts: Partial<HopDescriptor> = {}
): HopDescriptor {
  return makeBaseHop({
    route: 'UOA_TO_CEA',
    targetChain,
    ceaAddress: targetChain === CHAIN.BNB_TESTNET ? CEA_BNB : CEA_ETH,
    ceaMulticalls,
    prc20Token: TOKEN_A,
    burnAmount: BigInt(1000),
    gasToken: TOKEN_A,
    gasFee: BigInt(200),
    ...opts,
  });
}

function makeRoute3Hop(
  sourceChain: CHAIN,
  opts: Partial<HopDescriptor> = {}
): HopDescriptor {
  return makeBaseHop({
    route: 'CEA_TO_PUSH',
    sourceChain,
    ceaAddress: sourceChain === CHAIN.BNB_TESTNET ? CEA_BNB : CEA_ETH,
    prc20Token: TOKEN_A,
    burnAmount: BigInt(1),
    gasToken: TOKEN_A,
    gasFee: BigInt(200),
    ...opts,
  });
}

// ============================================================================
// classifyIntoSegments
// ============================================================================
describe('classifyIntoSegments', () => {
  it('should return empty array for empty hops', () => {
    const result = classifyIntoSegments([]);
    expect(result).toEqual([]);
  });

  it('should create single PUSH_EXECUTION segment for one Route 1 hop', () => {
    const hop = makeRoute1Hop();
    const result = classifyIntoSegments([hop]);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('PUSH_EXECUTION');
    expect(result[0].hops).toHaveLength(1);
    expect(result[0].mergedPushMulticalls).toEqual(hop.pushMulticalls);
  });

  it('should merge consecutive Route 1 hops into single PUSH_EXECUTION segment', () => {
    const hop1 = makeRoute1Hop([{ to: ALICE, value: BigInt(100), data: '0x' }]);
    const hop2 = makeRoute1Hop([{ to: BOB, value: BigInt(200), data: '0x' }]);
    const result = classifyIntoSegments([hop1, hop2]);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('PUSH_EXECUTION');
    expect(result[0].hops).toHaveLength(2);
    expect(result[0].mergedPushMulticalls).toHaveLength(2);
  });

  it('should create single OUTBOUND_TO_CEA segment for one Route 2 hop', () => {
    const hop = makeRoute2Hop(CHAIN.BNB_TESTNET);
    const result = classifyIntoSegments([hop]);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('OUTBOUND_TO_CEA');
    expect(result[0].targetChain).toBe(CHAIN.BNB_TESTNET);
    expect(result[0].prc20Token).toBe(TOKEN_A);
    expect(result[0].totalBurnAmount).toBe(BigInt(1000));
  });

  it('should merge consecutive Route 2 hops to same chain', () => {
    const hop1 = makeRoute2Hop(CHAIN.BNB_TESTNET, [
      { to: ALICE, value: BigInt(50), data: '0xaa' },
    ]);
    const hop2 = makeRoute2Hop(CHAIN.BNB_TESTNET, [
      { to: BOB, value: BigInt(75), data: '0xbb' },
    ]);
    const result = classifyIntoSegments([hop1, hop2]);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('OUTBOUND_TO_CEA');
    expect(result[0].hops).toHaveLength(2);
    // CEA multicalls merged
    expect(result[0].mergedCeaMulticalls).toHaveLength(2);
    // Burn amounts summed
    expect(result[0].totalBurnAmount).toBe(BigInt(2000)); // 1000 + 1000
    // Gas fees accumulated
    expect(result[0].gasFee).toBe(BigInt(400)); // 200 + 200
  });

  it('should NOT merge Route 2 hops targeting different chains', () => {
    const hop1 = makeRoute2Hop(CHAIN.BNB_TESTNET);
    const hop2 = makeRoute2Hop(CHAIN.ETHEREUM_SEPOLIA);
    const result = classifyIntoSegments([hop1, hop2]);

    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('OUTBOUND_TO_CEA');
    expect(result[0].targetChain).toBe(CHAIN.BNB_TESTNET);
    expect(result[1].type).toBe('OUTBOUND_TO_CEA');
    expect(result[1].targetChain).toBe(CHAIN.ETHEREUM_SEPOLIA);
  });

  it('should create INBOUND_FROM_CEA segment for Route 3 hop', () => {
    const hop = makeRoute3Hop(CHAIN.BNB_TESTNET);
    const result = classifyIntoSegments([hop]);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('INBOUND_FROM_CEA');
    expect(result[0].sourceChain).toBe(CHAIN.BNB_TESTNET);
  });

  it('should NOT merge consecutive Route 3 hops (direction change)', () => {
    const hop1 = makeRoute3Hop(CHAIN.BNB_TESTNET);
    const hop2 = makeRoute3Hop(CHAIN.BNB_TESTNET);
    const result = classifyIntoSegments([hop1, hop2]);

    // Route 3 hops are INBOUND_FROM_CEA, which don't merge
    expect(result).toHaveLength(2);
  });

  it('should handle mixed routes: Route 1 -> Route 2 -> Route 3', () => {
    const hop1 = makeRoute1Hop();
    const hop2 = makeRoute2Hop(CHAIN.BNB_TESTNET);
    const hop3 = makeRoute3Hop(CHAIN.ETHEREUM_SEPOLIA);
    const result = classifyIntoSegments([hop1, hop2, hop3]);

    expect(result).toHaveLength(3);
    expect(result[0].type).toBe('PUSH_EXECUTION');
    expect(result[1].type).toBe('OUTBOUND_TO_CEA');
    expect(result[2].type).toBe('INBOUND_FROM_CEA');
  });

  it('should keep gasLimit as max across merged hops', () => {
    const hop1 = makeRoute2Hop(CHAIN.BNB_TESTNET, undefined, {
      gasLimit: BigInt(100000),
    });
    const hop2 = makeRoute2Hop(CHAIN.BNB_TESTNET, undefined, {
      gasLimit: BigInt(300000),
    });
    const result = classifyIntoSegments([hop1, hop2]);

    expect(result).toHaveLength(1);
    expect(result[0].gasLimit).toBe(BigInt(300000));
  });
});
