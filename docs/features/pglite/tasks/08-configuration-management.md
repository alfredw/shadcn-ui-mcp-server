# Task 08: Configuration Management System

## Overview
Implement a comprehensive configuration management system for the PGLite cache feature. This system will handle environment variables, configuration files, runtime settings, and provide a unified interface for all cache-related configurations.

## Objectives
- Create hierarchical configuration system
- Support multiple configuration sources
- Implement configuration validation
- Provide type-safe configuration access
- Enable runtime configuration updates
- Support configuration profiles

## Technical Requirements

### Configuration Schema
```typescript
interface CacheConfiguration {
  // Storage configuration
  storage: {
    type: 'hybrid' | 'memory-only' | 'pglite-only';
    memory?: {
      enabled: boolean;
      maxSize: number;        // bytes
      ttl: number;           // seconds
      evictionPolicy: 'lru' | 'lfu' | 'fifo';
    };
    pglite?: {
      enabled: boolean;
      path?: string;         // Custom database path
      maxSize: number;       // bytes
      enableWAL: boolean;
      busyTimeout: number;   // ms
      vacuumInterval: number; // hours
    };
    github?: {
      enabled: boolean;
      token?: string;
      baseUrl: string;
      timeout: number;       // ms
      retries: number;
      userAgent?: string;
    };
  };
  
  // Cache behavior
  cache: {
    strategy: 'write-through' | 'write-behind' | 'read-through' | 'cache-aside';
    ttl: {
      components: number;    // seconds
      blocks: number;        // seconds
      metadata: number;      // seconds
    };
    prefetch: {
      enabled: boolean;
      popular: boolean;      // Prefetch popular items
      related: boolean;      // Prefetch related items
    };
    compression: {
      enabled: boolean;
      algorithm: 'gzip' | 'brotli' | 'none';
      level: number;         // 1-9
    };
  };
  
  // Performance settings
  performance: {
    batchSize: number;       // Batch operations size
    concurrency: number;     // Max concurrent operations
    queueSize: number;       // Write-behind queue size
    flushInterval: number;   // ms
  };
  
  // Monitoring configuration
  monitoring: {
    enabled: boolean;
    statsInterval: number;   // ms
    metricsRetention: number; // days
    exporters: {
      prometheus: boolean;
      json: boolean;
    };
    alerts: AlertConfig[];
  };
  
  // Circuit breaker
  circuitBreaker: {
    enabled: boolean;
    threshold: number;       // failure count
    timeout: number;         // ms
    resetTimeout: number;    // ms
  };
  
  // Feature flags
  features: {
    offlineMode: boolean;
    migration: boolean;
    analytics: boolean;
    autoSync: boolean;
    experimentalFeatures: string[];
  };
}
```

### Configuration Manager
```typescript
class ConfigurationManager {
  private config: CacheConfiguration;
  private sources: ConfigSource[];
  private validators: ConfigValidator[];
  private watchers: Map<string, ConfigWatcher[]> = new Map();
  
  constructor() {
    this.sources = [
      new EnvironmentConfigSource(),
      new FileConfigSource(),
      new DefaultConfigSource()
    ];
    
    this.validators = [
      new SchemaValidator(),
      new BusinessRuleValidator()
    ];
  }
  
  async load(): Promise<void> {
    // Load from all sources in priority order
    const configs = await Promise.all(
      this.sources.map(source => source.load())
    );
    
    // Merge configurations
    this.config = this.mergeConfigs(configs);
    
    // Validate merged configuration
    await this.validate(this.config);
    
    // Notify watchers
    this.notifyWatchers('*', this.config);
  }
  
  get<T>(path: string, defaultValue?: T): T {
    return this.getValueByPath(this.config, path, defaultValue);
  }
  
  set(path: string, value: any): void {
    this.setValueByPath(this.config, path, value);
    this.notifyWatchers(path, value);
  }
  
  watch(path: string, callback: ConfigWatcher): () => void {
    if (!this.watchers.has(path)) {
      this.watchers.set(path, []);
    }
    
    this.watchers.get(path)!.push(callback);
    
    // Return unwatch function
    return () => {
      const watchers = this.watchers.get(path);
      if (watchers) {
        const index = watchers.indexOf(callback);
        if (index > -1) {
          watchers.splice(index, 1);
        }
      }
    };
  }
}
```

