/**
 * Fallback Chain Handler
 * 
 * Handles storage tier failures with intelligent fallback logic,
 * serving stale data when appropriate and managing tier degradation.
 */

import { ErrorRecoveryManager, RecoveryContext } from '../utils/error-recovery-manager.js';
import { DegradedOperationNotifier } from '../utils/degraded-operation-notifier.js';
import { PartialResponseHandler, PartialDataResult } from '../utils/partial-response-handler.js';
import { getAxiosImplementation } from '../utils/framework.js';
import { logger } from '../utils/logger.js';

/**
 * Storage provider interface for fallback operations
 */
interface FallbackStorageProvider {
  get(key: string): Promise<any>;
  set?(key: string, value: any, ttl?: number): Promise<void>;
}

/**
 * Fallback tier configuration
 */
export interface FallbackTier {
  name: string;
  provider: FallbackStorageProvider;
  priority: number;
  allowStale: boolean;
  allowPartial: boolean;
}

/**
 * Fallback options for retrieval operations
 */
export interface FallbackOptions {
  tiers?: string[];
  allowStale?: boolean;
  partialAcceptable?: boolean;
  requiredFields?: string[];
  maxStaleAge?: number; // milliseconds
  timeoutMs?: number;
}

/**
 * Fallback result information
 */
export interface FallbackResult<T> {
  data: T;
  tier: string;
  isStale: boolean;
  isPartial: boolean;
  staleness?: number; // milliseconds
  missingFields?: string[];
}

/**
 * Error thrown when all tiers fail
 */
export class AllTiersFailedError extends Error {
  constructor(
    message: string,
    public key: string,
    public attemptedTiers: string[],
    public lastError?: Error
  ) {
    super(message);
    this.name = 'AllTiersFailedError';
  }
}

/**
 * Fallback Chain Handler
 * 
 * Orchestrates storage tier fallback with intelligent stale data serving
 * and partial response handling.
 */
export class FallbackChainHandler {
  private tiers = new Map<string, FallbackTier>();
  
  constructor(
    private recoveryManager: ErrorRecoveryManager,
    private notifier: DegradedOperationNotifier,
    private partialHandler: PartialResponseHandler
  ) {
    this.initializeDefaultTiers();
  }
  
  /**
   * Initialize default tier configuration
   */
  private initializeDefaultTiers(): void {
    // Default tiers will be registered by the HybridStorage integration
    // This method is kept for future extensibility
  }
  
  /**
   * Register a storage tier for fallback operations
   */
  registerTier(tier: FallbackTier): void {
    this.tiers.set(tier.name, tier);
    logger.info(`Registered fallback tier: ${tier.name} (priority: ${tier.priority})`);
  }
  
  /**
   * Unregister a storage tier
   */
  unregisterTier(tierName: string): void {
    this.tiers.delete(tierName);
    logger.info(`Unregistered fallback tier: ${tierName}`);
  }
  
  /**
   * Get data with fallback chain support
   */
  async getWithFallback<T>(
    key: string,
    options: FallbackOptions = {}
  ): Promise<FallbackResult<T>> {
    const {
      tiers = this.getDefaultTierOrder(),
      allowStale = true,
      partialAcceptable = true,
      requiredFields = ['name'],
      maxStaleAge = 24 * 60 * 60 * 1000, // 24 hours
      timeoutMs = 30000
    } = options;
    
    let lastError: Error | null = null;
    const attemptedTiers: string[] = [];
    
    // Try each tier in order
    for (const tierName of tiers) {
      const tier = this.tiers.get(tierName);
      if (!tier) {
        logger.warn(`Unknown tier: ${tierName}, skipping`);
        continue;
      }
      
      attemptedTiers.push(tierName);
      
      try {
        const result = await this.tryTierWithRecovery(
          tier,
          key,
          timeoutMs
        );
        
        if (result !== undefined && result !== null) {
          // Check if result is stale
          const isStale = this.isDataStale(result, maxStaleAge);
          if (isStale && !allowStale && !tier.allowStale) {
            logger.info(`Skipping stale data from ${tierName} for ${key}`);
            continue;
          }
          
          // Check if result is partial
          const partialResult = await this.handlePartialData(
            key,
            result,
            requiredFields,
            partialAcceptable && tier.allowPartial
          );
          
          if (!partialResult.isPartial || partialAcceptable) {
            // Notify if serving stale data
            if (isStale) {
              const staleness = this.getDataStaleness(result);
              this.notifier.notifyServingStale(tierName, key, staleness);
            }
            
            // Notify if serving partial data
            if (partialResult.isPartial) {
              this.notifier.notifyPartialData(tierName, key, partialResult.missingFields);
            }
            
            return {
              data: partialResult.data,
              tier: tierName,
              isStale,
              isPartial: partialResult.isPartial,
              staleness: isStale ? this.getDataStaleness(result) : undefined,
              missingFields: partialResult.missingFields
            };
          }
          
          logger.info(`Partial data from ${tierName} not acceptable for ${key}, trying next tier`);
        }
        
      } catch (error) {
        lastError = error as Error;
        logger.error(`Failed to get ${key} from ${tierName}`, error);
        
        // Notify about tier failure
        this.notifier.notifyStorageFailure(
          tierName,
          key,
          (error as Error).message,
          'error'
        );
        
        // Continue to next tier
        continue;
      }
    }
    
    // All tiers failed - try emergency stale data retrieval
    if (allowStale) {
      logger.warn(`All tiers failed for ${key}, attempting emergency stale data retrieval`);
      
      try {
        const staleResult = await this.getEmergencyStaleData<T>(key, attemptedTiers);
        if (staleResult) {
          this.notifier.notifyServingStale(
            staleResult.tier,
            key,
            staleResult.staleness || 0
          );
          
          return staleResult;
        }
      } catch (error) {
        logger.error(`Emergency stale data retrieval failed for ${key}`, error);
      }
    }
    
    // Absolutely everything failed
    throw new AllTiersFailedError(
      `Failed to get ${key} from any tier`,
      key,
      attemptedTiers,
      lastError || undefined
    );
  }
  
