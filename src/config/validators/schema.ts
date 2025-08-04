/**
 * Zod-based schema validator for configuration
 */

import { ConfigValidator, ValidationResult, CacheConfiguration } from '../schemas.js';
import { cacheConfigurationSchema, partialCacheConfigurationSchema } from '../schemas.js';

export class SchemaValidator implements ConfigValidator {
  readonly name = 'SchemaValidator';
  
  /**
   * Validate complete configuration against schema
   */
  validate(config: Partial<CacheConfiguration>): ValidationResult {
    try {
      // Use partial schema for incomplete configurations
      partialCacheConfigurationSchema.parse(config);
      return { valid: true };
    } catch (error: any) {
      const errors = error.errors?.map((err: any) => {
        const path = err.path.join('.');
        return `${path}: ${err.message}`;
      }) || [error.message];
      
      return {
        valid: false,
        errors
      };
    }
  }
  
  /**
   * Validate complete configuration (stricter validation)
   */
  validateComplete(config: CacheConfiguration): ValidationResult {
    try {
      cacheConfigurationSchema.parse(config);
      return { valid: true };
    } catch (error: any) {
      const errors = error.errors?.map((err: any) => {
        const path = err.path.join('.');
        return `${path}: ${err.message}`;
      }) || [error.message];
      
      return {
        valid: false,
        errors
      };
    }
  }
}