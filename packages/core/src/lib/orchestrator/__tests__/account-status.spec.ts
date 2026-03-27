/**
 * Unit tests for AccountStatus types, version utilities,
 * and UEA Migration progress hooks.
 */
import {
  AccountStatus,
  parseUEAVersion,
} from '../orchestrator.types';
import { PROGRESS_HOOK } from '../../progress-hook/progress-hook.types';
import PROGRESS_HOOKS from '../../progress-hook/progress-hook';

// ============================================================================
// parseUEAVersion
// ============================================================================
describe('parseUEAVersion', () => {
  it('should parse "1.0.2" to 1000002', () => {
    expect(parseUEAVersion('1.0.2')).toBe(1000002);
  });

  it('should parse "1.1.3" to 1001003', () => {
    expect(parseUEAVersion('1.1.3')).toBe(1001003);
  });

  it('should parse "0.0.0" to 0', () => {
    expect(parseUEAVersion('0.0.0')).toBe(0);
  });

  it('should parse "1.0.0" to 1000000', () => {
    expect(parseUEAVersion('1.0.0')).toBe(1000000);
  });

  it('should parse "2.10.5" to 2010005', () => {
    expect(parseUEAVersion('2.10.5')).toBe(2010005);
  });

  it('should return 0 for invalid format', () => {
    expect(parseUEAVersion('invalid')).toBe(0);
    expect(parseUEAVersion('1.0')).toBe(0);
    expect(parseUEAVersion('')).toBe(0);
  });

  it('should return 0 for empty string', () => {
    expect(parseUEAVersion('')).toBe(0);
  });
});

// ============================================================================
// Version comparison logic (using parseUEAVersion for numeric comparison)
// ============================================================================
describe('UEA version comparison', () => {
  it('should detect upgrade required when version < minRequiredVersion', () => {
    expect(parseUEAVersion('1.0.0') < parseUEAVersion('1.0.2')).toBe(true);
  });

  it('should detect no upgrade when version === minRequiredVersion', () => {
    expect(parseUEAVersion('1.0.2') < parseUEAVersion('1.0.2')).toBe(false);
  });

  it('should detect no upgrade when version > minRequiredVersion', () => {
    expect(parseUEAVersion('2.0.0') < parseUEAVersion('1.0.2')).toBe(false);
  });

  it('should handle minor version comparison correctly', () => {
    expect(parseUEAVersion('1.0.999') < parseUEAVersion('1.1.0')).toBe(true);
  });

  it('should handle major version rollover', () => {
    expect(parseUEAVersion('1.999.999') < parseUEAVersion('2.0.0')).toBe(true);
  });

  it('should treat empty string as 0 (no upgrade from empty)', () => {
    expect(parseUEAVersion('') < parseUEAVersion('')).toBe(false);
  });
});

// ============================================================================
// AccountStatus type structure
// ============================================================================
describe('AccountStatus default (unloaded)', () => {
  const defaultStatus: AccountStatus = {
    mode: 'signer',
    uea: {
      loaded: false,
      deployed: false,
      version: '',
      minRequiredVersion: '',
      requiresUpgrade: false,
    },
  };

  it('should have loaded = false', () => {
    expect(defaultStatus.uea.loaded).toBe(false);
  });

  it('should have deployed = false', () => {
    expect(defaultStatus.uea.deployed).toBe(false);
  });

  it('should have version as empty string', () => {
    expect(defaultStatus.uea.version).toBe('');
  });

  it('should have requiresUpgrade = false', () => {
    expect(defaultStatus.uea.requiresUpgrade).toBe(false);
  });

  it('should have mode as signer or read-only', () => {
    expect(['signer', 'read-only']).toContain(defaultStatus.mode);
  });
});

describe('AccountStatus loaded — upgrade required', () => {
  const status: AccountStatus = {
    mode: 'signer',
    uea: {
      loaded: true,
      deployed: true,
      version: '1.0.0',
      minRequiredVersion: '1.0.2',
      requiresUpgrade: true,
    },
  };

  it('should have loaded = true', () => {
    expect(status.uea.loaded).toBe(true);
  });

  it('should have deployed = true', () => {
    expect(status.uea.deployed).toBe(true);
  });

  it('should have requiresUpgrade = true when version < minRequiredVersion', () => {
    expect(
      parseUEAVersion(status.uea.version) <
        parseUEAVersion(status.uea.minRequiredVersion)
    ).toBe(true);
    expect(status.uea.requiresUpgrade).toBe(true);
  });
});

describe('AccountStatus loaded — no upgrade needed', () => {
  const status: AccountStatus = {
    mode: 'signer',
    uea: {
      loaded: true,
      deployed: true,
      version: '1.0.2',
      minRequiredVersion: '1.0.2',
      requiresUpgrade: false,
    },
  };

  it('should have requiresUpgrade = false when version >= minRequiredVersion', () => {
    expect(
      parseUEAVersion(status.uea.version) >=
        parseUEAVersion(status.uea.minRequiredVersion)
    ).toBe(true);
    expect(status.uea.requiresUpgrade).toBe(false);
  });
});