  /**
   * Try a tier with error recovery
   */
  private async tryTierWithRecovery(
    tier: FallbackTier,
    key: string,
    timeoutMs: number
  ): Promise<any> {
    const context: RecoveryContext = {
      key,
      tier: tier.name,
      strategy: {
        maxRetries: 2,
        backoffMs: 500,
        backoffMultiplier: 2,
        maxBackoffMs: 5000
      }
    };
    
    return this.recoveryManager.executeWithRecovery(
      async () => {
        // Add timeout to prevent hanging
        return Promise.race([
          tier.provider.get(key),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Timeout')), timeoutMs)
          )
        ]);
      },
      context
    );
  }
  
  /**
   * Handle partial data scenarios
   */
  private async handlePartialData<T>(
    key: string,
    data: T,
    requiredFields: string[],
    allowPartial: boolean
  ): Promise<PartialDataResult<T>> {
    // Check if data is already marked as partial
    if (this.partialHandler.isMarkedAsPartial(data)) {
      const missingFields = this.partialHandler.getMarkedMissingFields(data);
      return {
        data,
        isPartial: true,
        missingFields,
        completionAttempted: false
      };
    }
    
    // Check if data has required fields
    if (data && typeof data === 'object') {
      const result = await this.partialHandler.handlePartialData(
        key,
        data as Record<string, any>,
        requiredFields
      );
      
      return result as PartialDataResult<T>;
    }
    
    // Non-object data is considered complete
    return {
      data,
      isPartial: false,
      missingFields: [],
      completionAttempted: false
    };
  }
  
  /**
   * Check if data is stale
   */
  private isDataStale(data: any, maxStaleAge: number): boolean {
    if (!data || typeof data !== 'object') return false;
    
    // Check for explicit stale marking
    if (data._stale === true) return true;
    
    // Check timestamp-based staleness
    if (data._timestamp) {
      const age = Date.now() - data._timestamp;
      return age > maxStaleAge;
    }
    
    // Check TTL-based staleness
    if (data._ttl && data._created) {
      const expiryTime = data._created + (data._ttl * 1000);
      return Date.now() > expiryTime;
    }
    
    return false;
  }
  
  /**
   * Get data staleness in milliseconds
   */
  private getDataStaleness(data: any): number {
    if (!data || typeof data !== 'object') return 0;
    
    if (data._timestamp) {
      return Date.now() - data._timestamp;
    }
    
    if (data._created) {
      return Date.now() - data._created;
    }
    
    return 0;
  }
  
  /**
   * Emergency stale data retrieval from any available tier
   */
  private async getEmergencyStaleData<T>(
    key: string,
    excludeTiers: string[] = []
  ): Promise<FallbackResult<T> | null> {
    // Try all tiers except those that were already attempted
    const availableTiers = Array.from(this.tiers.values())
      .filter(tier => !excludeTiers.includes(tier.name))
      .sort((a, b) => a.priority - b.priority);
    
    for (const tier of availableTiers) {
      try {
        const data = await tier.provider.get(key);
        if (data) {
          const staleness = this.getDataStaleness(data);
          
          return {
            data,
            tier: tier.name,
            isStale: true,
            isPartial: false,
            staleness
          };
        }
      } catch (error) {
        // Ignore errors in emergency mode
        continue;
      }
    }
    
    return null;
  }
  
  /**
   * Get default tier order based on priority
   */
  private getDefaultTierOrder(): string[] {
    return Array.from(this.tiers.values())
      .sort((a, b) => a.priority - b.priority)
      .map(tier => tier.name);
  }
  
  /**
   * Fetch from GitHub API as last resort
   */
  async fetchFromGitHub(key: string): Promise<any> {
    const parts = key.split(':');
    if (parts.length < 3) {
      throw new Error(`Invalid key format: ${key}`);
    }
    
    const [resourceType, framework, name] = parts;
    const axios = await getAxiosImplementation();
    
    try {
      switch (resourceType) {
        case 'component':
          const code = await axios.getComponentSource(name);
          const metadata = await axios.getComponentMetadata(name);
          
          return {
            name,
            code,
            metadata,
            type: 'component',
            framework,
            _timestamp: Date.now(),
            _source: 'github'
          };
          
        case 'block':
          const blockData = await axios.getBlockCode(name, true);
          return {
            name,
            ...blockData,
            type: 'block',
            framework,
            _timestamp: Date.now(),
            _source: 'github'
          };
          
        default:
          throw new Error(`Unsupported resource type: ${resourceType}`);
      }
    } catch (error) {
      throw new Error(`GitHub fetch failed for ${key}: ${(error as Error).message}`);
    }
  }
  
  /**
   * Get tier status information
   */
  getTierStatus(): Record<string, { available: boolean; priority: number; allowStale: boolean; allowPartial: boolean }> {
    const status: Record<string, any> = {};
    
    for (const [name, tier] of this.tiers) {
      status[name] = {
        available: true, // Assume available unless we implement health checks
        priority: tier.priority,
        allowStale: tier.allowStale,
        allowPartial: tier.allowPartial
      };
    }
    
    return status;
  }
  
  /**
   * Get registered tier names
   */
  getRegisteredTiers(): string[] {
    return Array.from(this.tiers.keys());
  }
}