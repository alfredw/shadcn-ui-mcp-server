/**
 * Environment variable configuration source
 */

import { ConfigSource, CacheConfiguration } from '../schemas.js';

export class EnvironmentConfigSource implements ConfigSource {
  readonly name = 'EnvironmentConfigSource';
  readonly priority = 3; // High priority - overrides file config
  
  async load(): Promise<Partial<CacheConfiguration>> {
    const config: Partial<CacheConfiguration> = {};
    
    // Storage configuration
    if (process.env.SHADCN_MCP_STORAGE_TYPE) {
      const storageType = process.env.SHADCN_MCP_STORAGE_TYPE as 'hybrid' | 'memory-only' | 'pglite-only';
      config.storage = {
        type: storageType
      };
    }
    
    // Memory configuration
    const memoryConfig: any = {};
    if (process.env.SHADCN_MCP_MEMORY_ENABLED !== undefined) {
      memoryConfig.enabled = process.env.SHADCN_MCP_MEMORY_ENABLED === 'true';
    }
    if (process.env.SHADCN_MCP_MEMORY_MAX_SIZE) {
      memoryConfig.maxSize = this.parseBytes(process.env.SHADCN_MCP_MEMORY_MAX_SIZE);
    }
    if (process.env.SHADCN_MCP_MEMORY_TTL) {
      memoryConfig.ttl = parseInt(process.env.SHADCN_MCP_MEMORY_TTL, 10);
    }
    if (process.env.SHADCN_MCP_MEMORY_EVICTION_POLICY) {
      memoryConfig.evictionPolicy = process.env.SHADCN_MCP_MEMORY_EVICTION_POLICY;
    }
    
    if (Object.keys(memoryConfig).length > 0) {
      if (!config.storage) {
        config.storage = { type: 'hybrid' as const };
      }
      config.storage = {
        ...config.storage,
        memory: memoryConfig
      };
    }
    
    // PGLite configuration
    const pgliteConfig: any = {};
    if (process.env.SHADCN_MCP_PGLITE_ENABLED !== undefined) {
      pgliteConfig.enabled = process.env.SHADCN_MCP_PGLITE_ENABLED === 'true';
    }
    if (process.env.SHADCN_MCP_DB_PATH) {
      pgliteConfig.path = process.env.SHADCN_MCP_DB_PATH;
    }
    if (process.env.SHADCN_MCP_DB_MAX_SIZE) {
      pgliteConfig.maxSize = this.parseBytes(process.env.SHADCN_MCP_DB_MAX_SIZE);
    }
    if (process.env.SHADCN_MCP_DB_ENABLE_WAL !== undefined) {
      pgliteConfig.enableWAL = process.env.SHADCN_MCP_DB_ENABLE_WAL === 'true';
    }
    if (process.env.SHADCN_MCP_DB_BUSY_TIMEOUT) {
      pgliteConfig.busyTimeout = parseInt(process.env.SHADCN_MCP_DB_BUSY_TIMEOUT, 10);
    }
    if (process.env.SHADCN_MCP_DB_VACUUM_INTERVAL) {
      pgliteConfig.vacuumInterval = parseInt(process.env.SHADCN_MCP_DB_VACUUM_INTERVAL, 10);
    }
    
    if (Object.keys(pgliteConfig).length > 0) {
      if (!config.storage) {
        config.storage = { type: 'hybrid' as const };
      }
      config.storage = {
        ...config.storage,
        pglite: pgliteConfig
      };
    }
    
    // GitHub configuration
    const githubConfig: any = {};
    if (process.env.SHADCN_MCP_GITHUB_ENABLED !== undefined) {
      githubConfig.enabled = process.env.SHADCN_MCP_GITHUB_ENABLED === 'true';
    }
    if (process.env.SHADCN_MCP_GITHUB_TOKEN || process.env.GITHUB_TOKEN) {
      githubConfig.token = process.env.SHADCN_MCP_GITHUB_TOKEN || process.env.GITHUB_TOKEN;
    }
    if (process.env.SHADCN_MCP_GITHUB_URL) {
      githubConfig.baseUrl = process.env.SHADCN_MCP_GITHUB_URL;
    }
    if (process.env.SHADCN_MCP_GITHUB_TIMEOUT) {
      githubConfig.timeout = parseInt(process.env.SHADCN_MCP_GITHUB_TIMEOUT, 10);
    }
    if (process.env.SHADCN_MCP_GITHUB_RETRIES) {
      githubConfig.retries = parseInt(process.env.SHADCN_MCP_GITHUB_RETRIES, 10);
    }
    if (process.env.SHADCN_MCP_GITHUB_USER_AGENT) {
      githubConfig.userAgent = process.env.SHADCN_MCP_GITHUB_USER_AGENT;
    }
    
    if (Object.keys(githubConfig).length > 0) {
      if (!config.storage) {
        config.storage = { type: 'hybrid' as const };
      }
      config.storage = {
        ...config.storage,
        github: githubConfig
      };
    }
    
    // Cache configuration
    const cacheConfig: any = {};
    if (process.env.SHADCN_MCP_CACHE_STRATEGY) {
      cacheConfig.strategy = process.env.SHADCN_MCP_CACHE_STRATEGY;
    }
    
    // TTL configuration
    const ttlConfig: any = {};
    if (process.env.SHADCN_MCP_TTL_COMPONENTS) {
      ttlConfig.components = parseInt(process.env.SHADCN_MCP_TTL_COMPONENTS, 10);
    }
    if (process.env.SHADCN_MCP_TTL_BLOCKS) {
      ttlConfig.blocks = parseInt(process.env.SHADCN_MCP_TTL_BLOCKS, 10);
    }
    if (process.env.SHADCN_MCP_TTL_METADATA) {
      ttlConfig.metadata = parseInt(process.env.SHADCN_MCP_TTL_METADATA, 10);
    }
    if (Object.keys(ttlConfig).length > 0) {
      cacheConfig.ttl = ttlConfig;
    }
    
    // Prefetch configuration
    const prefetchConfig: any = {};
    if (process.env.SHADCN_MCP_PREFETCH_ENABLED !== undefined) {
      prefetchConfig.enabled = process.env.SHADCN_MCP_PREFETCH_ENABLED === 'true';
    }
    if (process.env.SHADCN_MCP_PREFETCH_POPULAR !== undefined) {
      prefetchConfig.popular = process.env.SHADCN_MCP_PREFETCH_POPULAR === 'true';
    }
    if (process.env.SHADCN_MCP_PREFETCH_RELATED !== undefined) {
      prefetchConfig.related = process.env.SHADCN_MCP_PREFETCH_RELATED === 'true';
    }
    if (Object.keys(prefetchConfig).length > 0) {
      cacheConfig.prefetch = prefetchConfig;
    }
    
    // Compression configuration
    const compressionConfig: any = {};
    if (process.env.SHADCN_MCP_COMPRESSION_ENABLED !== undefined) {
      compressionConfig.enabled = process.env.SHADCN_MCP_COMPRESSION_ENABLED === 'true';
    }
    if (process.env.SHADCN_MCP_COMPRESSION_ALGORITHM) {
      compressionConfig.algorithm = process.env.SHADCN_MCP_COMPRESSION_ALGORITHM;
    }
    if (process.env.SHADCN_MCP_COMPRESSION_LEVEL) {
      compressionConfig.level = parseInt(process.env.SHADCN_MCP_COMPRESSION_LEVEL, 10);
    }
    if (Object.keys(compressionConfig).length > 0) {
      cacheConfig.compression = compressionConfig;
    }
    
    if (Object.keys(cacheConfig).length > 0) {
      config.cache = cacheConfig;
    }
    
    // Performance configuration
    const performanceConfig: any = {};
    if (process.env.SHADCN_MCP_BATCH_SIZE) {
      performanceConfig.batchSize = parseInt(process.env.SHADCN_MCP_BATCH_SIZE, 10);
    }
    if (process.env.SHADCN_MCP_CONCURRENCY) {
      performanceConfig.concurrency = parseInt(process.env.SHADCN_MCP_CONCURRENCY, 10);
    }
    if (process.env.SHADCN_MCP_QUEUE_SIZE) {
      performanceConfig.queueSize = parseInt(process.env.SHADCN_MCP_QUEUE_SIZE, 10);
    }
    if (process.env.SHADCN_MCP_FLUSH_INTERVAL) {
      performanceConfig.flushInterval = parseInt(process.env.SHADCN_MCP_FLUSH_INTERVAL, 10);
    }
    if (Object.keys(performanceConfig).length > 0) {
      config.performance = performanceConfig;
    }
    
    // Monitoring configuration
    const monitoringConfig: any = {};
    if (process.env.SHADCN_MCP_MONITORING_ENABLED !== undefined) {
      monitoringConfig.enabled = process.env.SHADCN_MCP_MONITORING_ENABLED === 'true';
    }
    if (process.env.SHADCN_MCP_STATS_INTERVAL) {
      monitoringConfig.statsInterval = parseInt(process.env.SHADCN_MCP_STATS_INTERVAL, 10);
    }
    if (process.env.SHADCN_MCP_METRICS_RETENTION) {
      monitoringConfig.metricsRetention = parseInt(process.env.SHADCN_MCP_METRICS_RETENTION, 10);
    }
    
    const exportersConfig: any = {};
    if (process.env.SHADCN_MCP_PROMETHEUS_ENABLED !== undefined) {
      exportersConfig.prometheus = process.env.SHADCN_MCP_PROMETHEUS_ENABLED === 'true';
    }
    if (process.env.SHADCN_MCP_JSON_EXPORT_ENABLED !== undefined) {
      exportersConfig.json = process.env.SHADCN_MCP_JSON_EXPORT_ENABLED === 'true';
    }
    if (Object.keys(exportersConfig).length > 0) {
      monitoringConfig.exporters = exportersConfig;
    }
    
    if (Object.keys(monitoringConfig).length > 0) {
      config.monitoring = monitoringConfig;
    }
    
    // Circuit breaker configuration
    const circuitBreakerConfig: any = {};
    if (process.env.SHADCN_MCP_CIRCUIT_BREAKER_ENABLED !== undefined) {
      circuitBreakerConfig.enabled = process.env.SHADCN_MCP_CIRCUIT_BREAKER_ENABLED === 'true';
    }
    if (process.env.SHADCN_MCP_CIRCUIT_BREAKER_THRESHOLD) {
      circuitBreakerConfig.threshold = parseInt(process.env.SHADCN_MCP_CIRCUIT_BREAKER_THRESHOLD, 10);
    }
    if (process.env.SHADCN_MCP_CIRCUIT_BREAKER_TIMEOUT) {
      circuitBreakerConfig.timeout = parseInt(process.env.SHADCN_MCP_CIRCUIT_BREAKER_TIMEOUT, 10);
    }
    if (process.env.SHADCN_MCP_CIRCUIT_BREAKER_RESET_TIMEOUT) {
      circuitBreakerConfig.resetTimeout = parseInt(process.env.SHADCN_MCP_CIRCUIT_BREAKER_RESET_TIMEOUT, 10);
    }
    if (Object.keys(circuitBreakerConfig).length > 0) {
      config.circuitBreaker = circuitBreakerConfig;
    }
    
    // Feature flags
    const featuresConfig: any = {};
    if (process.env.SHADCN_MCP_OFFLINE !== undefined) {
      featuresConfig.offlineMode = process.env.SHADCN_MCP_OFFLINE === 'true';
    }
    if (process.env.SHADCN_MCP_ENABLE_MIGRATION !== undefined) {
      featuresConfig.migration = process.env.SHADCN_MCP_ENABLE_MIGRATION === 'true';
    }
    if (process.env.SHADCN_MCP_ANALYTICS !== undefined) {
      featuresConfig.analytics = process.env.SHADCN_MCP_ANALYTICS === 'true';
    }
    if (process.env.SHADCN_MCP_AUTO_SYNC !== undefined) {
      featuresConfig.autoSync = process.env.SHADCN_MCP_AUTO_SYNC === 'true';
    }
    if (process.env.SHADCN_MCP_EXPERIMENTAL_FEATURES) {
      featuresConfig.experimentalFeatures = process.env.SHADCN_MCP_EXPERIMENTAL_FEATURES.split(',').map(f => f.trim());
    }
    if (Object.keys(featuresConfig).length > 0) {
      config.features = featuresConfig;
    }
    
    // Error recovery configuration
    const recoveryConfig: any = {};
    if (process.env.SHADCN_MCP_RECOVERY_ENABLED !== undefined) {
      recoveryConfig.enabled = process.env.SHADCN_MCP_RECOVERY_ENABLED === 'true';
    }
    if (process.env.SHADCN_MCP_RECOVERY_MAX_RETRIES) {
      recoveryConfig.maxRetries = parseInt(process.env.SHADCN_MCP_RECOVERY_MAX_RETRIES, 10);
    }
    if (process.env.SHADCN_MCP_RECOVERY_BACKOFF_MS) {
      recoveryConfig.backoffMs = parseInt(process.env.SHADCN_MCP_RECOVERY_BACKOFF_MS, 10);
    }
    if (process.env.SHADCN_MCP_RECOVERY_BACKOFF_MULTIPLIER) {
      recoveryConfig.backoffMultiplier = parseFloat(process.env.SHADCN_MCP_RECOVERY_BACKOFF_MULTIPLIER);
    }
    if (process.env.SHADCN_MCP_RECOVERY_MAX_BACKOFF_MS) {
      recoveryConfig.maxBackoffMs = parseInt(process.env.SHADCN_MCP_RECOVERY_MAX_BACKOFF_MS, 10);
    }
    
    // Fallback chain configuration
    const fallbackChainConfig: any = {};
    if (process.env.SHADCN_MCP_FALLBACK_CHAIN_ENABLED !== undefined) {
      fallbackChainConfig.enabled = process.env.SHADCN_MCP_FALLBACK_CHAIN_ENABLED === 'true';
    }
    if (process.env.SHADCN_MCP_FALLBACK_STALE_MAX_AGE) {
      fallbackChainConfig.staleMaxAge = parseInt(process.env.SHADCN_MCP_FALLBACK_STALE_MAX_AGE, 10);
    }
    if (process.env.SHADCN_MCP_FALLBACK_ALLOW_PARTIAL !== undefined) {
      fallbackChainConfig.allowPartialData = process.env.SHADCN_MCP_FALLBACK_ALLOW_PARTIAL === 'true';
    }
    if (process.env.SHADCN_MCP_FALLBACK_TIMEOUT_MS) {
      fallbackChainConfig.timeoutMs = parseInt(process.env.SHADCN_MCP_FALLBACK_TIMEOUT_MS, 10);
    }
    if (Object.keys(fallbackChainConfig).length > 0) {
      recoveryConfig.fallbackChain = fallbackChainConfig;
    }
    
    // Notifications configuration
    const notificationsConfig: any = {};
    if (process.env.SHADCN_MCP_NOTIFICATIONS_ENABLED !== undefined) {
      notificationsConfig.enabled = process.env.SHADCN_MCP_NOTIFICATIONS_ENABLED === 'true';
    }
    if (process.env.SHADCN_MCP_NOTIFICATIONS_RETENTION_MS) {
      notificationsConfig.retentionMs = parseInt(process.env.SHADCN_MCP_NOTIFICATIONS_RETENTION_MS, 10);
    }
    if (process.env.SHADCN_MCP_NOTIFICATIONS_MAX) {
      notificationsConfig.maxNotifications = parseInt(process.env.SHADCN_MCP_NOTIFICATIONS_MAX, 10);
    }
    if (Object.keys(notificationsConfig).length > 0) {
      recoveryConfig.notifications = notificationsConfig;
    }
    
    // Recovery monitoring configuration
    const recoveryMonitoringConfig: any = {};
    if (process.env.SHADCN_MCP_RECOVERY_MONITORING_ENABLED !== undefined) {
      recoveryMonitoringConfig.enabled = process.env.SHADCN_MCP_RECOVERY_MONITORING_ENABLED === 'true';
    }
    if (process.env.SHADCN_MCP_RECOVERY_METRICS_RETENTION) {
      recoveryMonitoringConfig.metricsRetention = parseInt(process.env.SHADCN_MCP_RECOVERY_METRICS_RETENTION, 10);
    }
    
    // Alert thresholds
    const alertThresholds: any = {};
    if (process.env.SHADCN_MCP_RECOVERY_ERROR_RATE_THRESHOLD) {
      alertThresholds.errorRate = parseFloat(process.env.SHADCN_MCP_RECOVERY_ERROR_RATE_THRESHOLD);
    }
    if (process.env.SHADCN_MCP_RECOVERY_TIME_THRESHOLD) {
      alertThresholds.recoveryTime = parseInt(process.env.SHADCN_MCP_RECOVERY_TIME_THRESHOLD, 10);
    }
    if (Object.keys(alertThresholds).length > 0) {
      recoveryMonitoringConfig.alertThresholds = alertThresholds;
    }
    if (Object.keys(recoveryMonitoringConfig).length > 0) {
      recoveryConfig.monitoring = recoveryMonitoringConfig;
    }
    
    // Tier-specific configuration
    const tiersConfig: any = {};
    
    // Memory tier
    const memoryTierConfig: any = {};
    if (process.env.SHADCN_MCP_RECOVERY_MEMORY_MAX_RETRIES) {
      memoryTierConfig.maxRetries = parseInt(process.env.SHADCN_MCP_RECOVERY_MEMORY_MAX_RETRIES, 10);
    }
    if (process.env.SHADCN_MCP_RECOVERY_MEMORY_TIMEOUT_MS) {
      memoryTierConfig.timeoutMs = parseInt(process.env.SHADCN_MCP_RECOVERY_MEMORY_TIMEOUT_MS, 10);
    }
    if (Object.keys(memoryTierConfig).length > 0) {
      tiersConfig.memory = memoryTierConfig;
    }
    
    // PGLite tier
    const pgliteTierConfig: any = {};
    if (process.env.SHADCN_MCP_RECOVERY_PGLITE_MAX_RETRIES) {
      pgliteTierConfig.maxRetries = parseInt(process.env.SHADCN_MCP_RECOVERY_PGLITE_MAX_RETRIES, 10);
    }
    if (process.env.SHADCN_MCP_RECOVERY_PGLITE_TIMEOUT_MS) {
      pgliteTierConfig.timeoutMs = parseInt(process.env.SHADCN_MCP_RECOVERY_PGLITE_TIMEOUT_MS, 10);
    }
    if (Object.keys(pgliteTierConfig).length > 0) {
      tiersConfig.pglite = pgliteTierConfig;
    }
    
    // GitHub tier
    const githubTierConfig: any = {};
    if (process.env.SHADCN_MCP_RECOVERY_GITHUB_MAX_RETRIES) {
      githubTierConfig.maxRetries = parseInt(process.env.SHADCN_MCP_RECOVERY_GITHUB_MAX_RETRIES, 10);
    }
    if (process.env.SHADCN_MCP_RECOVERY_GITHUB_TIMEOUT_MS) {
      githubTierConfig.timeoutMs = parseInt(process.env.SHADCN_MCP_RECOVERY_GITHUB_TIMEOUT_MS, 10);
    }
    if (Object.keys(githubTierConfig).length > 0) {
      tiersConfig.github = githubTierConfig;
    }
    
    if (Object.keys(tiersConfig).length > 0) {
      recoveryConfig.tiers = tiersConfig;
    }
    
    if (Object.keys(recoveryConfig).length > 0) {
      config.recovery = recoveryConfig;
    }
    
    return config;
  }
  
  /**
   * Parse byte size from string (e.g., "50MB", "100KB", "1GB")
   */
  private parseBytes(sizeStr: string): number {
    if (!sizeStr) return 0;
    
    const units: Record<string, number> = {
      'B': 1,
      'KB': 1024,
      'MB': 1024 * 1024,
      'GB': 1024 * 1024 * 1024
    };
    
    const match = sizeStr.match(/^(\d+)\s*([A-Z]+)$/i);
    if (!match) {
      // Try parsing as plain number (bytes)
      const num = parseInt(sizeStr, 10);
      return isNaN(num) ? 0 : num;
    }
    
    const [, numStr, unit] = match;
    const num = parseInt(numStr, 10);
    const multiplier = units[unit.toUpperCase()] || 1;
    
    return num * multiplier;
  }
}