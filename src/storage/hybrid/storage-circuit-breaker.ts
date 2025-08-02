import { CircuitBreaker, CircuitBreakerState } from '../../utils/circuit-breaker.js';

/**
 * Circuit breaker status information
 */
export interface CircuitBreakerStatus {
  state: CircuitBreakerState;
  failureCount: number;
  isRequestAllowed: boolean;
  lastFailureTime?: number;
}

/**
 * Configuration for the storage circuit breaker
 */
export interface StorageCircuitBreakerConfig {
  threshold?: number;
  timeout?: number;
  successThreshold?: number;
}

/**
 * Storage-specific circuit breaker that extends the base CircuitBreaker
 * to provide granular control for storage operations
 */
export class StorageCircuitBreaker extends CircuitBreaker {
  private isManuallyOpen: boolean = false;
  
  constructor(config: StorageCircuitBreakerConfig = {}) {
    super({
      failureThreshold: config.threshold || 5,
      timeout: config.timeout || 60000, // 1 minute
      successThreshold: config.successThreshold || 2
    });
  }
  
  /**
   * Check if a request should be allowed without executing it
   * This enables checking state before making storage decisions
   */
  allowsRequest(): boolean {
    if (this.isManuallyOpen) {
      return false;
    }
    
    const state = this.getState();
    
    if (state === CircuitBreakerState.CLOSED) {
      return true;
    }
    
    if (state === CircuitBreakerState.OPEN) {
      // Check if enough time has passed to attempt recovery
      if (this.shouldTransitionToHalfOpen()) {
        return true;
      }
      return false;
    }
    
    // HALF_OPEN: allow request to test recovery
    return true;
  }
  
  /**
   * Manually record a successful operation
   * Used when we need to record success outside of execute()
   */
  async recordSuccess(): Promise<void> {
    // Use execute with a no-op to trigger success handling
    await this.execute(async () => {
      // No-op function to trigger success recording
    });
  }
  
  /**
   * Manually record a failed operation
   * Used when we need to record failure outside of execute()
   */
  async recordFailure(): Promise<void> {
    try {
      await this.execute(async () => {
        throw new Error('Manual failure recording');
      });
    } catch {
      // Expected - we're intentionally triggering failure
    }
  }
  
  /**
   * Manually open the circuit breaker
   * Useful for maintenance or emergency situations
   */
  open(): void {
    this.isManuallyOpen = true;
  }
  
  /**
   * Manually close the circuit breaker
   * Resets manual override and circuit breaker state
   */
  close(): void {
    this.isManuallyOpen = false;
    this.reset();
  }
  
  /**
   * Check if circuit should attempt to transition to half-open
   */
  private shouldTransitionToHalfOpen(): boolean {
    // Access private members through careful property access
    const lastFailureTime = (this as any).lastFailureTime;
    const timeout = (this as any).config?.timeout || 60000;
    
    if (typeof lastFailureTime !== 'number') {
      return false;
    }
    
    return Date.now() - lastFailureTime >= timeout;
  }
  
  /**
   * Get detailed circuit breaker status for monitoring
   */
  getStatus(): CircuitBreakerStatus {
    const lastFailureTime = (this as any).lastFailureTime;
    
    return {
      state: this.getState(),
      failureCount: this.getFailureCount(),
      isRequestAllowed: this.allowsRequest(),
      lastFailureTime: typeof lastFailureTime === 'number' ? lastFailureTime : undefined
    };
  }
  
  /**
   * Get a human-readable description of the current state
   */
  getStateDescription(): string {
    const status = this.getStatus();
    
    if (this.isManuallyOpen) {
      return 'Manually opened for maintenance';
    }
    
    switch (status.state) {
      case CircuitBreakerState.CLOSED:
        return `Closed - Operating normally (${status.failureCount} failures)`;
      case CircuitBreakerState.OPEN:
        const timeRemaining = status.lastFailureTime 
          ? Math.max(0, ((this as any).config?.timeout || 60000) - (Date.now() - status.lastFailureTime))
          : 0;
        return `Open - Failing fast (${Math.ceil(timeRemaining / 1000)}s until retry)`;
      case CircuitBreakerState.HALF_OPEN:
        return 'Half-open - Testing recovery';
      default:
        return 'Unknown state';
    }
  }
  
  /**
   * Execute an operation with circuit breaker protection and enhanced error handling
   */
  async executeWithFallback<T>(
    operation: () => Promise<T>,
    fallback?: () => Promise<T>
  ): Promise<T> {
    if (!this.allowsRequest()) {
      if (fallback) {
        return await fallback();
      }
      throw new Error(`Circuit breaker is open: ${this.getStateDescription()}`);
    }
    
    try {
      const result = await this.execute(operation);
      return result;
    } catch (error) {
      if (fallback) {
        try {
          return await fallback();
        } catch (fallbackError) {
          // If fallback also fails, throw the original error
          throw error;
        }
      }
      throw error;
    }
  }
}