describe('AccountStatus loaded — not deployed', () => {
  const status: AccountStatus = {
    mode: 'signer',
    uea: {
      loaded: true,
      deployed: false,
      version: '',
      minRequiredVersion: '',
      requiresUpgrade: false,
    },
  };

  it('should have deployed = false with empty version', () => {
    expect(status.uea.deployed).toBe(false);
    expect(status.uea.version).toBe('');
  });

  it('should not require upgrade when not deployed', () => {
    expect(status.uea.requiresUpgrade).toBe(false);
  });
});

// ============================================================================
// UEA Migration Progress Hooks
// ============================================================================
describe('UEA Migration progress hook enum values', () => {
  it('should have UEA_MIG_01 = "UEA-MIG-01"', () => {
    expect(PROGRESS_HOOK.UEA_MIG_01).toBe('UEA-MIG-01');
  });

  it('should have UEA_MIG_02 = "UEA-MIG-02"', () => {
    expect(PROGRESS_HOOK.UEA_MIG_02).toBe('UEA-MIG-02');
  });

  it('should have UEA_MIG_03 = "UEA-MIG-03"', () => {
    expect(PROGRESS_HOOK.UEA_MIG_03).toBe('UEA-MIG-03');
  });

  it('should have UEA_MIG_9901 = "UEA-MIG-9901"', () => {
    expect(PROGRESS_HOOK.UEA_MIG_9901).toBe('UEA-MIG-9901');
  });

  it('should have UEA_MIG_9902 = "UEA-MIG-9902"', () => {
    expect(PROGRESS_HOOK.UEA_MIG_9902).toBe('UEA-MIG-9902');
  });

  it('should have UEA_MIG_9903 = "UEA-MIG-9903"', () => {
    expect(PROGRESS_HOOK.UEA_MIG_9903).toBe('UEA-MIG-9903');
  });
});

describe('UEA Migration progress hook definitions', () => {
  it('UEA_MIG_01 should produce INFO level event', () => {
    const hook = PROGRESS_HOOKS[PROGRESS_HOOK.UEA_MIG_01];
    const event = hook();
    expect(event.id).toBe('UEA-MIG-01');
    expect(event.title).toBe('Checking UEA');
    expect(event.level).toBe('INFO');
    expect(event.timestamp).toBeDefined();
  });

  it('UEA_MIG_02 should produce INFO level event for signature', () => {
    const hook = PROGRESS_HOOKS[PROGRESS_HOOK.UEA_MIG_02];
    const event = hook();
    expect(event.id).toBe('UEA-MIG-02');
    expect(event.title).toBe('Awaiting Migration Signature');
    expect(event.level).toBe('INFO');
  });

  it('UEA_MIG_03 should produce INFO level event for broadcasting', () => {
    const hook = PROGRESS_HOOKS[PROGRESS_HOOK.UEA_MIG_03];
    const event = hook();
    expect(event.id).toBe('UEA-MIG-03');
    expect(event.title).toBe('Broadcasting Migration TX');
    expect(event.level).toBe('INFO');
  });

  it('UEA_MIG_9901 should produce SUCCESS level event with version string', () => {
    const hook = PROGRESS_HOOKS[PROGRESS_HOOK.UEA_MIG_9901];
    const event = hook('1.0.2');
    expect(event.id).toBe('UEA-MIG-9901');
    expect(event.title).toBe('UEA Migration Successful');
    expect(event.message).toContain('1.0.2');
    expect(event.level).toBe('SUCCESS');
  });

  it('UEA_MIG_9902 should produce ERROR level event', () => {
    const hook = PROGRESS_HOOKS[PROGRESS_HOOK.UEA_MIG_9902];
    const event = hook();
    expect(event.id).toBe('UEA-MIG-9902');
    expect(event.title).toBe('UEA Migration Failed');
    expect(event.level).toBe('ERROR');
  });

  it('UEA_MIG_9903 should produce INFO level event for skipped', () => {
    const hook = PROGRESS_HOOKS[PROGRESS_HOOK.UEA_MIG_9903];
    const event = hook();
    expect(event.id).toBe('UEA-MIG-9903');
    expect(event.title).toBe('UEA Migration Skipped');
    expect(event.level).toBe('INFO');
  });
});

// ============================================================================
// UEA_FACTORY_ABI
// ============================================================================
describe('UEA_FACTORY_ABI', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { UEA_FACTORY_ABI } = require('../../constants/abi/uea-factory');

  it('should have UEA_VERSION function', () => {
    const fn = UEA_FACTORY_ABI.find(
      (entry: any) => entry.name === 'UEA_VERSION'
    );
    expect(fn).toBeDefined();
    expect(fn.type).toBe('function');
    expect(fn.stateMutability).toBe('view');
    expect(fn.inputs).toHaveLength(1);
    expect(fn.inputs[0].type).toBe('bytes32');
    expect(fn.outputs[0].type).toBe('string');
  });

  it('should have UEA_MIGRATION_CONTRACT function', () => {
    const fn = UEA_FACTORY_ABI.find(
      (entry: any) => entry.name === 'UEA_MIGRATION_CONTRACT'
    );
    expect(fn).toBeDefined();
    expect(fn.type).toBe('function');
    expect(fn.stateMutability).toBe('view');
    expect(fn.inputs).toHaveLength(0);
    expect(fn.outputs[0].type).toBe('address');
  });
});
