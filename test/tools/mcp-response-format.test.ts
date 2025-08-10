/**
 * Test MCP Response Format Handling
 * Ensures tools properly handle both string responses (from API) and object responses (from PGLite storage)
 * This prevents regressions like the Zod validation error that occurred when storage integration was added
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock the storage integration module BEFORE importing tool handlers
vi.mock('../../build/utils/storage-integration.js', () => ({
  getCachedData: vi.fn(),
  generateComponentKey: vi.fn(),
  generateComponentDemoKey: vi.fn(),
}));

// Mock framework utils
vi.mock('../../build/utils/framework.js', () => ({
  getAxiosImplementation: vi.fn(),
}));

// Mock logger
vi.mock('../../build/utils/logger.js', () => ({
  logError: vi.fn(),
}));

import { handleGetComponent } from '../../build/tools/components/get-component.js';
import { handleGetComponentDemo } from '../../build/tools/components/get-component-demo.js';
import { getCachedData } from '../../build/utils/storage-integration.js';

describe('MCP Response Format Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('get_component tool', () => {
    it('should handle string response from API (original format)', async () => {
      // Mock getCachedData to return a plain string (original API response)
      const mockSourceCode = 'export const Button = () => <button>Click me</button>;';
      vi.mocked(getCachedData).mockResolvedValue(mockSourceCode);

      const result = await handleGetComponent({ componentName: 'button' });

      expect(result).toEqual({
        content: [{ type: "text", text: mockSourceCode }]
      });
    });

    it('should handle Component object response from PGLite storage', async () => {
      // Mock getCachedData to return a Component object (from PGLite storage)
      const mockComponent = {
        framework: 'react',
        name: 'button',
        sourceCode: 'export const Button = () => <button>Click me</button>;',
        demoCode: 'import { Button } from "./button";',
        metadata: { dependencies: [] },
        dependencies: [],
        registryDependencies: []
      };
      vi.mocked(getCachedData).mockResolvedValue(mockComponent);

      const result = await handleGetComponent({ componentName: 'button' });

      expect(result).toEqual({
        content: [{ type: "text", text: mockComponent.sourceCode }]
      });
    });

    it('should handle unexpected object format by JSON stringifying', async () => {
      // Mock getCachedData to return an unexpected object format
      const mockUnexpectedObject = { unexpectedProperty: 'some value' };
      vi.mocked(getCachedData).mockResolvedValue(mockUnexpectedObject);

      const result = await handleGetComponent({ componentName: 'button' });

      expect(result).toEqual({
        content: [{ type: "text", text: JSON.stringify(mockUnexpectedObject, null, 2) }]
      });
    });

    it('should handle null/undefined responses gracefully', async () => {
      vi.mocked(getCachedData).mockResolvedValue(null);

      const result = await handleGetComponent({ componentName: 'button' });

      expect(result).toEqual({
        content: [{ type: "text", text: "null" }]
      });
    });
  });

  describe('get_component_demo tool', () => {
    it('should handle string response from API (original format)', async () => {
      // Mock getCachedData to return a plain string (original API response)
      const mockDemoCode = 'import { Button } from "./button"; export default () => <Button />';
      vi.mocked(getCachedData).mockResolvedValue(mockDemoCode);

      const result = await handleGetComponentDemo({ componentName: 'button' });

      expect(result).toEqual({
        content: [{ type: "text", text: mockDemoCode }]
      });
    });

    it('should handle Component object response from PGLite storage', async () => {
      // Mock getCachedData to return a Component object (from PGLite storage)
      const mockComponent = {
        framework: 'react',
        name: 'button',
        sourceCode: 'export const Button = () => <button>Click me</button>;',
        demoCode: 'import { Button } from "./button"; export default () => <Button />',
        metadata: { dependencies: [] },
        dependencies: [],
        registryDependencies: []
      };
      vi.mocked(getCachedData).mockResolvedValue(mockComponent);

      const result = await handleGetComponentDemo({ componentName: 'button' });

      expect(result).toEqual({
        content: [{ type: "text", text: mockComponent.demoCode }]
      });
    });

    it('should handle Component object without demoCode property', async () => {
      // Mock getCachedData to return a Component object without demoCode
      const mockComponent = {
        framework: 'react',
        name: 'button',
        sourceCode: 'export const Button = () => <button>Click me</button>;',
        // demoCode is missing
        metadata: { dependencies: [] },
        dependencies: [],
        registryDependencies: []
      };
      vi.mocked(getCachedData).mockResolvedValue(mockComponent);

      const result = await handleGetComponentDemo({ componentName: 'button' });

      // Since demoCode is missing but object has the property structure, should return empty string
      expect(result).toEqual({
        content: [{ type: "text", text: '' }]
      });
    });

    it('should handle unexpected object format by JSON stringifying', async () => {
      // Mock getCachedData to return an unexpected object format
      const mockUnexpectedObject = { unexpectedProperty: 'some demo value' };
      vi.mocked(getCachedData).mockResolvedValue(mockUnexpectedObject);

      const result = await handleGetComponentDemo({ componentName: 'button' });

      expect(result).toEqual({
        content: [{ type: "text", text: JSON.stringify(mockUnexpectedObject, null, 2) }]
      });
    });
  });

  describe('MCP Protocol Compliance', () => {
    it('should always return content array with text type', async () => {
      // Test that the response structure always matches MCP protocol expectations
      vi.mocked(getCachedData).mockResolvedValue('test content');

      const componentResult = await handleGetComponent({ componentName: 'button' });
      const demoResult = await handleGetComponentDemo({ componentName: 'button' });

      // Check structure compliance
      expect(componentResult).toHaveProperty('content');
      expect(Array.isArray(componentResult.content)).toBe(true);
      expect(componentResult.content[0]).toHaveProperty('type', 'text');
      expect(componentResult.content[0]).toHaveProperty('text');
      expect(typeof componentResult.content[0].text).toBe('string');

      expect(demoResult).toHaveProperty('content');
      expect(Array.isArray(demoResult.content)).toBe(true);
      expect(demoResult.content[0]).toHaveProperty('type', 'text');
      expect(demoResult.content[0]).toHaveProperty('text');
      expect(typeof demoResult.content[0].text).toBe('string');
    });

    it('should never return objects as text property (the original bug)', async () => {
      // This test specifically prevents the regression that caused the Zod validation error
      const mockComponentObject = {
        framework: 'react',
        name: 'button',
        sourceCode: 'export const Button = () => <button>Click me</button>;'
      };
      vi.mocked(getCachedData).mockResolvedValue(mockComponentObject);

      const result = await handleGetComponent({ componentName: 'button' });

      // The text property should NEVER be an object - this was the original bug
      expect(typeof result.content[0].text).toBe('string');
      expect(result.content[0].text).not.toBe('[object Object]');
      
      // And it should be the actual source code, not the JSON representation
      expect(result.content[0].text).toBe(mockComponentObject.sourceCode);
    });
  });
});