import { getAxiosImplementation } from '../../utils/framework.js';
import { getCachedData, generateDirectoryKey } from '../../utils/storage-integration.js';
import { logError } from '../../utils/logger.js';

export async function handleGetDirectoryStructure({ 
  path, 
  owner, 
  repo, 
  branch 
}: { 
  path?: string, 
  owner?: string, 
  repo?: string, 
  branch?: string 
}) {
  try {
    const axios = await getAxiosImplementation();
    // Get the default path based on available properties
    const defaultPath = 'BLOCKS' in axios.paths ? axios.paths.BLOCKS : axios.paths.NEW_YORK_V4_PATH;
    
    const resolvedOwner = owner || axios.paths.REPO_OWNER;
    const resolvedRepo = repo || axios.paths.REPO_NAME;
    const resolvedPath = path || defaultPath;
    const resolvedBranch = branch || axios.paths.REPO_BRANCH;
    
    const cacheKey = generateDirectoryKey(resolvedPath, resolvedOwner, resolvedRepo, resolvedBranch);
    const cachedTTL = 12 * 60 * 60; // 12 hours for directory structure (changes rarely)
    
    const directoryTree = await getCachedData(
      cacheKey,
      async () => {
        return await axios.buildDirectoryTree(
          resolvedOwner,
          resolvedRepo,
          resolvedPath,
          resolvedBranch
        );
      },
      cachedTTL
    );
    
    return {
      content: [{ 
        type: "text", 
        text: JSON.stringify(directoryTree, null, 2)
      }]
    };
  } catch (error) {
    logError('Failed to get directory structure', error);
    throw new Error(`Failed to get directory structure: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export const schema = {
  path: {
    type: 'string',
    description: 'Path within the repository (default: v4 registry)'
  },
  owner: {
    type: 'string',
    description: 'Repository owner (default: "shadcn-ui")'
  },
  repo: {
    type: 'string',
    description: 'Repository name (default: "ui")'
  },
  branch: {
    type: 'string',
    description: 'Branch name (default: "main")'
  }
}; 