### Configuration Sources
```typescript
// Environment variables
class EnvironmentConfigSource implements ConfigSource {
  async load(): Promise<Partial<CacheConfiguration>> {
    return {
      storage: {
        type: process.env.SHADCN_MCP_STORAGE_TYPE as any,
        pglite: {
          path: process.env.SHADCN_MCP_DB_PATH,
          maxSize: this.parseBytes(process.env.SHADCN_MCP_DB_MAX_SIZE)
        },
        github: {
          token: process.env.GITHUB_TOKEN || process.env.SHADCN_MCP_GITHUB_TOKEN,
          baseUrl: process.env.SHADCN_MCP_GITHUB_URL
        }
      },
      features: {
        offlineMode: process.env.SHADCN_MCP_OFFLINE === 'true',
        migration: process.env.SHADCN_MCP_ENABLE_MIGRATION !== 'false'
      }
    };
  }
}

// Configuration file
class FileConfigSource implements ConfigSource {
  private configPaths = [
    path.join(process.cwd(), 'shadcn-mcp.config.json'),
    path.join(process.cwd(), '.shadcn-mcp', 'config.json'),
    path.join(os.homedir(), '.shadcn-mcp', 'config.json')
  ];
  
  async load(): Promise<Partial<CacheConfiguration>> {
    for (const configPath of this.configPaths) {
      if (await fs.pathExists(configPath)) {
        const content = await fs.readFile(configPath, 'utf-8');
        return JSON.parse(content);
      }
    }
    
    return {};
  }
}

// Default configuration
class DefaultConfigSource implements ConfigSource {
  async load(): Promise<CacheConfiguration> {
    return {
      storage: {
        type: 'hybrid',
        memory: {
          enabled: true,
          maxSize: 50 * 1024 * 1024, // 50MB
          ttl: 3600,
          evictionPolicy: 'lru'
        },
        pglite: {
          enabled: true,
          maxSize: 100 * 1024 * 1024, // 100MB
          enableWAL: true,
          busyTimeout: 5000,
          vacuumInterval: 24
        },
        github: {
          enabled: true,
          baseUrl: 'https://api.github.com',
          timeout: 30000,
          retries: 3
        }
      },
      cache: {
        strategy: 'read-through',
        ttl: {
          components: 7 * 24 * 60 * 60, // 7 days
          blocks: 7 * 24 * 60 * 60,
          metadata: 60 * 60 // 1 hour
        },
        prefetch: {
          enabled: true,
          popular: true,
          related: false
        },
        compression: {
          enabled: false,
          algorithm: 'gzip',
          level: 6
        }
      },
      performance: {
        batchSize: 100,
        concurrency: 10,
        queueSize: 1000,
        flushInterval: 5000
      },
      monitoring: {
        enabled: true,
        statsInterval: 5000,
        metricsRetention: 30,
        exporters: {
          prometheus: false,
          json: true
        },
        alerts: []
      },
      circuitBreaker: {
        enabled: true,
        threshold: 5,
        timeout: 60000,
        resetTimeout: 30000
      },
      features: {
        offlineMode: false,
        migration: true,
        analytics: true,
        autoSync: false,
        experimentalFeatures: []
      }
    };
  }
}
```

### Configuration Validation
```typescript
class SchemaValidator implements ConfigValidator {
  private schema = z.object({
    storage: z.object({
      type: z.enum(['hybrid', 'memory-only', 'pglite-only']),
      memory: z.object({
        enabled: z.boolean(),
        maxSize: z.number().positive(),
        ttl: z.number().nonnegative(),
        evictionPolicy: z.enum(['lru', 'lfu', 'fifo'])
      }).optional(),
      // ... rest of schema
    }),
    // ... rest of configuration
  });
  
  validate(config: any): ValidationResult {
    try {
      this.schema.parse(config);
      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        errors: error.errors
      };
    }
  }
}

class BusinessRuleValidator implements ConfigValidator {
  validate(config: CacheConfiguration): ValidationResult {
    const errors: string[] = [];
    
    // Memory size must be less than PGLite size
    if (config.storage.memory?.maxSize >= config.storage.pglite?.maxSize) {
      errors.push('Memory cache size must be less than PGLite cache size');
    }
    
    // At least one storage provider must be enabled
    const enabledCount = [
      config.storage.memory?.enabled,
      config.storage.pglite?.enabled,
      config.storage.github?.enabled
    ].filter(Boolean).length;
    
    if (enabledCount === 0) {
      errors.push('At least one storage provider must be enabled');
    }
    
    // TTL validation
    if (config.cache.ttl.metadata > config.cache.ttl.components) {
      errors.push('Metadata TTL should not exceed component TTL');
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
}
```

