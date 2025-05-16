// push-client.config.ts

export const PushClientConfig = {
  factoryAddress: '0xYourFactoryAddressHere' as const,
  scWalletBytecode: '0xYourWalletBytecodeHere' as const,

  // Conversion
  pushDecimals: BigInt(1e18),
  usdcDecimals: BigInt(1e8),
  pushToUsdcNumerator: BigInt(1e7), // 0.1 USDC
  pushToUsdcDenominator: BigInt(1e18),

  // Chain config
  bech32Prefix: 'push',
};
