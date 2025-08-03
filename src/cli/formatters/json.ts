/**
 * JSON formatting utilities for CLI output
 */

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