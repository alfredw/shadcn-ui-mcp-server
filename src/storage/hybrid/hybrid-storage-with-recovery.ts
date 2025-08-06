/**
 * Enhanced Hybrid Storage with Advanced Error Recovery
 * 
 * Extends the existing HybridStorage system with advanced error recovery,
 * fallback chains, partial response handling, and degraded operation notifications.
 */

import { HybridStorageProvider } from './hybrid-storage.js';
import { HybridStorageConfig } from './cache-strategies.js';
import { ErrorRecoveryManager, RecoveryContext } from '../../utils/error-recovery-manager.js';
import { RecoveryMonitor } from '../../utils/recovery-monitor.js';
import { DegradedOperationNotifier } from '../../utils/degraded-operation-notifier.js';
import { FallbackChainHandler, FallbackTier, FallbackOptions, FallbackResult } from '../fallback-chain-handler.js';
import { PartialResponseHandler, PartialDataResult } from '../../utils/partial-response-handler.js';
import { ConfigurationManager } from '../../config/manager.js';
import { logger } from '../../utils/logger.js';

/**
 * Enhanced recovery configuration
 */
export interface RecoveryEnhancedConfig extends HybridStorageConfig {
  recovery?: {
    enabled: boolean;
    maxRetries: number;
    backoffMs: number;
    backoffMultiplier: number;
    maxBackoffMs: number;
    fallbackChainEnabled: boolean;
    partialDataEnabled: boolean;
    staleMaxAge: number;
    notificationsEnabled: boolean;
  };
}

/**
 * Enhanced Hybrid Storage Provider with Error Recovery
 * 
 * Wraps the existing HybridStorage with advanced error recovery capabilities
 * while maintaining backward compatibility.
 */
export class HybridStorageWithRecovery extends HybridStorageProvider {
  private recoveryManager: ErrorRecoveryManager;
  private recoveryMonitor: RecoveryMonitor;
  private notifier: DegradedOperationNotifier;
  private fallbackHandler: FallbackChainHandler;
  private partialHandler: PartialResponseHandler;
  private recoveryConfig: Required<NonNullable<RecoveryEnhancedConfig['recovery']>>;
  
  constructor(
    config: RecoveryEnhancedConfig = {},
    configManager?: ConfigurationManager
  ) {
    super(config);
    
    // Initialize recovery configuration with defaults
    const recoveryDefaults = {
      enabled: true,
      maxRetries: 3,
      backoffMs: 1000,
      backoffMultiplier: 2,
      maxBackoffMs: 30000,
      fallbackChainEnabled: true,
      partialDataEnabled: true,
      staleMaxAge: 24 * 60 * 60 * 1000, // 24 hours
      notificationsEnabled: true
    };
    
    this.recoveryConfig = {
      ...recoveryDefaults,
      ...(config.recovery || {})
    };
    
    // Initialize error recovery components
    this.recoveryManager = new ErrorRecoveryManager(configManager);
    this.recoveryMonitor = new RecoveryMonitor();
    this.notifier = new DegradedOperationNotifier();
    this.partialHandler = new PartialResponseHandler();
    this.fallbackHandler = new FallbackChainHandler(
      this.recoveryManager,
      this.notifier,
      this.partialHandler
    );
    
    // Register storage tiers with fallback handler
    this.initializeFallbackTiers();
    
    logger.info('Initialized HybridStorage with advanced error recovery');
  }
  
  /**
   * Initialize fallback tiers for the fallback chain handler
   */
  private initializeFallbackTiers(): void {
    const providers = (this as any).providers;
    
    // Register memory tier (L1)
    if (providers?.memory) {
      this.fallbackHandler.registerTier({
        name: 'memory',
        provider: providers.memory,
        priority: 1,
        allowStale: true,
        allowPartial: true
      });
    }
    
    // Register pglite tier (L2)
    if (providers?.pglite) {
      this.fallbackHandler.registerTier({
        name: 'pglite',
        provider: providers.pglite,
        priority: 2,
        allowStale: true,
        allowPartial: true
      });
    }
    
    // Register github tier (L3) - create a wrapper for fallback compatibility
    if (providers?.github) {
      this.fallbackHandler.registerTier({
        name: 'github',
        provider: {
          get: async (key: string) => {
            return this.fallbackHandler.fetchFromGitHub(key);
          }
        },
        priority: 3,
        allowStale: false,
        allowPartial: false
      });
    }
  }
  
  /**
   * Enhanced get method with error recovery
   */
  async get(key: string): Promise<any> {
    if (!this.recoveryConfig.enabled) {
      // Fall back to original implementation if recovery is disabled
      return super.get(key);
    }
    
    const startTime = Date.now();
    
    try {
      // Use fallback chain for enhanced error recovery
      const result = await this.getWithRecoveryChain(key);
      
      // Record successful recovery
      this.recoveryMonitor.recordRecoveryAttempt(
        result.tier,
        key,
        true,
        Date.now() - startTime
      );
      
      return result.data;
      
    } catch (error) {
      // Record failed recovery
      this.recoveryMonitor.recordRecoveryAttempt(
        'unknown',
        key,
        false,
        Date.now() - startTime,
        (error as Error).message
      );
      
      // Notify about failure
      if (this.recoveryConfig.notificationsEnabled) {
        this.notifier.notifyStorageFailure(
          'all-tiers',
          key,
          (error as Error).message,
          'error'
        );
      }
      
      // Fall back to original implementation as last resort
      logger.warn(`Recovery chain failed for ${key}, falling back to original implementation`);
      try {
        return await super.get(key);
      } catch (originalError) {
        logger.error(`All recovery methods failed for ${key}`, originalError);
        throw error;
      }
    }
  }
  
