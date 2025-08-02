import { getStorageStats, getCircuitBreakerStatus } from '../../utils/storage-integration.js';
import { logError } from '../../utils/logger.js';

export async function handleGetStorageStats() {
  try {
    const stats = getStorageStats();
    const circuitBreakerStatus = getCircuitBreakerStatus();
    
    if (!stats) {
      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify({
            error: "Storage not initialized",
            message: "Hybrid storage system is not available. Operating in direct fetch mode."
          }, null, 2)
        }]
      };
    }
    
    const result = {
      storage: {
        ...stats,
        timestamp: new Date().toISOString()
      },
      circuitBreaker: circuitBreakerStatus,
      summary: {
        totalRequests: stats.totalOperations,
        overallHitRate: `${stats.hitRate}%`,
        tierHitRates: {
          memory: stats.hits.memory,
          pglite: stats.hits.pglite,
          github: stats.hits.github
        },
        tierAvailability: stats.tierAvailability,
        averageResponseTimes: stats.avgResponseTimes
      }
    };
    
    return {
      content: [{ 
        type: "text", 
        text: JSON.stringify(result, null, 2)
      }]
    };
  } catch (error) {
    logError('Failed to get storage stats', error);
    throw new Error(`Failed to get storage stats: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export const schema = {};