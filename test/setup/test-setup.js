/**
 * Simplified test setup for Vitest CLI command testing
 * Provides mock storage infrastructure only
 */

import { EventEmitter } from 'events';

// Mock storage provider for testing
export class MockStorageProvider extends EventEmitter {
  constructor() {
    super();
    this.data = new Map();
    this.metadata = new Map();
    this.initialized = true; // Key change: start as initialized
    this.disposed = false;
    this.stats = {
      hits: { memory: 10, pglite: 20, github: 5 },
      misses: 3,
      totalOperations: 38,
      hitRate: 92.1,
      avgResponseTimes: { memory: 2, pglite: 15, github: 200 },
      responseTimes: {
        memory: [1, 2, 3],
        pglite: [10, 15, 20],
        github: [100, 200, 300]
      },
      totalItems: 35,
      totalSize: 1024 * 1024,
      tierAvailability: {
        memory: true,
        pglite: true,
        github: true
      },
      circuitBreaker: {
        state: 'CLOSED',
        failureCount: 0,
        isOpen: false,
        requestsAllowed: true
      }
    };
    this.config = {
      github: { enabled: true }
    };
  }

  async initialize() {
    this.initialized = true;
  }

  async dispose() {
    this.disposed = true;
    this.initialized = false;
  }

  isDisposed() {
    return this.disposed;
  }

  async get(key) {
    if (!key || typeof key !== 'string') {
      throw new Error('Storage key must be a non-empty string');
    }
    const item = this.data.get(key);
    if (item && (!item.expiry || item.expiry > Date.now())) {
      return item.data;
    }
    return undefined;
  }

  async set(key, value, ttl) {
    if (!key || typeof key !== 'string') {
      throw new Error('Storage key must be a non-empty string');
    }
    this.data.set(key, {
      data: value,
      expiry: ttl ? Date.now() + (ttl * 1000) : null,
      createdAt: new Date(),
      lastAccessed: new Date(),
      size: JSON.stringify(value).length
    });
  }

  async mget(keys) {
    const result = new Map();
    for (const key of keys) {
      const value = await this.get(key);
      if (value !== undefined) {
        result.set(key, value);
      }
    }
    return result;
  }

  async mset(entries) {
    for (const [key, value, ttl] of entries) {
      await this.set(key, value, ttl);
    }
  }

  async clear() {
    this.data.clear();
    this.metadata.clear();
  }

  async has(key) {
    return this.data.has(key);
  }

  async delete(key) {
    return this.data.delete(key);
  }

  async keys() {
    return Array.from(this.data.keys());
  }

  getStats() {
    return Promise.resolve({ ...this.stats });
  }

  getConfig() {
    return { ...this.config };
  }

  async updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
  }

  async setGitHubEnabled(enabled) {
    this.config.github.enabled = enabled;
  }

  // Test helper methods
  setStats(newStats) {
    this.stats = { ...this.stats, ...newStats };
  }

  addTestData(key, data) {
    this.data.set(key, {
      data,
      expiry: null,
      createdAt: new Date(),
      lastAccessed: new Date(),
      size: JSON.stringify(data).length
    });
  }
}

// Create global mock storage instance
let globalMockStorage = null;

export function createMockStorage() {
  if (!globalMockStorage) {
    globalMockStorage = new MockStorageProvider();
  }
  return globalMockStorage;
}

// Mock storage integration functions
export function createStorageIntegrationMocks() {
  const storage = createMockStorage();
  
  return {
    getStorage: () => storage,
    isStorageInitialized: () => storage.initialized,
    getStorageStats: () => storage.getStats(),
    getCircuitBreakerStatus: () => ({
      state: 'CLOSED',
      isOpen: false,
      requestsAllowed: true,
      failureCount: 0
    }),
    initializeStorage: async () => {
      await storage.initialize();
    },
    disposeStorage: async () => {
      await storage.dispose();
    }
  };
}