  /**
   * Get data using the fallback chain with error recovery
   */
  private async getWithRecoveryChain(key: string): Promise<FallbackResult<any>> {
    const options: FallbackOptions = {
      allowStale: true,
      partialAcceptable: this.recoveryConfig.partialDataEnabled,
      maxStaleAge: this.recoveryConfig.staleMaxAge,
      timeoutMs: 30000,
      requiredFields: this.getRequiredFieldsForKey(key)
    };
    
    return this.fallbackHandler.getWithFallback(key, options);
  }
  
  /**
   * Enhanced set method with error recovery
   */
  async set(key: string, value: any, ttl?: number): Promise<void> {
    if (!this.recoveryConfig.enabled) {
      // Fall back to original implementation if recovery is disabled
      return super.set(key, value, ttl);
    }
    
    const startTime = Date.now();
    
    try {
      // Use recovery manager for set operations
      const context: RecoveryContext = {
        key,
        tier: 'hybrid',
        strategy: {
          maxRetries: this.recoveryConfig.maxRetries,
          backoffMs: this.recoveryConfig.backoffMs,
          backoffMultiplier: this.recoveryConfig.backoffMultiplier,
          maxBackoffMs: this.recoveryConfig.maxBackoffMs
        }
      };
      
      await this.recoveryManager.executeWithRecovery(
        async () => {
          await super.set(key, value, ttl);
        },
        context
      );
      
      // Record successful operation
      this.recoveryMonitor.recordRecoveryAttempt(
        'hybrid',
        key,
        true,
        Date.now() - startTime
      );
      
    } catch (error) {
      // Record failed operation
      this.recoveryMonitor.recordRecoveryAttempt(
        'hybrid',
        key,
        false,
        Date.now() - startTime,
        (error as Error).message
      );
      
      // Notify about failure
      if (this.recoveryConfig.notificationsEnabled) {
        this.notifier.notifyStorageFailure(
          'hybrid',
          key,
          (error as Error).message,
          'error'
        );
      }
      
      throw error;
    }
  }
  
  /**
   * Get required fields for a key based on its type
   */
  private getRequiredFieldsForKey(key: string): string[] {
    const parts = key.split(':');
    const resourceType = parts[0];
    
    switch (resourceType) {
      case 'component':
        return ['name', 'code'];
      case 'block':
        return ['name', 'code'];
      case 'metadata':
        return ['name', 'type'];
      default:
        return ['name'];
    }
  }
  
  /**
   * Get error recovery status
   */
  getRecoveryStatus(): {
    isEnabled: boolean;
    isDegraded: boolean;
    activeIssues: number;
    circuitBreakerStates: Record<string, string>;
    recentErrors: number;
  } {
    const degradationSummary = this.notifier.getDegradationSummary(5);
    const circuitBreakerStates = this.recoveryManager.getAllCircuitBreakerStatuses();
    const errorSummary = this.recoveryManager.getErrorSummary();
    
    return {
      isEnabled: this.recoveryConfig.enabled,
      isDegraded: degradationSummary.isDegraded,
      activeIssues: degradationSummary.totalIssues,
      circuitBreakerStates: Object.fromEntries(
        Object.entries(circuitBreakerStates).map(([tier, status]) => [tier, status.state])
      ),
      recentErrors: errorSummary.recentErrors.length
    };
  }
  
  /**
   * Get recovery statistics
   */
  getRecoveryStats(): {
    totalAttempts: number;
    successRate: number;
    averageRecoveryTime: number;
    tierFailures: Record<string, number>;
  } {
    const metrics = this.recoveryMonitor.getMetrics();
    const tierFailures = this.recoveryMonitor.getTierFailureCounts();
    
    return {
      totalAttempts: metrics.totalRecoveries,
      successRate: this.recoveryMonitor.getRecoveryRate(),
      averageRecoveryTime: metrics.averageRecoveryTime,
      tierFailures
    };
  }
  
  /**
   * Reset error recovery state
   */
  resetRecoveryState(): void {
    this.recoveryManager.resetAllCircuitBreakers();
    this.recoveryManager.clearErrorHistory();
    this.recoveryMonitor.reset();
    this.notifier.clearHistory();
    
    logger.info('Reset all error recovery state');
  }
  
  /**
   * Subscribe to degraded operation notifications
   */
  subscribeToNotifications(callback: (notification: any) => void): () => void {
    return this.notifier.subscribe(callback);
  }
  
  /**
   * Get fallback tier status
   */
  getFallbackTierStatus(): Record<string, any> {
    return this.fallbackHandler.getTierStatus();
  }
  
  /**
   * Enable or disable error recovery
   */
  setRecoveryEnabled(enabled: boolean): void {
    this.recoveryConfig.enabled = enabled;
    logger.info(`Error recovery ${enabled ? 'enabled' : 'disabled'}`);
  }
  
  /**
   * Update recovery configuration
   */
  updateRecoveryConfig(config: Partial<NonNullable<RecoveryEnhancedConfig['recovery']>>): void {
    this.recoveryConfig = {
      ...this.recoveryConfig,
      ...config
    };
    
    logger.info('Updated error recovery configuration');
  }
  
  /**
   * Get recovery configuration  
   */
  getRecoveryConfig(): Required<NonNullable<RecoveryEnhancedConfig['recovery']>> {
    return { ...this.recoveryConfig };
  }
  
  /**
   * Dispose of error recovery resources
   */
  async dispose(): Promise<void> {
    // Clean up any resources
    this.notifier.clearHistory();
    this.recoveryMonitor.reset();
    
    // Call parent dispose
    try {
      await super.dispose();
    } catch (error) {
      // Parent dispose might not exist or might fail
      logger.warn('Parent dispose failed or unavailable');
    }
    
    logger.info('Disposed HybridStorage with error recovery');
  }
}