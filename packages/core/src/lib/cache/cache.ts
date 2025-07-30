import { CHAIN, PUSH_NETWORK, VM } from '../constants/enums';

type CacheEntry = {
  value: any;
  createdAt: number;
  ttl?: number;
};

export class CacheKeys {
  static ueaAddressOnchain(
    chain: CHAIN,
    address: string,
    pushNetwork: PUSH_NETWORK,
    vm: VM
  ): string {
    return `uea_address_onchain:${chain}:${address}:${pushNetwork}:${vm}`;
  }

  static deploymentStatus(address: string): string {
    return `deployment_status:${address}`;
  }
}

export class Cache {
  private cache: Map<string, CacheEntry>;
  private maxSize: number;

  constructor(maxSize = 100) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  private isExpired(entry: CacheEntry): boolean {
    if (!entry.ttl) return false;
    return Date.now() > entry.createdAt + entry.ttl;
  }

  get(key: string): any | null {
    if (!this.cache.has(key)) return null;

    const entry = this.cache.get(key);

    if (entry != undefined) {
      if (this.isExpired(entry)) {
        this.cache.delete(key);
        return null;
      }

      this.cache.delete(key);
      this.cache.set(key, entry);
      return entry.value;
    }
    return null;
  }

  set(key: string, value: any, ttl?: number): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey != undefined) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, {
      value,
      createdAt: Date.now(),
      ttl,
    });
  }

  clear(key: string): void {
    this.cache.delete(key);
  }

  clearAll(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}
