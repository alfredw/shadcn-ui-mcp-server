/**
 * Business rule validator for configuration logic
 */

import { ConfigValidator, ValidationResult, CacheConfiguration } from '../schemas.js';

export class BusinessRuleValidator implements ConfigValidator {
  readonly name = 'BusinessRuleValidator';
  
  validate(config: Partial<CacheConfiguration>): ValidationResult {
    const errors: string[] = [];
    
    // Memory size must be less than PGLite size (only when both are enabled)
    if (config.storage?.memory?.enabled && config.storage?.pglite?.enabled &&
        config.storage?.memory?.maxSize && config.storage?.pglite?.maxSize) {
      if (config.storage.memory.maxSize >= config.storage.pglite.maxSize) {
        errors.push('Memory cache size must be less than PGLite cache size');
      }
    }
    
    // At least one storage provider must be enabled
    if (config.storage) {
      const enabledProviders = [
        config.storage.memory?.enabled,
        config.storage.pglite?.enabled,
        config.storage.github?.enabled
      ].filter(Boolean);
      
      if (enabledProviders.length === 0) {
        errors.push('At least one storage provider must be enabled');
      }
    }
    
    // TTL validation
    if (config.cache?.ttl) {
      const { components, blocks, metadata } = config.cache.ttl;
      
      if (metadata && components && metadata > components) {
        errors.push('Metadata TTL should not exceed component TTL');
      }
      
      if (metadata && blocks && metadata > blocks) {
        errors.push('Metadata TTL should not exceed block TTL');
      }
    }
    
    // Performance validation
    if (config.performance) {
      if (config.performance.concurrency && config.performance.concurrency > 50) {
        errors.push('Concurrency should not exceed 50 for optimal performance');
      }
      
      if (config.performance.batchSize && config.performance.batchSize > 1000) {
        errors.push('Batch size should not exceed 1000 for memory efficiency');
      }
    }
    
    // GitHub token validation (if provided)
    if (config.storage?.github?.enabled && config.storage.github.token) {
      const token = config.storage.github.token;
      if (!token.startsWith('ghp_') && !token.startsWith('github_pat_')) {
        errors.push('GitHub token format appears invalid (should start with ghp_ or github_pat_)');
      }
    }
    
    // Compression level validation
    if (config.cache?.compression?.enabled && config.cache.compression.level) {
      const level = config.cache.compression.level;
      if (level < 1 || level > 9) {
        errors.push('Compression level must be between 1 and 9');
      }
    }
    
    // Circuit breaker timeout validation
    if (config.circuitBreaker) {
      const { timeout, resetTimeout } = config.circuitBreaker;
      if (timeout && resetTimeout && resetTimeout < timeout) {
        errors.push('Circuit breaker reset timeout should be greater than or equal to timeout');
      }
    }
    
    // Storage type consistency validation
    if (config.storage?.type) {
      const { type, memory, pglite } = config.storage;
      
      if (type === 'memory-only' && memory?.enabled === false) {
        errors.push('Memory storage must be enabled when type is "memory-only"');
      }
      
      if (type === 'pglite-only' && pglite?.enabled === false) {
        errors.push('PGLite storage must be enabled when type is "pglite-only"');
      }
      
      if (type === 'hybrid' && memory?.enabled === false && pglite?.enabled === false) {
        errors.push('At least one cache tier must be enabled for hybrid storage');
      }
    }
    
    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined
    };
  }
}