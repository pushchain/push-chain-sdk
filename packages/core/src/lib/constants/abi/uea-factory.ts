/**
 * Minimal ABI for UEAFactory on Push Chain.
 * Used to read the latest UEA implementation version (minRequiredVersion)
 * and the migration contract address.
 */
export const UEA_FACTORY_ABI = [
  {
    type: 'function',
    name: 'UEA_VERSION',
    inputs: [{ name: 'vmHash', type: 'bytes32', internalType: 'bytes32' }],
    outputs: [{ name: '', type: 'string', internalType: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'UEA_MIGRATION_CONTRACT',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
] as const;
