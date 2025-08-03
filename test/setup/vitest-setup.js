/**
 * Vitest-specific test setup
 * Uses the unified test setup with Vitest's mocking system
 */

import { vi, beforeEach, afterEach } from 'vitest';
import { createStorageIntegrationMocks } from './test-setup.js';

// Create mock implementations
const storageIntegrationMocks = createStorageIntegrationMocks();

// Mock storage integration modules at the top level (hoisted)
vi.mock('../../build/utils/storage-integration.js', () => storageIntegrationMocks);
vi.mock('../../../build/utils/storage-integration.js', () => storageIntegrationMocks);

// Mock readline (note: using 'readline' not 'node:readline' to match import)
vi.mock('readline', () => ({
  createInterface: () => ({
    question: (prompt, callback) => {
      // Default to 'y' for confirmations
      process.nextTick(() => callback('y'));
    },
    close: () => {}
  })
}));

// Mock ora spinner
vi.mock('ora', () => ({
  default: () => ({
    start: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    warn: vi.fn().mockReturnThis(),
    info: vi.fn().mockReturnThis()
  })
}));

// Mock tool handlers
vi.mock('../../build/tools/index.js', () => ({
  get_component: vi.fn().mockResolvedValue({
    content: [{
      type: 'text',
      text: JSON.stringify({
        name: 'button',
        sourceCode: 'export default function Button() { return <button>Click me</button>; }',
        metadata: { description: 'A button component' }
      })
    }]
  }),
  get_block: vi.fn().mockResolvedValue({
    content: [{
      type: 'text',
      text: JSON.stringify({
        name: 'dashboard-01',
        files: { 'page.tsx': 'export default function Dashboard() { return <div>Dashboard</div>; }' },
        metadata: { category: 'dashboard' }
      })
    }]
  }),
  list_components: vi.fn().mockResolvedValue({
    content: [{
      type: 'text',
      text: JSON.stringify(['button', 'card', 'input'])
    }]
  }),
  list_blocks: vi.fn().mockResolvedValue({
    content: [{
      type: 'text',
      text: JSON.stringify(['dashboard-01', 'auth-01'])
    }]
  })
}));

// Global setup for all Vitest tests
beforeEach(() => {
  // Clear all mocks before each test
  vi.clearAllMocks();
});

afterEach(() => {
  // Restore mocks after each test
  vi.restoreAllMocks();
});