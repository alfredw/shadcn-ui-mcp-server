/**
 * Configuration Validation Tests
 * Tests the intent and behavior of configuration validation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SchemaValidator, BusinessRuleValidator } from '../../src/config/validators/index.js';
import { CacheConfiguration } from '../../src/config/schemas.js';

describe('Configuration Validation', () => {
  let schemaValidator: SchemaValidator;
  let businessValidator: BusinessRuleValidator;
  let validConfig: Partial<CacheConfiguration>;
  
  beforeEach(() => {
    schemaValidator = new SchemaValidator();
    businessValidator = new BusinessRuleValidator();
    
    validConfig = {
      storage: {
        type: 'hybrid',
        memory: {
          enabled: true,
          maxSize: 50 * 1024 * 1024,
          ttl: 3600,
          evictionPolicy: 'lru'
        },
        pglite: {
          enabled: true,
          maxSize: 100 * 1024 * 1024,
          enableWAL: true,
          busyTimeout: 5000,
          vacuumInterval: 24
        },
        github: {
          enabled: true,
          baseUrl: 'https://api.github.com',
          timeout: 30000,
          retries: 3
        }
      },
      cache: {
        strategy: 'read-through',
        ttl: {
          components: 7 * 24 * 60 * 60,
          blocks: 7 * 24 * 60 * 60,
          metadata: 60 * 60
        },
        prefetch: {
          enabled: true,
          popular: true,
          related: false
        },
        compression: {
          enabled: false,
          algorithm: 'gzip',
          level: 6
        }
      },
      performance: {
        batchSize: 100,
        concurrency: 10,
        queueSize: 1000,
        flushInterval: 5000
      },
      monitoring: {
        enabled: true,
        statsInterval: 5000,
        metricsRetention: 30,
        exporters: {
          prometheus: false,
          json: true
        },
        alerts: []
      },
      circuitBreaker: {
        enabled: true,
        threshold: 5,
        timeout: 60000,
        resetTimeout: 60000
      },
      features: {
        offlineMode: false,
        migration: true,
        analytics: true,
        autoSync: false,
        experimentalFeatures: []
      }
    };
  });

  describe('Schema Validation Intent', () => {
    it('should accept valid configuration', () => {
      const result = schemaValidator.validate(validConfig);
      
      // Intent: Valid configuration should pass
      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should reject invalid storage type', () => {
      const invalidConfig = {
        ...validConfig,
        storage: {
          ...validConfig.storage!,
          type: 'invalid-type' as any
        }
      };
      
      const result = schemaValidator.validate(invalidConfig);
      
      // Intent: Invalid enum values should be rejected
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.some(e => e.includes('storage.type'))).toBe(true);
    });

    it('should reject negative numbers', () => {
      const invalidConfig = {
        ...validConfig,
        storage: {
          ...validConfig.storage!,
          memory: {
            ...validConfig.storage!.memory!,
            maxSize: -1000
          }
        }
      };
      
      const result = schemaValidator.validate(invalidConfig);
      
      // Intent: Negative sizes should be rejected
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
    });

    it('should reject invalid URLs', () => {
      const invalidConfig = {
        ...validConfig,
        storage: {
          ...validConfig.storage!,
          github: {
            ...validConfig.storage!.github!,
            baseUrl: 'not-a-url'
          }
        }
      };
      
      const result = schemaValidator.validate(invalidConfig);
      
      // Intent: Invalid URLs should be rejected
      expect(result.valid).toBe(false);
      expect(result.errors!.some(e => e.includes('baseUrl'))).toBe(true);
    });

    it('should reject invalid compression levels', () => {
      const invalidConfig = {
        ...validConfig,
        cache: {
          ...validConfig.cache!,
          compression: {
            enabled: true,
            algorithm: 'gzip' as const,
            level: 15 // Invalid: must be 1-9
          }
        }
      };
      
      const result = schemaValidator.validate(invalidConfig);
      
      // Intent: Compression level out of range should be rejected
      expect(result.valid).toBe(false);
      expect(result.errors!.some(e => e.includes('level'))).toBe(true);
    });

    it('should accept partial configuration', () => {
      const partialConfig = {
        storage: {
          type: 'memory-only' as const
        }
      };
      
      const result = schemaValidator.validate(partialConfig);
      
      // Intent: Partial configurations should be valid
      expect(result.valid).toBe(true);
    });
  });

  describe('Business Rule Validation Intent', () => {
    it('should accept valid configuration', () => {
      const result = businessValidator.validate(validConfig);
      
      // Intent: Valid configuration should pass business rules
      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should reject memory size larger than PGLite size', () => {
      const invalidConfig = {
        ...validConfig,
        storage: {
          ...validConfig.storage!,
          memory: {
            ...validConfig.storage!.memory!,
            maxSize: 200 * 1024 * 1024 // Larger than PGLite
          },
          pglite: {
            ...validConfig.storage!.pglite!,
            maxSize: 100 * 1024 * 1024
          }
        }
      };
      
      const result = businessValidator.validate(invalidConfig);
      
      // Intent: Memory cache should not exceed PGLite cache size
      expect(result.valid).toBe(false);
      expect(result.errors!.some(e => e.includes('Memory cache size must be less than PGLite'))).toBe(true);
    });

    it('should require at least one storage provider enabled', () => {
      const invalidConfig = {
        storage: {
          type: 'hybrid' as const,
          memory: { enabled: false },
          pglite: { enabled: false },
          github: { enabled: false }
        }
      };
      
      const result = businessValidator.validate(invalidConfig);
      
      // Intent: At least one storage provider must be enabled
      expect(result.valid).toBe(false);
      expect(result.errors!.some(e => e.includes('At least one storage provider must be enabled'))).toBe(true);
    });

    it('should validate TTL relationships', () => {
      const invalidConfig = {
        ...validConfig,
        cache: {
          ...validConfig.cache!,
          ttl: {
            components: 3600,
            blocks: 3600,
            metadata: 7200 // Longer than components - invalid
          }
        }
      };
      
      const result = businessValidator.validate(invalidConfig);
      
      // Intent: Metadata TTL should not exceed component TTL
      expect(result.valid).toBe(false);
      expect(result.errors!.some(e => e.includes('Metadata TTL should not exceed'))).toBe(true);
    });

    it('should warn about excessive concurrency', () => {
      const invalidConfig = {
        ...validConfig,
        performance: {
          ...validConfig.performance!,
          concurrency: 100 // Too high
        }
      };
      
      const result = businessValidator.validate(invalidConfig);
      
      // Intent: Should warn about performance implications
      expect(result.valid).toBe(false);
      expect(result.errors!.some(e => e.includes('Concurrency should not exceed 50'))).toBe(true);
    });

    it('should validate GitHub token format', () => {
      const invalidConfig = {
        ...validConfig,
        storage: {
          ...validConfig.storage!,
          github: {
            ...validConfig.storage!.github!,
            enabled: true,
            token: 'invalid_token_format'
          }
        }
      };
      
      const result = businessValidator.validate(invalidConfig);
      
      // Intent: Should validate GitHub token format
      expect(result.valid).toBe(false);
      expect(result.errors!.some(e => e.includes('GitHub token format appears invalid'))).toBe(true);
    });

    it('should validate storage type consistency', () => {
      const invalidConfig = {
        storage: {
          type: 'memory-only' as const,
          memory: { enabled: false } // Inconsistent with type
        }
      };
      
      const result = businessValidator.validate(invalidConfig);
      
      // Intent: Storage type should be consistent with enabled providers
      expect(result.valid).toBe(false);
      expect(result.errors!.some(e => e.includes('Memory storage must be enabled when type is "memory-only"'))).toBe(true);
    });

    it('should validate circuit breaker timeout relationship', () => {
      const invalidConfig = {
        ...validConfig,
        circuitBreaker: {
          enabled: true,
          threshold: 5,
          timeout: 60000,
          resetTimeout: 30000 // Should be >= timeout
        }
      };
      
      const result = businessValidator.validate(invalidConfig);
      
      // Intent: Reset timeout should be reasonable relative to timeout
      expect(result.valid).toBe(false);
      expect(result.errors!.some(e => e.includes('Circuit breaker reset timeout should be greater than'))).toBe(true);
    });
  });

  describe('Validation Error Messages Intent', () => {
    it('should provide clear error messages', () => {
      const invalidConfig = {
        storage: {
          type: 'invalid' as any,
          memory: {
            maxSize: -100
          }
        }
      };
      
      const result = schemaValidator.validate(invalidConfig);
      
      // Intent: Error messages should be clear and actionable
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
      
      // Intent: Should include path information
      result.errors!.forEach(error => {
        expect(typeof error).toBe('string');
        expect(error.length).toBeGreaterThan(0);
      });
    });

    it('should provide specific validation context', () => {
      const invalidConfig = {
        storage: {
          memory: {
            enabled: true,
            maxSize: 200 * 1024 * 1024
          },
          pglite: {
            enabled: true,
            maxSize: 100 * 1024 * 1024
          }
        }
      };
      
      const result = businessValidator.validate(invalidConfig);
      
      // Intent: Business rule errors should explain the problem
      expect(result.valid).toBe(false);
      const error = result.errors!.find(e => e.includes('Memory cache size'));
      expect(error).toBeDefined();
      expect(error).toContain('less than PGLite');
    });
  });

  describe('Validation Performance Intent', () => {
    it('should validate efficiently', () => {
      const startTime = Date.now();
      
      // Run validation multiple times
      for (let i = 0; i < 100; i++) {
        schemaValidator.validate(validConfig);
        businessValidator.validate(validConfig);
      }
      
      const duration = Date.now() - startTime;
      
      // Intent: Validation should be fast enough for real-time use
      expect(duration).toBeLessThan(1000); // Less than 1 second for 100 validations
    });
  });

  describe('Validator Integration Intent', () => {
    it('should have consistent naming', () => {
      // Intent: Validators should have descriptive names
      expect(schemaValidator.name).toBe('SchemaValidator');
      expect(businessValidator.name).toBe('BusinessRuleValidator');
    });

    it('should be composable', () => {
      const validators = [schemaValidator, businessValidator];
      
      // Intent: Should be able to run multiple validators
      const results = validators.map(validator => validator.validate(validConfig));
      
      expect(results.every(r => r.valid)).toBe(true);
    });
  });
});