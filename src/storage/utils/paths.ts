import path from 'path';
import os from 'os';
import fs from 'fs/promises';

/**
 * Get the appropriate storage path for the PGLite database
 * based on the execution context and environment variables
 */
export function getStoragePath(): string {
  // Check if user has specified a custom path
  if (process.env.SHADCN_MCP_DB_PATH) {
    return process.env.SHADCN_MCP_DB_PATH;
  }

  // Check if running through npx (global installation)
  const isNpx = process.argv[1].includes('_npx');
  
  if (isNpx || !process.env.SHADCN_MCP_LOCAL_PATH) {
    // Default: User's home directory
    return path.join(os.homedir(), '.shadcn-mcp', 'cache.db');
  }
  
  // Local installation path
  return path.join(process.env.SHADCN_MCP_LOCAL_PATH, 'cache.db');
}

/**
 * Ensure the directory for the database file exists
 */
export async function ensureDbDirectory(dbPath: string): Promise<void> {
  const dir = path.dirname(dbPath);
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (error) {
    throw new Error(`Failed to create database directory: ${error}`);
  }
}

/**
 * Check if database file exists
 */
export async function dbExists(dbPath: string): Promise<boolean> {
  try {
    await fs.access(dbPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get database file size in bytes
 */
export async function getDbSize(dbPath: string): Promise<number> {
  try {
    const stats = await fs.stat(dbPath);
    return stats.size;
  } catch {
    return 0;
  }
}

/**
 * Check if we have write permissions to the database path
 */
export async function hasWritePermission(dbPath: string): Promise<boolean> {
  const dir = path.dirname(dbPath);
  try {
    await fs.access(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}