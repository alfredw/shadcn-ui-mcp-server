import { PGlite } from '@electric-sql/pglite';
import { readdir, readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { logger } from '../../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface Migration {
  version: number;
  name: string;
  up: string;   // SQL to apply
  down: string; // SQL to rollback
}

export class MigrationRunner {
  private db: PGlite;
  private migrationsPath: string;

  constructor(db: PGlite) {
    this.db = db;
    this.migrationsPath = path.join(__dirname, '..', 'schemas', 'migrations');
  }

  async getCurrentVersion(): Promise<number> {
    try {
      const result = await this.db.query<{version: number | null}>(
        'SELECT MAX(version) as version FROM schema_migrations'
      );
      return result.rows[0]?.version || 0;
    } catch (error) {
      // Table might not exist yet
      logger.warn(`Failed to get current version, assuming 0: ${error}`);
      return 0;
    }
  }

  async applyMigration(migration: Migration): Promise<void> {
    const transaction = await this.db.transaction(async (tx) => {
      try {
        // Execute the migration
        await tx.exec(migration.up);
        
        // Record the migration
        await tx.query(
          'INSERT INTO schema_migrations (version, name) VALUES ($1, $2)',
          [migration.version, migration.name]
        );
        
        logger.info(`Applied migration ${migration.version}: ${migration.name}`);
      } catch (error) {
        logger.error(`Failed to apply migration ${migration.version}:`, error);
        throw error;
      }
    });
  }

  async rollbackMigration(migration: Migration): Promise<void> {
    const transaction = await this.db.transaction(async (tx) => {
      try {
        // Execute the rollback
        await tx.exec(migration.down);
        
        // Remove the migration record
        await tx.query(
          'DELETE FROM schema_migrations WHERE version = $1',
          [migration.version]
        );
        
        logger.info(`Rolled back migration ${migration.version}: ${migration.name}`);
      } catch (error) {
        logger.error(`Failed to rollback migration ${migration.version}:`, error);
        throw error;
      }
    });
  }

  async loadMigrations(): Promise<Migration[]> {
    const migrations: Migration[] = [];
    
    try {
      // Try to read migration files
      const files = await readdir(this.migrationsPath).catch(() => []);
      
      for (const file of files) {
        if (!file.endsWith('.sql')) continue;
        
        // Parse version from filename (e.g., "002_add_indexes.sql")
        const match = file.match(/^(\d+)_(.+)\.sql$/);
        if (!match) continue;
        
        const version = parseInt(match[1]);
        const name = match[2];
        
        const filePath = path.join(this.migrationsPath, file);
        const content = await readFile(filePath, 'utf-8');
        
        // Split content by special markers
        const parts = content.split(/-- DOWN/i);
        const up = parts[0].trim();
        const down = parts[1]?.trim() || '';
        
        migrations.push({
          version,
          name,
          up,
          down
        });
      }
      
      // Sort by version
      migrations.sort((a, b) => a.version - b.version);
    } catch (error) {
      logger.warn(`No migrations found or error loading migrations: ${error}`);
    }
    
    return migrations;
  }

  async runPendingMigrations(): Promise<void> {
    try {
      const currentVersion = await this.getCurrentVersion();
      const migrations = await this.loadMigrations();
      
      const pendingMigrations = migrations.filter(m => m.version > currentVersion);
      
      if (pendingMigrations.length === 0) {
        logger.info('No pending migrations');
        return;
      }
      
      logger.info(`Found ${pendingMigrations.length} pending migration(s)`);
      
      for (const migration of pendingMigrations) {
        await this.applyMigration(migration);
      }
      
      logger.info('All migrations completed successfully');
    } catch (error) {
      logger.error('Failed to run migrations:', error);
      throw error;
    }
  }

  async rollbackToVersion(targetVersion: number): Promise<void> {
    try {
      const currentVersion = await this.getCurrentVersion();
      
      if (targetVersion >= currentVersion) {
        logger.warn(`Target version ${targetVersion} is not less than current version ${currentVersion}`);
        return;
      }
      
      const migrations = await this.loadMigrations();
      const migrationsToRollback = migrations
        .filter(m => m.version > targetVersion && m.version <= currentVersion)
        .sort((a, b) => b.version - a.version); // Reverse order
      
      for (const migration of migrationsToRollback) {
        await this.rollbackMigration(migration);
      }
      
      logger.info(`Rolled back to version ${targetVersion}`);
    } catch (error) {
      logger.error('Failed to rollback migrations:', error);
      throw error;
    }
  }
}