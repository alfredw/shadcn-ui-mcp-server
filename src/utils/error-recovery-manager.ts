/**
 * Advanced Error Recovery Manager
 * 
 * Implements robust error recovery mechanisms with multi-level retry strategies,
 * exponential backoff, and circuit breaker integration for storage tiers.
 */

import { CircuitBreaker, CircuitBreakerState } from './circuit-breaker.js';
import { ConfigurationManager } from '../config/manager.js';
import { logger } from './logger.js';

/**
 * Recovery strategy configuration
 */
export interface RecoveryStrategy {
  maxRetries: number;
  backoffMs: number;
  backoffMultiplier: number;
  maxBackoffMs: number;
  fallbackAction?: () => Promise<any>;
}

/**
 * Context for recovery operations
 */
export interface RecoveryContext {
  key: string;
  tier: string;
  strategy?: Partial<RecoveryStrategy>;
}

/**
 * Error information for tracking
 */
export interface ErrorInfo {
  key: string;
  error: string;
  timestamp: number;
  stack?: string;
}

/**
 * Error summary for reporting
 */
export interface ErrorSummary {
  tiers: Record<string, {
    total: number;
    recent: number;
    circuitBreakerState: string;
  }>;
  totalErrors: number;
  recentErrors: ErrorInfo[];
}

/**
 * Circuit breaker open error
 */
export class CircuitOpenError extends Error {
  constructor(message: string, public tier: string) {
    super(message);
    this.name = 'CircuitOpenError';
  }
}

/**
 * Recovery failed error
 */
export class RecoveryFailedError extends Error {
  constructor(
    message: string,
    public key: string,
    public retries: number,
    public lastError?: Error
  ) {
    super(message);
    this.name = 'RecoveryFailedError';
  }
}

/**
 * Error Recovery Manager
 * 
 * Manages multi-level retry strategies with exponential backoff and
 * circuit breaker protection for storage tiers.
 */
export class ErrorRecoveryManager {
  private retryCounters = new Map<string, number>();
  private circuitBreakers = new Map<string, CircuitBreaker>();
  private lastErrors = new Map<string, ErrorInfo[]>();
  
  constructor(
    private config?: ConfigurationManager
  ) {
    this.initializeCircuitBreakers();
  }
  
  /**
   * Initialize circuit breakers for storage tiers
   */
  private initializeCircuitBreakers(): void {
    // Memory tier circuit breaker - more tolerant since it's local
    this.circuitBreakers.set('memory', new CircuitBreaker({
      failureThreshold: 5,
      timeout: 30000,  // 30 seconds
      successThreshold: 2
    }));
    
    // PGLite tier circuit breaker - moderate tolerance
    this.circuitBreakers.set('pglite', new CircuitBreaker({
      failureThreshold: 3,
      timeout: 60000,  // 1 minute
      successThreshold: 2
    }));
    
    // GitHub tier circuit breaker - less tolerant for external API
    this.circuitBreakers.set('github', new CircuitBreaker({
      failureThreshold: 2,
      timeout: 120000, // 2 minutes
      successThreshold: 3
    }));
  }
  
  /**
   * Execute operation with recovery logic
   */
  async executeWithRecovery<T>(
    operation: () => Promise<T>,
    context: RecoveryContext
  ): Promise<T> {
    const strategy: RecoveryStrategy = {
      maxRetries: 3,
      backoffMs: 1000,
      backoffMultiplier: 2,
      maxBackoffMs: 30000,
      ...context.strategy
    };
    
    const circuitBreaker = this.circuitBreakers.get(context.tier);
    
    // Check circuit breaker
    if (circuitBreaker && this.isCircuitOpen(circuitBreaker)) {
      throw new CircuitOpenError(
        `Circuit breaker open for ${context.tier}`,
        context.tier
      );
    }
    
    let lastError: Error | null = null;
    let retries = 0;
    
    while (retries <= strategy.maxRetries) {
      try {
        const result = await operation();
        
        // Success - reset retry counter and record success
        this.retryCounters.delete(context.key);
        circuitBreaker?.onSuccess();
        
        return result;
        
      } catch (error) {
        lastError = error as Error;
        
        // Record error
        this.recordError(context.key, context.tier, error as Error);
        circuitBreaker?.onFailure();
        
        // Check if we should retry
        if (!this.shouldRetry(error as Error, retries, strategy)) {
          break;
        }
        
        // Calculate backoff
        const backoffMs = Math.min(
          strategy.backoffMs * Math.pow(strategy.backoffMultiplier, retries),
          strategy.maxBackoffMs
        );
        
        logger.warn(
          `Retry ${retries + 1}/${strategy.maxRetries} for ${context.key} after ${backoffMs}ms: ${(error as Error).message}`
        );
        
        // Wait before retry
        await this.delay(backoffMs);
        retries++;
      }
    }
    
    // All retries exhausted
    if (strategy.fallbackAction) {
      logger.info(`Executing fallback action for ${context.key}`);
      try {
        return await strategy.fallbackAction();
      } catch (fallbackError) {
        logger.error(`Fallback action failed for ${context.key}`, fallbackError);
        // Continue to throw recovery failed error
      }
    }
    
    throw new RecoveryFailedError(
      `Failed after ${retries} retries: ${lastError?.message}`,
      context.key,
      retries,
      lastError || undefined
    );
  }
  
