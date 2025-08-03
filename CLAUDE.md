# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Build and Development
```bash
# Build the TypeScript project
npm run build

# Clean build artifacts
npm run clean

# Run in development mode (builds then runs)
npm run dev

# Start the compiled server
npm start

# Run tests
npm test

# Run examples
npm run examples
```

### Publishing
```bash
# Prepare for publishing (clean, build, set permissions)
npm run prepublishOnly
```

## Architecture Overview

This is a Model Context Protocol (MCP) server that provides AI assistants with access to shadcn/ui components. The server acts as a bridge between MCP-compatible clients and the shadcn/ui GitHub repository.

### Core Components

1. **MCP Server Setup** (`src/index.ts`): 
   - Entry point that initializes the MCP server with stdio transport
   - Handles command-line arguments for GitHub API key and framework selection
   - Supports both React (shadcn/ui) and Svelte (shadcn-svelte) frameworks

2. **Request Handler** (`src/handler.ts`):
   - Central request routing with error handling and circuit breaker protection
   - Implements handlers for resources, tools, and prompts
   - Uses Zod for input validation

3. **Tools** (`src/tools/`):
   - Component tools: get/list components, demos, metadata
   - Block tools: get/list UI blocks (dashboards, calendars, etc.)
   - Repository tools: browse directory structure

4. **Utils** (`src/utils/`):
   - `axios.ts` / `axios-svelte.ts`: Framework-specific HTTP clients with GitHub API integration
   - `cache.ts`: In-memory caching to reduce API calls
   - `circuit-breaker.ts`: Prevents cascading failures from external API issues
   - `logger.ts`: Winston-based logging system
   - `framework.ts`: Framework selection and validation logic

### Key Design Patterns

- **Framework Abstraction**: The server dynamically switches between React and Svelte implementations based on configuration
- **Circuit Breaker Pattern**: Protects against GitHub API failures and rate limiting
- **Caching Strategy**: In-memory cache reduces API calls and improves response times
- **Error Handling**: Comprehensive error handling with proper MCP error responses

### External Dependencies

- GitHub API: Primary data source for component code and metadata
- MCP SDK: Protocol implementation for AI assistant communication
- Key libraries: axios (HTTP), cheerio (HTML parsing), winston (logging), zod (validation)

### Important Notes

- The server defaults to React framework but can be switched to Svelte via `--framework svelte`
- GitHub API token is optional but recommended (60 vs 5000 requests/hour)
- All component fetching goes through the configured axios instance which handles framework-specific paths
- The server uses stdio transport for MCP communication

## Testing Best Practices

### CLI Testing Methodology

**✅ DO: Behavior-Based Testing**
- Test that functions perform correct operations (storage calls, business logic)
- Verify function calls and side effects rather than output formatting
- Focus on testing the actual behavior users care about

```typescript
// ✅ Good: Test actual behavior
expect(isStorageInitialized).toHaveBeenCalled();
expect(getStorageStats).toHaveBeenCalled();
expect(getCircuitBreakerStatus).toHaveBeenCalled();
```

**❌ DON'T: Console.log Spy Testing**
- Avoid testing console output in CLI commands with complex async operations
- Console.log spies create race conditions with spinner systems
- Testing implementation details rather than user-facing behavior

```typescript
// ❌ Bad: Brittle implementation testing
expect(consoleSpy.log).toHaveBeenCalled();
expect(output).toContain('Cache Statistics');
```

### Async/Sync Mocking

**Always match the actual function signature:**

```typescript
// ✅ Correct: getStorageStats() is synchronous
vi.mocked(getStorageStats).mockReturnValue(mockStats);

// ❌ Wrong: Creates race conditions
vi.mocked(getStorageStats).mockResolvedValue(mockStats);
```

### Test Environment Setup

**For CLI commands:**
- Set `NODE_ENV=development` in tests to enable console output from spinners
- Focus on verifying storage operations rather than console capture
- Follow the pattern from `test/cli/cache-stats.vitest.test.ts` for CLI testing

### Key Lessons Learned

1. **Test behavior, not implementation details** - verify operations, not output formatting
2. **Console.log spies are anti-pattern** for complex async CLI systems  
3. **Follow proven patterns** - working tests show the right approach
4. **Focus on business logic** - storage operations are what matter

### Working Test Examples

- `test/cli/cache-stats.vitest.test.ts` - ✅ Correct CLI testing pattern
- `test/cli/cli-integration.test.ts` - ✅ Fixed to use behavior-based testing
- `test/storage/providers/pglite-storage-provider.test.ts` - ✅ Comprehensive storage testing