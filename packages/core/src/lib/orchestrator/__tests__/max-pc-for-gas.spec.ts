import {
  DEFAULT_MAX_PC_FOR_GAS_BUFFER_BPS,
  quoteMaxPCForGasCap,
  quoteMaxPCForGasCapFromNativeValue,
} from '../max-pc-for-gas';

describe('maxPCForGas quote helpers', () => {
  it('adds the default 10% cap buffer and returns the matching native value', () => {
    const result = quoteMaxPCForGasCap({
      gasLegNativePc: BigInt(1000),
      protocolFee: BigInt(25),
    });

    expect(result.bufferBps).toBe(DEFAULT_MAX_PC_FOR_GAS_BUFFER_BPS);
    expect(result.maxPCForGas).toBe(BigInt(1100));
    expect(result.nativeValueForGas).toBe(BigInt(1125));
    expect(result.gasLegNativePc).toBe(BigInt(1000));
    expect(result.protocolFee).toBe(BigInt(25));
  });

  it('rounds buffered caps up so tiny gas legs are not rounded to zero', () => {
    const result = quoteMaxPCForGasCap({
      gasLegNativePc: BigInt(1),
      bufferBps: 1,
    });

    expect(result.maxPCForGas).toBe(BigInt(2));
    expect(result.nativeValueForGas).toBe(BigInt(2));
  });

  it('supports an explicit zero-buffer cap', () => {
    const result = quoteMaxPCForGasCap({
      gasLegNativePc: BigInt(1000),
      protocolFee: BigInt(25),
      bufferBps: 0,
    });

    expect(result.maxPCForGas).toBe(BigInt(1000));
    expect(result.nativeValueForGas).toBe(BigInt(1025));
  });

  it('derives the gas leg from queryOutboundGasFee nativeValueForGas', () => {
    const result = quoteMaxPCForGasCapFromNativeValue({
      nativeValueForGas: BigInt(525),
      protocolFee: BigInt(25),
      bufferBps: 500,
    });

    expect(result.gasLegNativePc).toBe(BigInt(500));
    expect(result.maxPCForGas).toBe(BigInt(525));
    expect(result.nativeValueForGas).toBe(BigInt(550));
  });

  it('returns an uncapped sentinel when the gas leg is zero', () => {
    const result = quoteMaxPCForGasCapFromNativeValue({
      nativeValueForGas: BigInt(25),
      protocolFee: BigInt(25),
    });

    expect(result.maxPCForGas).toBe(BigInt(0));
    expect(result.nativeValueForGas).toBe(BigInt(25));
  });

  it('rejects impossible native/protocol fee combinations', () => {
    expect(() =>
      quoteMaxPCForGasCapFromNativeValue({
        nativeValueForGas: BigInt(10),
        protocolFee: BigInt(11),
      })
    ).toThrow('nativeValueForGas must be greater than or equal to protocolFee');
  });

  it('rejects invalid buffer values', () => {
    expect(() =>
      quoteMaxPCForGasCap({
        gasLegNativePc: BigInt(1000),
        bufferBps: 10_001,
      })
    ).toThrow('bufferBps must be an integer');

    expect(() =>
      quoteMaxPCForGasCap({
        gasLegNativePc: BigInt(1000),
        bufferBps: 0.5,
      })
    ).toThrow('bufferBps must be an integer');
  });
});
