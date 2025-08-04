/**
 * File-based configuration source
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir, tmpdir } from 'os';
import { ConfigSource, CacheConfiguration } from '../schemas.js';

export class FileConfigSource implements ConfigSource {
  readonly name = 'FileConfigSource';
  readonly priority = 2; // Medium priority - between defaults and environment
  
  private readonly configPaths = [
    join(process.cwd(), 'shadcn-mcp.config.json'),
    join(process.cwd(), '.shadcn-mcp', 'config.json'),
    join(homedir(), '.shadcn-mcp', 'config.json'),
    join(tmpdir(), 'shadcn-mcp', 'config.json')
  ];
  
  async load(): Promise<Partial<CacheConfiguration>> {
    for (const configPath of this.configPaths) {
      try {
        const exists = await this.fileExists(configPath);
        if (exists) {
          const content = await fs.readFile(configPath, 'utf-8');
          const config = JSON.parse(content);
          
          // Validate that it's an object
          if (typeof config === 'object' && config !== null) {
            return config;
          }
        }
      } catch (error) {
        // Continue to next path if this one fails
        continue;
      }
    }
    
    // No config file found
    return {};
  }
  
  /**
   * Save configuration to the primary config file location
   */
  async save(config: Partial<CacheConfiguration>): Promise<void> {
    const configPath = this.configPaths[1]; // Use .shadcn-mcp/config.json in cwd
    const configDir = join(process.cwd(), '.shadcn-mcp');
    
    try {
      // Ensure directory exists
      await fs.mkdir(configDir, { recursive: true });
      
      // Write configuration
      const content = JSON.stringify(config, null, 2);
      await fs.writeFile(configPath, content, 'utf-8');
    } catch (error) {
      throw new Error(`Failed to save configuration to ${configPath}: ${error}`);
    }
  }
  
  /**
   * Get the primary config file path for saving
   */
  getPrimaryConfigPath(): string {
    return this.configPaths[1];
  }
  
  /**
   * Check if a file exists
   */
  private async fileExists(path: string): Promise<boolean> {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }
  
  /**
   * Load configuration from a specific file path
   */
  async loadFromPath(configPath: string): Promise<Partial<CacheConfiguration>> {
    try {
      const content = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(content);
      
      if (typeof config === 'object' && config !== null) {
        return config;
      }
      
      throw new Error('Configuration file does not contain a valid object');
    } catch (error) {
      throw new Error(`Failed to load configuration from ${configPath}: ${error}`);
    }
  }
  
  /**
   * Save configuration to a specific file path
   */
  async saveToPath(config: Partial<CacheConfiguration>, configPath: string): Promise<void> {
    try {
      // Ensure directory exists
      const configDir = configPath.substring(0, configPath.lastIndexOf('/'));
      await fs.mkdir(configDir, { recursive: true });
      
      // Write configuration
      const content = JSON.stringify(config, null, 2);
      await fs.writeFile(configPath, content, 'utf-8');
    } catch (error) {
      throw new Error(`Failed to save configuration to ${configPath}: ${error}`);
    }
  }
}