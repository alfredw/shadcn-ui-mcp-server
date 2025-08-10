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
    
    // Handle both direct string response and structured Component object from storage
    let componentDemo: string;
    if (typeof demoCode === 'string') {
      componentDemo = demoCode;
    } else if (demoCode && typeof demoCode === 'object' && demoCode !== null) {
      // Check if it looks like a Component object (has framework and name properties)
      if ('framework' in demoCode && 'name' in demoCode) {
        // Handle Component object from PGLite storage - use bracket notation for safe access
        const demo = demoCode['demoCode'];
        componentDemo = typeof demo === 'string' ? demo : '';
      } else {
        // Generic object - JSON stringify it
        componentDemo = JSON.stringify(demoCode, null, 2);
      }
    } else {
      componentDemo = JSON.stringify(demoCode, null, 2);
    }
    
    return {
      content: [{ type: "text", text: componentDemo }]
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