# Phase 3, Task 2: Advanced Error Recovery

## Overview
Implement robust error recovery mechanisms that ensure the system remains functional even when storage tiers fail, GitHub API is down, or other errors occur. Focus on graceful degradation and clear user feedback.

## Objectives
- Implement multi-level retry strategies with exponential backoff
- Add partial response handling for incomplete data
- Create fallback chains for storage tier failures
- Provide clear user feedback during degraded operation
- Implement recovery monitoring and alerts

## Technical Requirements

### Error Recovery Manager
```typescript
export interface RecoveryStrategy {
  maxRetries: number;
  backoffMs: number;
  backoffMultiplier: number;
  maxBackoffMs: number;
  fallbackAction?: () => Promise<any>;
}

export class ErrorRecoveryManager {
  private retryCounters = new Map<string, number>();
  private circuitBreakers = new Map<string, CircuitBreaker>();
  private lastErrors = new Map<string, ErrorInfo[]>();
  
  constructor(
    private config: ConfigurationManager,
    private storage: HybridStorage
  ) {
    this.initializeCircuitBreakers();
  }
  
  private initializeCircuitBreakers(): void {
    // Storage tier circuit breakers
    this.circuitBreakers.set('memory', new CircuitBreaker({
      failureThreshold: 5,
      resetTimeout: 30000,
      monitorInterval: 5000
    }));
    
    this.circuitBreakers.set('pglite', new CircuitBreaker({
      failureThreshold: 3,
      resetTimeout: 60000,
      monitorInterval: 10000
    }));
    
    this.circuitBreakers.set('github', new CircuitBreaker({
      failureThreshold: 2,
      resetTimeout: 120000,
      monitorInterval: 30000
    }));
  }
  
  async executeWithRecovery<T>(
    operation: () => Promise<T>,
    context: {
      key: string;
      tier: string;
      strategy?: Partial<RecoveryStrategy>;
    }
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
    if (circuitBreaker && circuitBreaker.isOpen()) {
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
        circuitBreaker?.recordSuccess();
        
        return result;
        
      } catch (error) {
        lastError = error as Error;
        
        // Record error
        this.recordError(context.key, context.tier, error as Error);
        circuitBreaker?.recordFailure();
        
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
          `Retry ${retries + 1}/${strategy.maxRetries} for ${context.key} after ${backoffMs}ms`,
          { error: (error as Error).message }
        );
        
        // Wait before retry
        await this.delay(backoffMs);
        retries++;
      }
    }
    
    // All retries exhausted
    if (strategy.fallbackAction) {
      logger.info(`Executing fallback action for ${context.key}`);
      return strategy.fallbackAction();
    }
    
    throw new RecoveryFailedError(
      `Failed after ${retries} retries: ${lastError?.message}`,
      context.key,
      retries,
      lastError
    );
  }
  
  private shouldRetry(error: Error, retries: number, strategy: RecoveryStrategy): boolean {
    // Don't retry if max retries reached
    if (retries >= strategy.maxRetries) return false;
    
    // Check error type
    if (error instanceof CircuitOpenError) return false;
    if (error.message.includes('404')) return false; // Not found
    if (error.message.includes('401')) return false; // Unauthorized
    
    // Retry on network errors, timeouts, 5xx errors
    if (error.message.includes('ECONNREFUSED')) return true;
    if (error.message.includes('ETIMEDOUT')) return true;
    if (error.message.includes('500')) return true;
    if (error.message.includes('502')) return true;
    if (error.message.includes('503')) return true;
    
    // Default: retry
    return true;
  }
  
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
  
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

### Fallback Chain Handler
```typescript
export class FallbackChainHandler {
  constructor(
    private storage: HybridStorage,
    private recoveryManager: ErrorRecoveryManager
  ) {}
  
  async getWithFallback<T>(
    key: string,
    options: {
      tiers?: string[];
      allowStale?: boolean;
      partialAcceptable?: boolean;
    } = {}
  ): Promise<T | null> {
    const tiers = options.tiers || ['memory', 'pglite', 'github'];
    let lastError: Error | null = null;
    
    for (const tier of tiers) {
      try {
        const result = await this.recoveryManager.executeWithRecovery(
          async () => {
            switch (tier) {
              case 'memory':
                return this.storage.providers.memory?.get(key);
              case 'pglite':
                return this.storage.providers.pglite?.get(key);
              case 'github':
                return this.fetchFromGitHub(key);
              default:
                throw new Error(`Unknown tier: ${tier}`);
            }
          },
          { key, tier }
        );
        
        if (result !== undefined) {
          // Check if result is stale
          if (this.isStale(result) && !options.allowStale) {
            continue; // Try next tier
          }
          
          // Check if result is partial
          if (this.isPartial(result) && !options.partialAcceptable) {
            continue; // Try next tier
          }
          
          return result;
        }
        
      } catch (error) {
        lastError = error as Error;
        logger.error(`Failed to get ${key} from ${tier}:`, error);
        
        // Continue to next tier
        continue;
      }
    }
    
    // All tiers failed
    if (options.allowStale) {
      // Try to get any stale data
      const staleData = await this.getStaleData(key);
      if (staleData) {
        logger.warn(`Serving stale data for ${key}`);
        return staleData;
      }
    }
    
    throw new AllTiersFailedError(
      `Failed to get ${key} from any tier`,
      key,
      tiers,
      lastError
    );
  }
  
