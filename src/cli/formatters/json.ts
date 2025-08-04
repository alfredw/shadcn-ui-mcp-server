/**
 * JSON formatting utilities for CLI output
 */

import { calculatePercentiles, type PercentileStats } from './table.js';

/**
 * Format data as pretty JSON
 */
export function formatAsJson(data: any, compact = false): string {
  if (compact) {
    return JSON.stringify(data);
  }
  return JSON.stringify(data, null, 2);
}

/**
 * Format cache statistics as JSON
 */
export function formatStatsAsJson(stats: any, detailed = false): string {
  if (!detailed) {
    // Return simplified stats for overview
    const simplified = {
      overview: {
        totalItems: stats.totalItems || 0,
        totalSize: stats.totalSize || 0,
        hitRate: stats.hitRate || 0,
        avgResponseTime: stats.avgResponseTime || 0
      },
      components: {
        total: stats.components?.total || 0,
        byFramework: stats.components?.byFramework || {}
      },
      blocks: {
        total: stats.blocks?.total || 0,
        byCategory: stats.blocks?.byCategory || {}
      },
      performance: {
        hits: stats.hits || {},
        misses: stats.misses || 0,
        avgResponseTimes: stats.avgResponseTimes || {}
      }
    };
    
    return formatAsJson(simplified);
  }
  
  return formatAsJson(stats);
}

/**
 * Format cache item as JSON
 */
export function formatCacheItemAsJson(item: any): string {
  return formatAsJson({
    key: item.key,
    type: item.type,
    framework: item.framework,
    size: item.size,
    createdAt: item.createdAt,
    lastAccessed: item.lastAccessed,
    accessCount: item.accessCount,
    ttl: item.ttl,
    expiresAt: item.expiresAt,
    metadata: item.metadata || {}
  });
}

/**
 * Format component list as JSON
 */
export function formatComponentListAsJson(components: any[]): string {
  return formatAsJson({
    type: 'components',
    count: components.length,
    items: components.map(comp => ({
      name: comp.name,
      framework: comp.framework,
      size: comp.size,
      lastAccessed: comp.lastAccessed,
      accessCount: comp.accessCount
    }))
  });
}

/**
 * Format block list as JSON
 */
export function formatBlockListAsJson(blocks: any[]): string {
  return formatAsJson({
    type: 'blocks',
    count: blocks.length,
    items: blocks.map(block => ({
      name: block.name,
      category: block.category,
      framework: block.framework,
      size: block.size,
      lastAccessed: block.lastAccessed,
      accessCount: block.accessCount
    }))
  });
}

/**
 * Format operation result as JSON
 */
export function formatOperationResultAsJson(operation: string, success: boolean, details: any = {}): string {
  return formatAsJson({
    operation,
    success,
    timestamp: new Date().toISOString(),
    ...details
  });
}

/**
 * Enhanced stats options for JSON formatting
 */
export interface StatsJsonOptions {
  detailed?: boolean;
  latency?: boolean;
  history?: number;
}

/**
 * Calculate latency percentiles for all tiers
 */
function calculateAllPercentiles(stats: any): Record<string, PercentileStats> {
  if (!stats.responseTimes) {
    return {};
  }

  return {
    memory: calculatePercentiles(stats.responseTimes.memory || []),
    pglite: calculatePercentiles(stats.responseTimes.pglite || []),
    github: calculatePercentiles(stats.responseTimes.github || [])
  };
}

/**
 * Get recent operations history data
 */
function getRecentOperationsData(stats: any, limit: number): Array<{tier: string, responseTime: number, status: string}> {
  if (!stats.responseTimes || Object.values(stats.responseTimes).every((arr: any) => !arr?.length)) {
    return [];
  }
  
  const recentOperations: Array<{tier: string, responseTime: number, status: string}> = [];
  
  // Get last few operations from each tier
  const memoryTimes = (stats.responseTimes.memory || []).slice(-3);
  const pgliteTimes = (stats.responseTimes.pglite || []).slice(-3);
  const githubTimes = (stats.responseTimes.github || []).slice(-3);
  
  memoryTimes.forEach((time: number) => {
    const status = time < 100 ? 'fast' : time < 500 ? 'normal' : 'slow';
    recentOperations.push({ tier: 'memory', responseTime: time, status });
  });
  
  pgliteTimes.forEach((time: number) => {
    const status = time < 100 ? 'fast' : time < 500 ? 'normal' : 'slow';
    recentOperations.push({ tier: 'pglite', responseTime: time, status });
  });
  
  githubTimes.forEach((time: number) => {
    const status = time < 100 ? 'fast' : time < 500 ? 'normal' : 'slow';
    recentOperations.push({ tier: 'github', responseTime: time, status });
  });
  
  // Sort by response time (most recent activity typically has different patterns)
  recentOperations.sort((a, b) => b.responseTime - a.responseTime);
  
  return recentOperations.slice(0, limit);
}

/**
 * Format enhanced cache statistics as JSON with optional latency and history
 */
export function formatEnhancedStatsAsJson(stats: any, options: StatsJsonOptions = {}): string {
  const { detailed = false, latency = false, history } = options;
  
  // Start with basic stats
  let result: any;
  
  if (!detailed) {
    // Return simplified stats for overview
    result = {
      overview: {
        totalItems: stats.totalItems || 0,
        totalSize: stats.totalSize || 0,
        hitRate: stats.hitRate || 0,
        avgResponseTime: stats.avgResponseTime || 0,
        totalOperations: stats.totalOperations || 0
      },
      performance: {
        hits: stats.hits || {},
        misses: stats.misses || 0,
        tierAvailability: stats.tierAvailability || {}
      }
    };
  } else {
    result = { ...stats };
  }
  
  // Add latency percentiles if requested
  if (latency) {
    result.latencyPercentiles = calculateAllPercentiles(stats);
  }
  
  // Add operation history if requested
  if (history && typeof history === 'number') {
    result.recentOperations = getRecentOperationsData(stats, history);
  }
  
  // Add circuit breaker info if available
  if (stats.circuitBreaker) {
    result.circuitBreaker = stats.circuitBreaker;
  }
  
  return formatAsJson(result);
}