import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { StorageCircuitBreaker } from '../../../build/storage/index.js';
import { CircuitBreakerState } from '../../../build/utils/circuit-breaker.js';

// Simple mock function implementation since Node.js test runner doesn't have built-in mocking
function createMock(returnValue) {
  let calls = 0;
  let callArgs = [];
  
  const mockFn = (...args) => {
    calls++;
    callArgs.push(args);
    if (typeof returnValue === 'function') {
      return returnValue(...args);
    }
    return returnValue;
  };
  
  mockFn.mockResolvedValue = (value) => {
    returnValue = Promise.resolve(value);
    return mockFn;
  };
  
  mockFn.mockRejectedValue = (error) => {
    returnValue = Promise.reject(error);
    return mockFn;
  };
  
  mockFn.toHaveBeenCalled = () => calls > 0;
  mockFn.toHaveBeenCalledTimes = (expectedCalls) => calls === expectedCalls;
  mockFn.callCount = () => calls;
  
  return mockFn;
}

describe('StorageCircuitBreaker', () => {
  let circuitBreaker;
  
  beforeEach(() => {
    circuitBreaker = new StorageCircuitBreaker({
      threshold: 3,
      timeout: 1000, // 1 second for faster tests
      successThreshold: 2
    });
  });
  
  describe('Initial State', () => {
    it('should start in CLOSED state', () => {
      assert.strictEqual(circuitBreaker.getState(), CircuitBreakerState.CLOSED);
      assert.strictEqual(circuitBreaker.allowsRequest(), true);
    });
    
    it('should provide initial status', () => {
      const status = circuitBreaker.getStatus();
      
      assert.strictEqual(status.state, CircuitBreakerState.CLOSED);
      assert.strictEqual(status.failureCount, 0);
      assert.strictEqual(status.isRequestAllowed, true);
    });
    
    it('should provide state description', () => {
      const description = circuitBreaker.getStateDescription();
      assert.ok(description.includes('Closed'));
      assert.ok(description.includes('Operating normally'));
    });
  });
  
  describe('Failure Handling', () => {
    it('should record failures manually', async () => {
      assert.strictEqual(circuitBreaker.getFailureCount(), 0);
      
      await circuitBreaker.recordFailure();
      assert.strictEqual(circuitBreaker.getFailureCount(), 1);
      
      await circuitBreaker.recordFailure();
      assert.strictEqual(circuitBreaker.getFailureCount(), 2);
    });
    
    it('should open after threshold failures', async () => {
      // Record failures up to threshold (3)
      await circuitBreaker.recordFailure();
      await circuitBreaker.recordFailure();
      assert.strictEqual(circuitBreaker.getState(), CircuitBreakerState.CLOSED);
      
      await circuitBreaker.recordFailure();
      assert.strictEqual(circuitBreaker.getState(), CircuitBreakerState.OPEN);
      assert.strictEqual(circuitBreaker.allowsRequest(), false);
    });
    
    it('should provide open state description', async () => {
      // Trigger opening
      for (let i = 0; i < 3; i++) {
        await circuitBreaker.recordFailure();
      }
      
      const description = circuitBreaker.getStateDescription();
      assert.ok(description.includes('Open'));
      assert.ok(description.includes('Failing fast'));
    });
  });
  
  describe('Recovery Process', () => {
    it('should transition to HALF_OPEN after timeout', async () => {
      // Open the circuit breaker
      for (let i = 0; i < 3; i++) {
        await circuitBreaker.recordFailure();
      }
      assert.strictEqual(circuitBreaker.getState(), CircuitBreakerState.OPEN);
      
      // Wait for timeout period
      await new Promise(resolve => setTimeout(resolve, 1100)); // Slightly more than 1000ms timeout
      
      // Should now allow requests (transitioning to HALF_OPEN)
      assert.strictEqual(circuitBreaker.allowsRequest(), true);
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
      
      assert.strictEqual(circuitBreaker.getState(), CircuitBreakerState.CLOSED);
      assert.strictEqual(circuitBreaker.getFailureCount(), 0);
    });
    
    it('should reopen on failure in HALF_OPEN state', async () => {
      // Open the circuit breaker
      for (let i = 0; i < 3; i++) {
        await circuitBreaker.recordFailure();
      }
      
      // Wait for timeout to allow transition to HALF_OPEN
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      // First request should be allowed (HALF_OPEN)
      assert.strictEqual(circuitBreaker.allowsRequest(), true);
      
      // Failure in HALF_OPEN should reopen the circuit
      await circuitBreaker.recordFailure();
      assert.strictEqual(circuitBreaker.getState(), CircuitBreakerState.OPEN);
      assert.strictEqual(circuitBreaker.allowsRequest(), false);
    });
  });
  
  describe('Manual Control', () => {
    it('should open manually', () => {
      assert.strictEqual(circuitBreaker.allowsRequest(), true);
      
      circuitBreaker.open();
      assert.strictEqual(circuitBreaker.allowsRequest(), false);
      
      const description = circuitBreaker.getStateDescription();
      assert.ok(description.includes('Manually opened'));
    });
    
    it('should close manually', async () => {
      // First open it (either manually or through failures)
      circuitBreaker.open();
      assert.strictEqual(circuitBreaker.allowsRequest(), false);
      
      // Close manually
      circuitBreaker.close();
      assert.strictEqual(circuitBreaker.allowsRequest(), true);
      assert.strictEqual(circuitBreaker.getState(), CircuitBreakerState.CLOSED);
      assert.strictEqual(circuitBreaker.getFailureCount(), 0);
    });
    
    it('should reset state when closed manually', async () => {
      // Build up some failures
      await circuitBreaker.recordFailure();
      await circuitBreaker.recordFailure();
      assert.strictEqual(circuitBreaker.getFailureCount(), 2);
      
      // Manual close should reset everything
      circuitBreaker.close();
      assert.strictEqual(circuitBreaker.getFailureCount(), 0);
      assert.strictEqual(circuitBreaker.getState(), CircuitBreakerState.CLOSED);
    });
  });
  
  describe('Execute with Fallback', () => {
    it('should execute operation when circuit is closed', async () => {
      const operation = createMock().mockResolvedValue('success');
      const fallback = createMock().mockResolvedValue('fallback');
      
      const result = await circuitBreaker.executeWithFallback(operation, fallback);
      
      assert.strictEqual(result, 'success');
      assert.ok(operation.toHaveBeenCalled());
      assert.ok(!fallback.toHaveBeenCalled());
    });
    
    it('should use fallback when circuit is open', async () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        await circuitBreaker.recordFailure();
      }
      
      const operation = createMock().mockResolvedValue('success');
      const fallback = createMock().mockResolvedValue('fallback');
      
      const result = await circuitBreaker.executeWithFallback(operation, fallback);
      
      assert.strictEqual(result, 'fallback');
      assert.ok(!operation.toHaveBeenCalled());
      assert.ok(fallback.toHaveBeenCalled());
    });
    
    it('should throw error when circuit is open and no fallback provided', async () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        await circuitBreaker.recordFailure();
      }
      
      const operation = createMock().mockResolvedValue('success');
      
      await assert.rejects(circuitBreaker.executeWithFallback(operation));
      assert.ok(!operation.toHaveBeenCalled());
    });
    
    it('should use fallback when operation fails', async () => {
      const operation = createMock().mockRejectedValue(new Error('Operation failed'));
      const fallback = createMock().mockResolvedValue('fallback success');
      
      const result = await circuitBreaker.executeWithFallback(operation, fallback);
      
      assert.strictEqual(result, 'fallback success');
      assert.ok(operation.toHaveBeenCalled());
      assert.ok(fallback.toHaveBeenCalled());
    });
    
    it('should throw original error if both operation and fallback fail', async () => {
      const originalError = new Error('Original operation failed');
      const operation = createMock().mockRejectedValue(originalError);
      const fallback = createMock().mockRejectedValue(new Error('Fallback failed'));
      
      await assert.rejects(
        circuitBreaker.executeWithFallback(operation, fallback),
        /Original operation failed/
      );
      
      assert.ok(operation.toHaveBeenCalled());
      assert.ok(fallback.toHaveBeenCalled());
    });
  });
  
  describe('Status and Monitoring', () => {
    it('should provide detailed status information', async () => {
      // Record some failures
      await circuitBreaker.recordFailure();
      await circuitBreaker.recordFailure();
      
      const status = circuitBreaker.getStatus();
      
      assert.strictEqual(status.state, CircuitBreakerState.CLOSED);
      assert.strictEqual(status.failureCount, 2);
      assert.strictEqual(status.isRequestAllowed, true);
      assert.ok(status.lastFailureTime !== undefined);
      assert.strictEqual(typeof status.lastFailureTime, 'number');
    });
    
    it('should track last failure time', async () => {
      const beforeFailure = Date.now();
      await circuitBreaker.recordFailure();
      const afterFailure = Date.now();
      
      const status = circuitBreaker.getStatus();
      assert.ok(status.lastFailureTime >= beforeFailure);
      assert.ok(status.lastFailureTime <= afterFailure);
    });
    
    it('should provide appropriate state descriptions for all states', async () => {
      // Test CLOSED state description
      let description = circuitBreaker.getStateDescription();
      assert.ok(description.includes('Closed'));
      
      // Test OPEN state description
      for (let i = 0; i < 3; i++) {
        await circuitBreaker.recordFailure();
      }
      description = circuitBreaker.getStateDescription();
      assert.ok(description.includes('Open'));
      assert.ok(description.includes('Failing fast'));
      
      // Test manual override description
      circuitBreaker.close();
      circuitBreaker.open();
      description = circuitBreaker.getStateDescription();
      assert.ok(description.includes('Manually opened'));
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
      assert.strictEqual(circuitBreaker.getState(), CircuitBreakerState.OPEN);
      assert.ok(circuitBreaker.getFailureCount() >= 3);
    });
    
    it('should handle mixed success and failure patterns', async () => {
      // Pattern: fail, succeed, fail, fail, fail
      await circuitBreaker.recordFailure();
      await circuitBreaker.recordSuccess();
      await circuitBreaker.recordFailure();
      await circuitBreaker.recordFailure();
      await circuitBreaker.recordFailure();
      
      // Should be open due to consecutive failures
      assert.strictEqual(circuitBreaker.getState(), CircuitBreakerState.OPEN);
    });
    
    it('should reset failure count on successful operations', async () => {
      // Build up failures just below threshold
      await circuitBreaker.recordFailure();
      await circuitBreaker.recordFailure();
      assert.strictEqual(circuitBreaker.getFailureCount(), 2);
      
      // Success should reset counter
      await circuitBreaker.recordSuccess();
      assert.strictEqual(circuitBreaker.getFailureCount(), 0);
      assert.strictEqual(circuitBreaker.getState(), CircuitBreakerState.CLOSED);
    });
  });
});