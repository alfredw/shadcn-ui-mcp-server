import { getAxiosImplementation } from '../../utils/framework.js';
import { getCachedData, generateComponentMetadataKey } from '../../utils/storage-integration.js';
import { logError } from '../../utils/logger.js';

export async function handleGetComponentMetadata({ componentName }: { componentName: string }) {
  try {
    const cacheKey = generateComponentMetadataKey(componentName);
    const cachedTTL = 24 * 60 * 60; // 24 hours for metadata
    
    const metadata = await getCachedData(
      cacheKey,
      async () => {
        const axios = await getAxiosImplementation();
        const result = await axios.getComponentMetadata(componentName);
        if (!result) {
          throw new Error(`Component metadata not found: ${componentName}`);
        }
        return result;
      },
      cachedTTL
    );
    
    return {
      content: [{ type: "text", text: JSON.stringify(metadata, null, 2) }]
    };
  } catch (error) {
    logError(`Failed to get metadata for component "${componentName}"`, error);
    throw new Error(`Failed to get metadata for component "${componentName}": ${error instanceof Error ? error.message : String(error)}`);
  }
}

export const schema = {
  componentName: {
    type: 'string',
    description: 'Name of the shadcn/ui component (e.g., "accordion", "button")'
  }
}; 