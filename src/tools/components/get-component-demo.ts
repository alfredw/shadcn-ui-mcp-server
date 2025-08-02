import { getAxiosImplementation } from '../../utils/framework.js';
import { getCachedData, generateComponentDemoKey } from '../../utils/storage-integration.js';
import { logError } from '../../utils/logger.js';

export async function handleGetComponentDemo({ componentName }: { componentName: string }) {
  try {
    const cacheKey = generateComponentDemoKey(componentName);
    const cachedTTL = 24 * 60 * 60; // 24 hours for demos
    
    const demoCode = await getCachedData(
      cacheKey,
      async () => {
        const axios = await getAxiosImplementation();
        return await axios.getComponentDemo(componentName);
      },
      cachedTTL
    );
    
    return {
      content: [{ type: "text", text: demoCode }]
    };
  } catch (error) {
    logError(`Failed to get demo for component "${componentName}"`, error);
    throw new Error(`Failed to get demo for component "${componentName}": ${error instanceof Error ? error.message : String(error)}`);
  }
}

export const schema = {
  componentName: {
    type: 'string',
    description: 'Name of the shadcn/ui component (e.g., "accordion", "button")'
  }
}; 