  private isStale(data: any): boolean {
    if (!data || typeof data !== 'object') return false;
    return data._stale === true;
  }
  
  private isPartial(data: any): boolean {
    if (!data || typeof data !== 'object') return false;
    return data._partial === true;
  }
  
  private async getStaleData<T>(key: string): Promise<T | null> {
    // Try all tiers for any data, even if stale
    const tiers = ['memory', 'pglite'];
    
    for (const tier of tiers) {
      try {
        const provider = tier === 'memory' 
          ? this.storage.providers.memory 
          : this.storage.providers.pglite;
          
        const data = await provider?.get(key);
        if (data) return data;
        
      } catch (error) {
        // Ignore errors when looking for stale data
      }
    }
    
    return null;
  }
  
  private async fetchFromGitHub(key: string): Promise<any> {
    // Parse key and fetch from GitHub
    const parts = key.split(':');
    const resourceType = parts[0];
    const framework = parts[1];
    const name = parts[2];
    
    const axios = await getAxiosImplementation();
    
    switch (resourceType) {
      case 'component':
        return axios.getComponentSource(name);
      case 'block':
        return axios.getBlockCode(name);
      default:
        throw new Error(`Unknown resource type: ${resourceType}`);
    }
  }
}
```

### Partial Response Handler
```typescript
export class PartialResponseHandler {
  async handlePartialData<T>(
    key: string,
    partialData: Partial<T>,
    requiredFields: string[]
  ): Promise<T> {
    // Check if we have all required fields
    const missingFields = requiredFields.filter(
      field => !(field in partialData)
    );
    
    if (missingFields.length === 0) {
      // We have all required fields
      return partialData as T;
    }
    
    // Try to fetch missing fields
    logger.info(`Attempting to fetch missing fields for ${key}: ${missingFields.join(', ')}`);
    
    const missingData = await this.fetchMissingFields(key, missingFields);
    
    // Merge data
    const completeData = {
      ...partialData,
      ...missingData,
      _partial: missingData._partial !== false
    };
    
    return completeData as T;
  }
  
  private async fetchMissingFields(
    key: string,
    fields: string[]
  ): Promise<any> {
    // Implementation depends on the data type
    // This is a simplified example
    try {
      const freshData = await this.fetchCompleteData(key);
      
      const missingData: any = {};
      for (const field of fields) {
        if (field in freshData) {
          missingData[field] = freshData[field];
        }
      }
      
      missingData._partial = false;
      return missingData;
      
    } catch (error) {
      logger.error(`Failed to fetch missing fields for ${key}:`, error);
      return { _partial: true };
    }
  }
  
  private async fetchCompleteData(key: string): Promise<any> {
    // Fetch complete data from source
    const axios = await getAxiosImplementation();
    const parts = key.split(':');
    
    // Implementation based on key type
    return {};
  }
}
```

### User Feedback System
```typescript
export class DegradedOperationNotifier {
  private notifications: DegradedNotification[] = [];
  private subscribers: ((notification: DegradedNotification) => void)[] = [];
  
  notify(notification: DegradedNotification): void {
    this.notifications.push(notification);
    
    // Keep only recent notifications
    const cutoff = Date.now() - 3600000; // 1 hour
    this.notifications = this.notifications.filter(
      n => n.timestamp > cutoff
    );
    
    // Notify subscribers
    this.subscribers.forEach(subscriber => {
      try {
        subscriber(notification);
      } catch (error) {
        logger.error('Notification subscriber error:', error);
      }
    });
  }
  
  subscribe(callback: (notification: DegradedNotification) => void): () => void {
    this.subscribers.push(callback);
    
    // Return unsubscribe function
    return () => {
      this.subscribers = this.subscribers.filter(s => s !== callback);
    };
  }
  
