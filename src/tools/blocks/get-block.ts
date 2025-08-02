import { getAxiosImplementation } from '../../utils/framework.js';
import { getCachedData, generateBlockKey } from '../../utils/storage-integration.js';
import { logError } from '../../utils/logger.js';

export async function handleGetBlock({ 
  blockName, 
  includeComponents = true 
}: { 
  blockName: string, 
  includeComponents?: boolean 
}) {
  try {
    const cacheKey = generateBlockKey(blockName, includeComponents);
    const cachedTTL = 24 * 60 * 60; // 24 hours for blocks
    
    const blockData = await getCachedData(
      cacheKey,
      async () => {
        const axios = await getAxiosImplementation();
        return await axios.getBlockCode(blockName, includeComponents);
      },
      cachedTTL
    );
    
    return {
      content: [{ type: "text", text: JSON.stringify(blockData, null, 2) }]
    };
  } catch (error) {
    logError(`Failed to get block "${blockName}"`, error);
    throw new Error(`Failed to get block "${blockName}": ${error instanceof Error ? error.message : String(error)}`);
  }
}

export const schema = {
  blockName: {
    type: 'string',
    description: 'Name of the block (e.g., "calendar-01", "dashboard-01", "login-02")'
  },
  includeComponents: {
    type: 'boolean',
    description: 'Whether to include component files for complex blocks (default: true)'
  }
}; 