### Configuration Profiles
```typescript
class ConfigurationProfiles {
  private profiles: Map<string, Partial<CacheConfiguration>> = new Map([
    ['development', {
      storage: {
        type: 'memory-only',
        memory: { maxSize: 200 * 1024 * 1024 } // 200MB for dev
      },
      monitoring: { enabled: true },
      features: { experimentalFeatures: ['*'] }
    }],
    
    ['production', {
      storage: {
        type: 'hybrid',
        memory: { maxSize: 50 * 1024 * 1024 },
        pglite: { maxSize: 500 * 1024 * 1024 }
      },
      cache: { 
        strategy: 'read-through',
        compression: { enabled: true }
      },
      monitoring: { 
        exporters: { prometheus: true }
      }
    }],
    
    ['offline', {
      storage: {
        type: 'pglite-only',
        github: { enabled: false }
      },
      features: { offlineMode: true }
    }]
  ]);
  
  getProfile(name: string): Partial<CacheConfiguration> | undefined {
    return this.profiles.get(name);
  }
  
  applyProfile(name: string, baseConfig: CacheConfiguration): CacheConfiguration {
    const profile = this.getProfile(name);
    if (!profile) {
      throw new Error(`Unknown profile: ${name}`);
    }
    
    return deepMerge(baseConfig, profile);
  }
}
```

### Runtime Configuration API
```typescript
class RuntimeConfigAPI {
  constructor(private configManager: ConfigurationManager) {}
  
  // RESTful API endpoints
  async getConfig(req: Request, res: Response) {
    const path = req.params.path || '';
    const value = this.configManager.get(path);
    res.json({ path, value });
  }
  
  async updateConfig(req: Request, res: Response) {
    const { path, value } = req.body;
    
    try {
      // Validate the update
      const tempConfig = { ...this.configManager.config };
      this.setValueByPath(tempConfig, path, value);
      await this.configManager.validate(tempConfig);
      
      // Apply the update
      this.configManager.set(path, value);
      
      res.json({ success: true, path, value });
      
    } catch (error) {
      res.status(400).json({ 
        success: false, 
        error: error.message 
      });
    }
  }
  
  async resetConfig(req: Request, res: Response) {
    await this.configManager.load();
    res.json({ success: true, message: 'Configuration reset to defaults' });
  }
}
```

### Configuration CLI Commands
```typescript
// Add to CLI
program
  .command('config')
  .description('Configuration management commands')
  .command('show [path]')
  .description('Show current configuration')
  .action(async (path) => {
    const config = configManager.get(path);
    console.log(JSON.stringify(config, null, 2));
  });

program
  .command('config set <path> <value>')
  .description('Set configuration value')
  .action(async (path, value) => {
    try {
      configManager.set(path, JSON.parse(value));
      console.log(`✅ Configuration updated: ${path} = ${value}`);
    } catch (error) {
      console.error(`❌ Failed to update configuration: ${error.message}`);
    }
  });

program
  .command('config profile <name>')
  .description('Apply configuration profile')
  .action(async (name) => {
    const profiles = new ConfigurationProfiles();
    const config = profiles.applyProfile(name, configManager.config);
    await configManager.save(config);
    console.log(`✅ Applied profile: ${name}`);
  });
```

### Implementation Details

1. **Directory Structure**:
   ```
   src/config/
   ├── manager.ts
   ├── sources/
   │   ├── environment.ts
   │   ├── file.ts
   │   └── defaults.ts
   ├── validators/
   │   ├── schema.ts
   │   └── business-rules.ts
   ├── profiles.ts
   └── api.ts
   ```

2. **Configuration Loading Order**:
   1. Default configuration
   2. Configuration files
   3. Environment variables
   4. Runtime updates

3. **Hot Reload Support**:
   - Watch configuration files
   - Reload without restart
   - Notify dependent components

### Acceptance Criteria
- [ ] Configuration loads from all sources correctly
- [ ] Validation catches invalid configurations
- [ ] Runtime updates work without restart
- [ ] Configuration profiles apply correctly
- [ ] Type-safe configuration access
- [ ] Configuration changes trigger appropriate actions
- [ ] CLI commands work as expected

### Testing Requirements
- Unit tests for configuration merging
- Validation tests for all rules
- Integration tests for sources
- Profile application tests
- Runtime update tests
- Configuration watching tests

### Dependencies
- npm packages: zod, dotenv, js-yaml

### Estimated Effort
- 2-3 days

### Example Usage
```typescript
// Initialize configuration
const configManager = new ConfigurationManager();
await configManager.load();

// Access configuration
const dbPath = configManager.get('storage.pglite.path');
const hitRate = configManager.get('monitoring.alerts[0].threshold', 80);

// Watch for changes
const unwatch = configManager.watch('cache.ttl.components', (newValue) => {
  console.log(`Component TTL changed to: ${newValue}`);
  // Update cache behavior
});

// Update configuration
configManager.set('features.offlineMode', true);

// Apply profile
const profiles = new ConfigurationProfiles();
const prodConfig = profiles.applyProfile('production', currentConfig);

// Environment variables
SHADCN_MCP_STORAGE_TYPE=hybrid
SHADCN_MCP_DB_PATH=/custom/path/cache.db
SHADCN_MCP_DB_MAX_SIZE=200MB
SHADCN_MCP_OFFLINE=true
```

### Notes
- Consider adding configuration encryption for sensitive values
- Add configuration export/import functionality
- Support for A/B testing configurations
- Document all configuration options