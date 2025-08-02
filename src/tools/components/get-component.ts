import { getAxiosImplementation } from '../../utils/framework.js';
import { getCachedData, generateComponentKey } from '../../utils/storage-integration.js';
import { logError } from '../../utils/logger.js';

export async function handleGetComponent({ componentName }: { componentName: string }) {
  try {
    const cacheKey = generateComponentKey(componentName);
    const cachedTTL = 24 * 60 * 60; // 24 hours for components
    
    const sourceCode = await getCachedData(
      cacheKey,
      async () => {
        const axios = await getAxiosImplementation();
        return await axios.getComponentSource(componentName);
      },
      cachedTTL
    );
    
    return {
      content: [{ type: "text", text: sourceCode }]
    };
  } catch (error) {
    logError(`Failed to get component "${componentName}"`, error);
    throw new Error(`Failed to get component "${componentName}": ${error instanceof Error ? error.message : String(error)}`);
  }
}

export const schema = {
  componentName: {
    type: 'string',
    description: 'Name of the shadcn/ui component (e.g., "accordion", "button")'
  }
}; 