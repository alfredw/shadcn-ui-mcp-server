/**
 * Partial Response Handler
 * 
 * Handles incomplete data scenarios and attempts field-level completion
 * by fetching missing data from the appropriate sources.
 */

import { getAxiosImplementation } from './framework.js';
import { logger } from './logger.js';

/**
 * Partial data result
 */
export interface PartialDataResult<T> {
  data: T;
  isPartial: boolean;
  missingFields: string[];
  completionAttempted: boolean;
  completionErrors?: string[];
}

/**
 * Field completion strategy
 */
export interface FieldCompletionStrategy {
  required: string[];
  optional: string[];
  fetchMethod: 'component' | 'block' | 'metadata' | 'demo';
}

/**
 * Partial Response Handler
 * 
 * Handles incomplete data by attempting to fetch missing fields
 * and providing graceful degradation for partial responses.
 */
export class PartialResponseHandler {
  private completionStrategies = new Map<string, FieldCompletionStrategy>();
  
  constructor() {
    this.initializeDefaultStrategies();
  }
  
  /**
   * Initialize default completion strategies for common data types
   */
  private initializeDefaultStrategies(): void {
    // Component data completion strategy
    this.completionStrategies.set('component', {
      required: ['name', 'code'],
      optional: ['demo', 'metadata', 'dependencies'],
      fetchMethod: 'component'
    });
    
    // Block data completion strategy
    this.completionStrategies.set('block', {
      required: ['name', 'code'],
      optional: ['components', 'description', 'tags'],
      fetchMethod: 'block'
    });
    
    // Metadata completion strategy
    this.completionStrategies.set('metadata', {
      required: ['name', 'type'],
      optional: ['description', 'tags', 'dependencies', 'registryDependencies'],
      fetchMethod: 'metadata'
    });
  }
  
  /**
   * Handle partial data by attempting to complete missing fields
   */
  async handlePartialData<T extends Record<string, any>>(
    key: string,
    partialData: Partial<T>,
    requiredFields: string[],
    strategy?: FieldCompletionStrategy
  ): Promise<PartialDataResult<T>> {
    // Determine strategy based on key if not provided
    if (!strategy) {
      strategy = this.getStrategyFromKey(key);
    }
    
    // Check if we have all required fields
    const missingRequiredFields = requiredFields.filter(
      field => !(field in partialData) || partialData[field] === undefined
    );
    
    const missingOptionalFields = strategy?.optional?.filter(
      field => !(field in partialData) || partialData[field] === undefined
    ) || [];
    
    const allMissingFields = [...missingRequiredFields, ...missingOptionalFields];
    
    // If no missing fields, return as-is
    if (allMissingFields.length === 0) {
      return {
        data: partialData as T,
        isPartial: false,
        missingFields: [],
        completionAttempted: false
      };
    }
    
    // Attempt to fetch missing fields
    logger.info(`Attempting to complete missing fields for ${key}: ${allMissingFields.join(', ')}`);
    
    const completionResult = await this.attemptFieldCompletion(
      key,
      allMissingFields,
      strategy
    );
    
    // Merge with existing data
    const completeData = {
      ...partialData,
      ...completionResult.fetchedData
    } as T;
    
    // Check remaining missing fields
    const stillMissingRequired = requiredFields.filter(
      field => !(field in completeData) || completeData[field] === undefined
    );
    
    const stillMissingOptional = strategy?.optional?.filter(
      field => !(field in completeData) || completeData[field] === undefined
    ) || [];
    
    const stillMissing = [...stillMissingRequired, ...stillMissingOptional];
    
    return {
      data: completeData,
      isPartial: stillMissing.length > 0,
      missingFields: stillMissing,
      completionAttempted: true,
      completionErrors: completionResult.errors.length > 0 ? completionResult.errors : undefined
    };
  }
  
  /**
   * Check if data is partial based on required fields
   */
  isDataPartial<T extends Record<string, any>>(
    data: T,
    requiredFields: string[]
  ): boolean {
    return requiredFields.some(
      field => !(field in data) || data[field] === undefined
    );
  }
  
  /**
   * Mark data as partial with metadata
   */
  markAsPartial<T extends Record<string, any>>(
    data: T,
    missingFields: string[]
  ): T & { _partial: boolean; _missingFields: string[] } {
    return {
      ...data,
      _partial: true,
      _missingFields: missingFields
    };
  }
  
  /**
   * Check if data is marked as partial
   */
  isMarkedAsPartial(data: any): boolean {
    return data && typeof data === 'object' && data._partial === true;
  }
  
  /**
   * Get missing fields from marked partial data
   */
  getMarkedMissingFields(data: any): string[] {
    if (this.isMarkedAsPartial(data) && Array.isArray(data._missingFields)) {
      return data._missingFields;
    }
    return [];
  }
  
