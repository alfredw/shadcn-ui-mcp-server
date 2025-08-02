import { getAxiosImplementation } from '../../utils/framework.js';
import { getCachedData, generateListKey } from '../../utils/storage-integration.js';
import { logError } from '../../utils/logger.js';

export async function handleListComponents() {
  try {
    const cacheKey = generateListKey('components');
    const cachedTTL = 6 * 60 * 60; // 6 hours for component lists (they change less frequently)
    
    const result = await getCachedData(
      cacheKey,
      async () => {
        const axios = await getAxiosImplementation();
        const components = await axios.getAvailableComponents();
        return { 
          components: components.sort(),
          total: components.length 
        };
      },
      cachedTTL
    );
    
    return {
      content: [{ 
        type: "text", 
        text: JSON.stringify(result, null, 2) 
      }]
    };
  } catch (error) {
    logError('Failed to list components', error);
    throw new Error(`Failed to list components: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export const schema = {}; 