  getActiveIssues(): DegradedNotification[] {
    const cutoff = Date.now() - 300000; // Last 5 minutes
    
    return this.notifications
      .filter(n => n.timestamp > cutoff)
      .reduce((acc, notification) => {
        // Deduplicate by type and tier
        const key = `${notification.type}:${notification.tier}`;
        const existing = acc.find(
          n => `${n.type}:${n.tier}` === key
        );
        
        if (!existing || notification.timestamp > existing.timestamp) {
          return [
            ...acc.filter(n => `${n.type}:${n.tier}` !== key),
            notification
          ];
        }
        
        return acc;
      }, [] as DegradedNotification[]);
  }
}

interface DegradedNotification {
  type: 'storage-failure' | 'api-degraded' | 'serving-stale' | 'partial-data';
  tier: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
  timestamp: number;
  context?: any;
}

// CLI integration for showing degraded status
export function showDegradedStatus(): void {
  const notifier = new DegradedOperationNotifier();
  const issues = notifier.getActiveIssues();
  
  if (issues.length === 0) {
    console.log(chalk.green('✓ All systems operational'));
    return;
  }
  
  console.log(chalk.yellow('⚠ Degraded Operation Detected:\n'));
  
  const table = new Table({
    head: ['Type', 'Tier', 'Message', 'Severity', 'Age'],
    style: { head: ['yellow'] }
  });
  
  issues.forEach(issue => {
    const age = formatDuration(Date.now() - issue.timestamp);
    const severity = issue.severity === 'error' 
      ? chalk.red(issue.severity)
      : issue.severity === 'warning'
      ? chalk.yellow(issue.severity)
      : chalk.blue(issue.severity);
    
    table.push([
      issue.type,
      issue.tier,
      issue.message,
      severity,
      age
    ]);
  });
  
  console.log(table.toString());
}
```

### Recovery Monitoring
```typescript
export class RecoveryMonitor {
  private metrics: RecoveryMetrics = {
    totalRecoveries: 0,
    successfulRecoveries: 0,
    failedRecoveries: 0,
    averageRecoveryTime: 0,
    tierFailures: new Map()
  };
  
  recordRecoveryAttempt(
    tier: string,
    success: boolean,
    duration: number
  ): void {
    this.metrics.totalRecoveries++;
    
    if (success) {
      this.metrics.successfulRecoveries++;
    } else {
      this.metrics.failedRecoveries++;
      
      const failures = this.metrics.tierFailures.get(tier) || 0;
      this.metrics.tierFailures.set(tier, failures + 1);
    }
    
    // Update average recovery time
    this.metrics.averageRecoveryTime = 
      (this.metrics.averageRecoveryTime * (this.metrics.totalRecoveries - 1) + duration) /
      this.metrics.totalRecoveries;
  }
  
  getRecoveryRate(): number {
    if (this.metrics.totalRecoveries === 0) return 1;
    
    return this.metrics.successfulRecoveries / this.metrics.totalRecoveries;
  }
  
  shouldAlertOnFailures(): boolean {
    // Alert if recovery rate drops below 80%
    return this.getRecoveryRate() < 0.8;
  }
  
  getReport(): string {
    const rate = (this.getRecoveryRate() * 100).toFixed(1);
    
    return `
Recovery Statistics:
- Total Attempts: ${this.metrics.totalRecoveries}
- Success Rate: ${rate}%
- Average Recovery Time: ${this.metrics.averageRecoveryTime.toFixed(0)}ms
- Failed Recoveries: ${this.metrics.failedRecoveries}

Tier Failures:
${Array.from(this.metrics.tierFailures.entries())
  .map(([tier, count]) => `  - ${tier}: ${count}`)
  .join('\n')}
    `.trim();
  }
}

interface RecoveryMetrics {
  totalRecoveries: number;
  successfulRecoveries: number;
  failedRecoveries: number;
  averageRecoveryTime: number;
  tierFailures: Map<string, number>;
}
```

## Acceptance Criteria
- [ ] Exponential backoff retry logic works correctly
- [ ] Circuit breakers prevent cascade failures
- [ ] Fallback chain tries all available tiers
- [ ] Stale data served when appropriate
- [ ] Partial responses handled gracefully
- [ ] User notifications for degraded operation
- [ ] Recovery metrics tracked accurately
- [ ] Error summaries provide useful diagnostics

## Testing Requirements
- Unit tests for ErrorRecoveryManager
- Circuit breaker state transition tests
- Fallback chain integration tests
- Partial response handling tests
- Retry logic with various error types
- Recovery monitoring accuracy tests
- User notification tests

## Estimated Effort
- 8-10 hours

## Dependencies
- Circuit breaker implementation
- Storage tier implementations
- Notification system
- CLI infrastructure

## Notes
- Keep error messages user-friendly
- Log detailed errors for debugging
- Monitor recovery patterns over time
- Consider adding webhooks for critical failures