import { PGlite } from '@electric-sql/pglite';
import { PGLiteManager, DatabaseConfig } from './manager.js';
import { logger } from '../../utils/logger.js';

/**
 * Global database manager instance
 */
let dbManager: PGLiteManager | null = null;

/**
 * Initialize the global database connection
 */
export async function initializeDatabase(config?: DatabaseConfig): Promise<void> {
  if (dbManager) {
    logger.warn('Database already initialized');
    return;
  }

  try {
    dbManager = new PGLiteManager(config);
    await dbManager.initialize();
    logger.info('Global database connection initialized');
  } catch (error) {
    logger.error('Failed to initialize global database connection:', error);
    throw error;
  }
}

/**
 * Get the global database connection
 */
export async function getDatabase(): Promise<PGlite> {
  if (!dbManager) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  
  return dbManager.getConnection();
}

/**
 * Get the database manager instance
 */
export function getDatabaseManager(): PGLiteManager {
  if (!dbManager) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  
  return dbManager;
}

/**
 * Close the database connection
 */
export async function closeDatabase(): Promise<void> {
  if (dbManager) {
    await dbManager.close();
    dbManager = null;
    logger.info('Global database connection closed');
  }
}

/**
 * Check if database is initialized and healthy
 */
export async function isDatabaseHealthy(): Promise<boolean> {
  if (!dbManager) {
    return false;
  }
  
  return dbManager.checkHealth();
}

/**
 * Get database statistics
 */
export async function getDatabaseStats(): Promise<{
  dbPath: string;
  size: number;
  isHealthy: boolean;
  componentCount: number;
  blockCount: number;
} | null> {
  if (!dbManager) {
    return null;
  }
  
  return dbManager.getStats();
}

/**
 * Execute a query with automatic retry on failure
 */
export async function executeQuery<T>(
  query: string,
  params?: any[],
  retries: number = 3
): Promise<T[]> {
  let lastError: Error | null = null;
  
  for (let i = 0; i < retries; i++) {
    try {
      const db = await getDatabase();
      const result = await db.query<T>(query, params);
      return result.rows;
    } catch (error) {
      lastError = error as Error;
      logger.warn(`Query failed (attempt ${i + 1}/${retries}): ${error}`);
      
      if (i < retries - 1) {
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
      }
    }
  }
  
  throw lastError;
}

/**
 * Execute a transaction with automatic retry
 */
export async function executeTransaction<T>(
  callback: (tx: any) => Promise<T>,
  retries: number = 3
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let i = 0; i < retries; i++) {
    try {
      const db = await getDatabase();
      return await db.transaction(callback);
    } catch (error) {
      lastError = error as Error;
      logger.warn(`Transaction failed (attempt ${i + 1}/${retries}): ${error}`);
      
      if (i < retries - 1) {
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
      }
    }
  }
  
  throw lastError;
}