  /**
   * Check if circuit breaker is open (with private method access workaround)
   */
  private isCircuitOpen(circuitBreaker: CircuitBreaker): boolean {
    return circuitBreaker.getState() === CircuitBreakerState.OPEN;
  }
  
  /**
   * Determine if error should be retried
   */
  private shouldRetry(error: Error, retries: number, strategy: RecoveryStrategy): boolean {
    // Don't retry if max retries reached
    if (retries >= strategy.maxRetries) return false;
    
    // Check error type
    if (error instanceof CircuitOpenError) return false;
    if (error.message.includes('404')) return false; // Not found
    if (error.message.includes('401')) return false; // Unauthorized
    if (error.message.includes('403')) return false; // Forbidden
    
    // Retry on network errors, timeouts, 5xx errors
    if (error.message.includes('ECONNREFUSED')) return true;
    if (error.message.includes('ETIMEDOUT')) return true;
    if (error.message.includes('ENOTFOUND')) return true;
    if (error.message.includes('500')) return true;
    if (error.message.includes('502')) return true;
    if (error.message.includes('503')) return true;
    if (error.message.includes('504')) return true;
    
    // Default: retry for unknown errors
    return true;
  }
  
  /**
   * Record error for tracking and analysis
   */
  private recordError(key: string, tier: string, error: Error): void {
    if (!this.lastErrors.has(tier)) {
      this.lastErrors.set(tier, []);
    }
    
    const errors = this.lastErrors.get(tier)!;
    errors.push({
      key,
      error: error.message,
      timestamp: Date.now(),
      stack: error.stack
    });
    
    // Keep only last 100 errors per tier
    if (errors.length > 100) {
      errors.shift();
    }
  }
  
  /**
   * Get error summary for monitoring and diagnostics
   */
  getErrorSummary(): ErrorSummary {
    const summary: ErrorSummary = {
      tiers: {},
      totalErrors: 0,
      recentErrors: []
    };
    
    for (const [tier, errors] of this.lastErrors) {
      const recentErrors = errors.filter(
        e => Date.now() - e.timestamp < 300000 // Last 5 minutes
      );
      
      summary.tiers[tier] = {
        total: errors.length,
        recent: recentErrors.length,
        circuitBreakerState: this.circuitBreakers.get(tier)?.getState() || 'unknown'
      };
      
      summary.totalErrors += errors.length;
      summary.recentErrors.push(...recentErrors.slice(-10));
    }
    
    return summary;
  }
  
  /**
   * Get circuit breaker status for a tier
   */
  getCircuitBreakerStatus(tier: string): { state: string; failures: number } {
    const circuitBreaker = this.circuitBreakers.get(tier);
    if (!circuitBreaker) {
      return { state: 'unknown', failures: 0 };
    }
    
    return {
      state: circuitBreaker.getState(),
      failures: circuitBreaker.getFailureCount()
    };
  }
  
  /**
   * Reset circuit breaker for a tier
   */
  resetCircuitBreaker(tier: string): boolean {
    const circuitBreaker = this.circuitBreakers.get(tier);
    if (!circuitBreaker) {
      return false;
    }
    
    circuitBreaker.reset();
    logger.info(`Reset circuit breaker for tier: ${tier}`);
    return true;
  }
  
  /**
   * Reset all circuit breakers
   */
  resetAllCircuitBreakers(): void {
    for (const [tier, circuitBreaker] of this.circuitBreakers) {
      circuitBreaker.reset();
      logger.info(`Reset circuit breaker for tier: ${tier}`);
    }
  }
  
  /**
   * Get all circuit breaker statuses
   */
  getAllCircuitBreakerStatuses(): Record<string, { state: string; failures: number }> {
    const statuses: Record<string, { state: string; failures: number }> = {};
    
    for (const tier of this.circuitBreakers.keys()) {
      statuses[tier] = this.getCircuitBreakerStatus(tier);
    }
    
    return statuses;
  }
  
  /**
   * Clear error history for a tier
   */
  clearErrorHistory(tier?: string): void {
    if (tier) {
      this.lastErrors.delete(tier);
      logger.info(`Cleared error history for tier: ${tier}`);
    } else {
      this.lastErrors.clear();
      logger.info('Cleared all error history');
    }
  }
  
  /**
   * Simple delay utility
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}