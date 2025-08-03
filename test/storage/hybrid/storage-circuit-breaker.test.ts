/**
 * Storage Circuit Breaker Tests - Vitest Edition
 * Converted from Node.js native test to Vitest
 */

import { describe, it, beforeEach, vi } from 'vitest';
import { expect } from 'vitest';
import { StorageCircuitBreaker } from '../../../build/storage/index.js';
import { CircuitBreakerState } from '../../../build/utils/circuit-breaker.js';

describe('StorageCircuitBreaker', () => {
  let circuitBreaker: StorageCircuitBreaker;
  
  beforeEach(() => {
    circuitBreaker = new StorageCircuitBreaker({
      threshold: 3,
      timeout: 1000, // 1 second for faster tests
      successThreshold: 2
    });
  });
  
  describe('Initial State', () => {
    it('should start in CLOSED state', () => {
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);
      expect(circuitBreaker.allowsRequest()).toBe(true);
    });
    
    it('should provide initial status', () => {
      const status = circuitBreaker.getStatus();
      
      expect(status.state).toBe(CircuitBreakerState.CLOSED);
      expect(status.failureCount).toBe(0);
      expect(status.isRequestAllowed).toBe(true);
    });
    
    it('should provide state description', () => {
      const description = circuitBreaker.getStateDescription();
      expect(description).toContain('Closed');
      expect(description).toContain('Operating normally');
    });
  });
  
  describe('Failure Handling', () => {
    it('should record failures manually', async () => {
      expect(circuitBreaker.getFailureCount()).toBe(0);
      
      await circuitBreaker.recordFailure();
      expect(circuitBreaker.getFailureCount()).toBe(1);
      
      await circuitBreaker.recordFailure();
      expect(circuitBreaker.getFailureCount()).toBe(2);
    });
    
    it('should open after threshold failures', async () => {
      // Record failures up to threshold (3)
      await circuitBreaker.recordFailure();
      await circuitBreaker.recordFailure();
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);
      
      await circuitBreaker.recordFailure();
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.OPEN);
      expect(circuitBreaker.allowsRequest()).toBe(false);
    });
    
    it('should provide open state description', async () => {
      // Trigger opening
      for (let i = 0; i < 3; i++) {
        await circuitBreaker.recordFailure();
      }
      
      const description = circuitBreaker.getStateDescription();
      expect(description).toContain('Open');
      expect(description).toContain('Failing fast');
    });
  });
  
  describe('Recovery Process', () => {
    it('should transition to HALF_OPEN after timeout', async () => {
      // Open the circuit breaker
      for (let i = 0; i < 3; i++) {
        await circuitBreaker.recordFailure();
      }
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.OPEN);
      
      // Wait for timeout period
      await new Promise(resolve => setTimeout(resolve, 1100)); // Slightly more than 1000ms timeout
      
      // Should now allow requests (transitioning to HALF_OPEN)
      expect(circuitBreaker.allowsRequest()).toBe(true);
    });
    
    it('should close after successful operations in HALF_OPEN', async () => {
      // Open the circuit breaker
      for (let i = 0; i < 3; i++) {
        await circuitBreaker.recordFailure();
      }
      
      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      // Record successful operations (threshold is 2)
      await circuitBreaker.recordSuccess();
      await circuitBreaker.recordSuccess();
      
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);
      expect(circuitBreaker.getFailureCount()).toBe(0);
    });
    
    it('should reopen on failure in HALF_OPEN state', async () => {
      // Open the circuit breaker
      for (let i = 0; i < 3; i++) {
        await circuitBreaker.recordFailure();
      }
      
      // Wait for timeout to allow transition to HALF_OPEN
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      // First request should be allowed (HALF_OPEN)
      expect(circuitBreaker.allowsRequest()).toBe(true);
      
      // Failure in HALF_OPEN should reopen the circuit
      await circuitBreaker.recordFailure();
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.OPEN);
      expect(circuitBreaker.allowsRequest()).toBe(false);
    });
  });
  
  describe('Manual Control', () => {
    it('should open manually', () => {
      expect(circuitBreaker.allowsRequest()).toBe(true);
      
      circuitBreaker.open();
      expect(circuitBreaker.allowsRequest()).toBe(false);
      
      const description = circuitBreaker.getStateDescription();
      expect(description).toContain('Manually opened');
    });
    
    it('should close manually', async () => {
      // First open it (either manually or through failures)
      circuitBreaker.open();
      expect(circuitBreaker.allowsRequest()).toBe(false);
      
      // Close manually
      circuitBreaker.close();
      expect(circuitBreaker.allowsRequest()).toBe(true);
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);
      expect(circuitBreaker.getFailureCount()).toBe(0);
    });
    
    it('should reset state when closed manually', async () => {
      // Build up some failures
      await circuitBreaker.recordFailure();
      await circuitBreaker.recordFailure();
      expect(circuitBreaker.getFailureCount()).toBe(2);
      
      // Manual close should reset everything
      circuitBreaker.close();
      expect(circuitBreaker.getFailureCount()).toBe(0);
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);
    });
  });
  
  describe('Execute with Fallback', () => {
    it('should execute operation when circuit is closed', async () => {
      const operation = vi.fn().mockResolvedValue('success');
      const fallback = vi.fn().mockResolvedValue('fallback');
      
      const result = await circuitBreaker.executeWithFallback(operation, fallback);
      
      expect(result).toBe('success');
      expect(operation).toHaveBeenCalled();
      expect(fallback).not.toHaveBeenCalled();
    });
    
    it('should use fallback when circuit is open', async () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        await circuitBreaker.recordFailure();
      }
      
      const operation = vi.fn().mockResolvedValue('success');
      const fallback = vi.fn().mockResolvedValue('fallback');
      
      const result = await circuitBreaker.executeWithFallback(operation, fallback);
      
      expect(result).toBe('fallback');
      expect(operation).not.toHaveBeenCalled();
      expect(fallback).toHaveBeenCalled();
    });
    
    it('should throw error when circuit is open and no fallback provided', async () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        await circuitBreaker.recordFailure();
      }
      
      const operation = vi.fn().mockResolvedValue('success');
      
      await expect(circuitBreaker.executeWithFallback(operation)).rejects.toThrow();
      expect(operation).not.toHaveBeenCalled();
    });
    
    it('should use fallback when operation fails', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('Operation failed'));
      const fallback = vi.fn().mockResolvedValue('fallback success');
      
      const result = await circuitBreaker.executeWithFallback(operation, fallback);
      
      expect(result).toBe('fallback success');
      expect(operation).toHaveBeenCalled();
      expect(fallback).toHaveBeenCalled();
    });
    
    it('should throw original error if both operation and fallback fail', async () => {
      const originalError = new Error('Original operation failed');
      const operation = vi.fn().mockRejectedValue(originalError);
      const fallback = vi.fn().mockRejectedValue(new Error('Fallback failed'));
      
      await expect(
        circuitBreaker.executeWithFallback(operation, fallback)
      ).rejects.toThrow('Original operation failed');
      
      expect(operation).toHaveBeenCalled();
      expect(fallback).toHaveBeenCalled();
    });
  });
  
  describe('Status and Monitoring', () => {
    it('should provide detailed status information', async () => {
      // Record some failures
      await circuitBreaker.recordFailure();
      await circuitBreaker.recordFailure();
      
      const status = circuitBreaker.getStatus();
      
      expect(status.state).toBe(CircuitBreakerState.CLOSED);
      expect(status.failureCount).toBe(2);
      expect(status.isRequestAllowed).toBe(true);
      expect(status.lastFailureTime).toBeDefined();
      expect(typeof status.lastFailureTime).toBe('number');
    });
    
    it('should track last failure time', async () => {
      const beforeFailure = Date.now();
      await circuitBreaker.recordFailure();
      const afterFailure = Date.now();
      
      const status = circuitBreaker.getStatus();
      expect(status.lastFailureTime).toBeGreaterThanOrEqual(beforeFailure);
      expect(status.lastFailureTime).toBeLessThanOrEqual(afterFailure);
    });
    
    it('should provide appropriate state descriptions for all states', async () => {
      // Test CLOSED state description
      let description = circuitBreaker.getStateDescription();
      expect(description).toContain('Closed');
      
      // Test OPEN state description
      for (let i = 0; i < 3; i++) {
        await circuitBreaker.recordFailure();
      }
      description = circuitBreaker.getStateDescription();
      expect(description).toContain('Open');
      expect(description).toContain('Failing fast');
      
      // Test manual override description
      circuitBreaker.close();
      circuitBreaker.open();
      description = circuitBreaker.getStateDescription();
      expect(description).toContain('Manually opened');
    });
  });
  
  describe('Edge Cases', () => {
    it('should handle rapid successive failures', async () => {
      const promises = [];
      
      // Record 5 failures rapidly
      for (let i = 0; i < 5; i++) {
        promises.push(circuitBreaker.recordFailure());
      }
      
      await Promise.all(promises);
      
      // Should be open after threshold (3)
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.OPEN);
      expect(circuitBreaker.getFailureCount()).toBeGreaterThanOrEqual(3);
    });
    
    it('should handle mixed success and failure patterns', async () => {
      // Pattern: fail, succeed, fail, fail, fail
      await circuitBreaker.recordFailure();
      await circuitBreaker.recordSuccess();
      await circuitBreaker.recordFailure();
      await circuitBreaker.recordFailure();
      await circuitBreaker.recordFailure();
      
      // Should be open due to consecutive failures
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.OPEN);
    });
    
    it('should reset failure count on successful operations', async () => {
      // Build up failures just below threshold
      await circuitBreaker.recordFailure();
      await circuitBreaker.recordFailure();
      expect(circuitBreaker.getFailureCount()).toBe(2);
      
      // Success should reset counter
      await circuitBreaker.recordSuccess();
      expect(circuitBreaker.getFailureCount()).toBe(0);
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);
    });
  });
});