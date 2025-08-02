import { PGLiteManager } from './manager.js';
import { getStoragePath } from '../utils/paths.js';

/**
 * Example usage of PGLite database initialization
 */
async function exampleUsage() {
  // Create database manager with custom configuration
  const dbManager = new PGLiteManager({
    path: getStoragePath(),
    maxSizeBytes: 100 * 1024 * 1024, // 100MB
    enableWAL: true,
    busyTimeout: 5000
  });

  try {
    // Initialize the database
    await dbManager.initialize();
    console.log('Database initialized successfully');
    
    // Get database connection
    const db = await dbManager.getConnection();
    
    // Check health
    const isHealthy = await dbManager.checkHealth();
    console.log(`Database health: ${isHealthy ? 'Good' : 'Bad'}`);
    
    // Get statistics
    const stats = await dbManager.getStats();
    console.log('Database statistics:', stats);
    
    // Example: Insert a component
    await db.query(`
      INSERT INTO components (framework, name, source_code, metadata)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (framework, name) DO UPDATE SET
        source_code = EXCLUDED.source_code,
        metadata = EXCLUDED.metadata,
        cached_at = CURRENT_TIMESTAMP,
        access_count = components.access_count + 1,
        accessed_at = CURRENT_TIMESTAMP
    `, [
      'react',
      'button',
      'export default function Button() { return <button>Click me</button>; }',
      JSON.stringify({ version: '1.0.0', author: 'shadcn' })
    ]);
    
    // Example: Query components
    const result = await db.query(`
      SELECT * FROM components 
      WHERE framework = $1 
      ORDER BY accessed_at DESC 
      LIMIT 10
    `, ['react']);
    
    console.log(`Found ${result.rows.length} components`);
    result.rows.forEach((row: any) => {
      console.log(`- ${row.name} (accessed ${row.access_count} times)`);
    });
    
  } catch (error) {
    console.error('Database operation failed:', error);
    // In a real application, you might want to fallback to in-memory storage
  } finally {
    // Always close the database when done
    await dbManager.close();
  }
}

// Run the example if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  exampleUsage().catch(console.error);
}