  /**
   * Attempt to fetch missing fields from the appropriate source
   */
  private async attemptFieldCompletion(
    key: string,
    missingFields: string[],
    strategy: FieldCompletionStrategy
  ): Promise<{ fetchedData: any; errors: string[] }> {
    const errors: string[] = [];
    let fetchedData: any = {};
    
    try {
      const freshData = await this.fetchCompleteData(key, strategy.fetchMethod);
      
      // Extract only the missing fields
      for (const field of missingFields) {
        if (field in freshData && freshData[field] !== undefined) {
          fetchedData[field] = freshData[field];
        }
      }
      
      logger.info(`Successfully fetched ${Object.keys(fetchedData).length} missing fields for ${key}`);
      
    } catch (error) {
      const errorMessage = `Failed to fetch missing fields for ${key}: ${(error as Error).message}`;
      logger.error(errorMessage);
      errors.push(errorMessage);
      
      // Try to provide fallback data for critical fields
      fetchedData = this.provideFallbackData(key, missingFields);
    }
    
    return { fetchedData, errors };
  }
  
  /**
   * Fetch complete data from the appropriate source
   */
  private async fetchCompleteData(key: string, fetchMethod: string): Promise<any> {
    const axios = await getAxiosImplementation();
    const parts = key.split(':');
    
    if (parts.length < 3) {
      throw new Error(`Invalid key format: ${key}`);
    }
    
    const [resourceType, framework, name] = parts;
    
    try {
      switch (fetchMethod) {
        case 'component':
          if (resourceType === 'component') {
            const code = await axios.getComponentSource(name);
            const metadata = await axios.getComponentMetadata(name);
            
            let demo;
            try {
              demo = await axios.getComponentDemo(name);
            } catch {
              // Demo is optional
              demo = null;
            }
            
            return {
              name,
              code,
              metadata,
              demo,
              type: 'component',
              framework
            };
          }
          break;
          
        case 'block':
          if (resourceType === 'block') {
            const blockData = await axios.getBlockCode(name, true);
            return {
              name,
              ...blockData,
              type: 'block',
              framework
            };
          }
          break;
          
        case 'metadata':
          if (resourceType === 'component') {
            return await axios.getComponentMetadata(name);
          }
          break;
          
        case 'demo':
          if (resourceType === 'component') {
            const demo = await axios.getComponentDemo(name);
            return { demo };
          }
          break;
          
        default:
          throw new Error(`Unknown fetch method: ${fetchMethod}`);
      }
      
      throw new Error(`Unsupported resource type '${resourceType}' for fetch method '${fetchMethod}'`);
      
    } catch (error) {
      throw new Error(`Failed to fetch ${fetchMethod} data for ${name}: ${(error as Error).message}`);
    }
  }
  
  /**
   * Provide fallback data for missing critical fields
   */
  private provideFallbackData(key: string, missingFields: string[]): any {
    const fallbackData: any = {};
    const parts = key.split(':');
    const name = parts[2] || 'unknown';
    
    for (const field of missingFields) {
      switch (field) {
        case 'name':
          fallbackData.name = name;
          break;
        case 'type':
          fallbackData.type = parts[0] || 'unknown';
          break;
        case 'framework':
          fallbackData.framework = parts[1] || 'react';
          break;
        case 'code':
          fallbackData.code = `// Component '${name}' code not available`;
          break;
        case 'description':
          fallbackData.description = `${name} component`;
          break;
        case 'tags':
          fallbackData.tags = [];
          break;
        case 'dependencies':
          fallbackData.dependencies = [];
          break;
        case 'registryDependencies':
          fallbackData.registryDependencies = [];
          break;
        default:
          // Don't provide fallback for unknown fields
          break;
      }
    }
    
    return fallbackData;
  }
  
  /**
   * Determine completion strategy from key
   */
  private getStrategyFromKey(key: string): FieldCompletionStrategy {
    const parts = key.split(':');
    const resourceType = parts[0];
    
    const strategy = this.completionStrategies.get(resourceType);
    if (strategy) {
      return strategy;
    }
    
    // Default strategy
    return {
      required: ['name'],
      optional: ['type', 'description'],
      fetchMethod: 'component'
    };
  }
  
  /**
   * Add custom completion strategy
   */
  addCompletionStrategy(type: string, strategy: FieldCompletionStrategy): void {
    this.completionStrategies.set(type, strategy);
  }
  
  /**
   * Remove completion strategy
   */
  removeCompletionStrategy(type: string): void {
    this.completionStrategies.delete(type);
  }
  
  /**
   * Get all available completion strategies
   */
  getCompletionStrategies(): Map<string, FieldCompletionStrategy> {
    return new Map(this.completionStrategies);
  }
}