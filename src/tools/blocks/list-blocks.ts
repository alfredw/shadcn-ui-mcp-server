import { getAxiosImplementation } from '../../utils/framework.js';
import { getCachedData, generateListKey } from '../../utils/storage-integration.js';
import { logError } from '../../utils/logger.js';

export async function handleListBlocks({ category }: { category?: string }) {
  try {
    const cacheKey = generateListKey('blocks', 'react', category);
    const cachedTTL = 6 * 60 * 60; // 6 hours for block lists
    
    const blocks = await getCachedData(
      cacheKey,
      async () => {
        const axios = await getAxiosImplementation();
        return await axios.getAvailableBlocks(category);
      },
      cachedTTL
    );
    
    return {
      content: [{ 
        type: "text", 
        text: JSON.stringify(blocks, null, 2)
      }]
    };
  } catch (error) {
    logError('Failed to list blocks', error);
    throw new Error(`Failed to list blocks: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export const schema = {
  category: {
    type: 'string',
    description: 'Filter by category (calendar, dashboard, login, sidebar, products)'
  }
}; 