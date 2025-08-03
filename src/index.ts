#!/usr/bin/env node
/**
 * Shadcn UI v4 MCP Server
 * 
 * A Model Context Protocol server for shadcn/ui v4 components.
 * Provides AI assistants with access to component source code, demos, blocks, and metadata.
 * 
 * Usage:
 *   npx shadcn-ui-mcp-server
 *   npx shadcn-ui-mcp-server --github-api-key YOUR_TOKEN
 *   npx shadcn-ui-mcp-server -g YOUR_TOKEN
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Command } from 'commander';
import { setupHandlers } from './handler.js';
import { validateFrameworkSelection, getAxiosImplementation } from './utils/framework.js';
import { initializeStorage, disposeStorage } from './utils/storage-integration.js';
import { setupCacheCommands, setupCacheFlags, handleCacheFlags, isCacheCommand, showCacheHelp } from './cli/index.js';
import { z } from 'zod';
import { 
  toolHandlers,
  toolSchemas
} from './tools/index.js';
import { logError, logInfo, logWarning } from './utils/logger.js';


/**
 * Setup and parse command line arguments using Commander.js
 */
async function setupCommandLine() {
  const program = new Command();

  // Read version from package.json
  let version = '1.0.3';
  try {
    const fs = await import('fs');
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const packagePath = path.join(__dirname, '..', 'package.json');
    
    const packageContent = fs.readFileSync(packagePath, 'utf8');
    const packageJson = JSON.parse(packageContent);
    version = packageJson.version;
  } catch (error) {
    // Use default version
  }

  // Configure main program
  program
    .name('shadcn-ui-mcp-server')
    .description('A Model Context Protocol (MCP) server for shadcn/ui components')
    .version(version, '-v, --version', 'Show version information')
    .option('-g, --github-api-key <token>', 'GitHub Personal Access Token for API access')
    .option('-f, --framework <framework>', 'Framework to use: react or svelte', 'react')
    .helpOption('-h, --help', 'Show help information')
    .action(async (options) => {
      // Handle cache flags in the main action
      const cacheHandled = await handleCacheFlags(options);
      if (cacheHandled) {
        return;
      }
      
      // Start MCP server
      await startMCPServer(options);
    });

  // Setup cache commands and flags
  setupCacheCommands(program);
  setupCacheFlags(program);

  // Custom help text
  program.on('--help', () => {
    console.log(`
Environment Variables:
  GITHUB_PERSONAL_ACCESS_TOKEN    Alternative way to provide GitHub token
  FRAMEWORK                       Framework to use: 'react' or 'svelte' (default: react)
  LOG_LEVEL                       Log level (debug, info, warn, error) - default: info

Examples:
  npx shadcn-ui-mcp-server
  npx shadcn-ui-mcp-server --github-api-key ghp_your_token_here
  npx shadcn-ui-mcp-server --framework svelte
  npx shadcn-ui-mcp-server cache stats
  npx shadcn-ui-mcp-server --cache-stats --format json

For more information:
  https://github.com/Jpisnice/shadcn-ui-mcp-server
`);
  });

  return program;
}

/**
 * Start the MCP server
 */
async function startMCPServer(options: any) {
  logInfo('Starting Shadcn UI v4 MCP Server...');

  // Extract GitHub API key
  const githubApiKey = options.githubApiKey || process.env.GITHUB_PERSONAL_ACCESS_TOKEN;

  // Set framework from options
  if (options.framework) {
    process.env.FRAMEWORK = options.framework;
  }

  // Validate and log framework selection
  validateFrameworkSelection();

  // Get the appropriate axios implementation based on framework
  const axios = await getAxiosImplementation();

  // Configure GitHub API key if provided
  if (githubApiKey) {
    axios.setGitHubApiKey(githubApiKey);
    logInfo('GitHub API configured with token');
  } else {
    logWarning('No GitHub API key provided. Rate limited to 60 requests/hour.');
  }

  // Initialize hybrid storage system
  try {
    await initializeStorage();
    logInfo('Hybrid storage system initialized');
  } catch (error) {
    logError('Failed to initialize storage system, continuing without caching', error);
  }

  // Initialize the MCP server with metadata and capabilities
  // Following MCP SDK 1.16.0 best practices
  const server = new Server(
      {
        name: "shadcn-ui-mcp-server",
        version: "1.0.2",
      },
      {
        capabilities: {
          resources: {
            "get_components": {
              description: "List of available shadcn/ui components that can be used in the project",
              uri: "resource:get_components",
              contentType: "text/plain"
            },
            "get_install_script_for_component": {
              description: "Generate installation script for a specific shadcn/ui component based on package manager",
              uriTemplate: "resource-template:get_install_script_for_component?packageManager={packageManager}&component={component}",
              contentType: "text/plain"
            },
            "get_installation_guide": {
              description: "Get the installation guide for shadcn/ui based on build tool and package manager",
              uriTemplate: "resource-template:get_installation_guide?buildTool={buildTool}&packageManager={packageManager}",
              contentType: "text/plain"
            }
          },
          prompts: {
            "component_usage": {
              description: "Get usage examples for a specific component",
              arguments: {
                componentName: {
                  type: "string",
                  description: "Name of the component to get usage for"
                }
              }
            },
            "component_search": {
              description: "Search for components by name or description",
              arguments: {
                query: {
                  type: "string",
                  description: "Search query"
                }
              }
            },
            "component_comparison": {
              description: "Compare two components side by side",
              arguments: {
                component1: {
                  type: "string",
                  description: "First component name"
                },
                component2: {
                  type: "string",
                  description: "Second component name"
                }
              }
            },
            "component_recommendation": {
              description: "Get component recommendations based on use case",
              arguments: {
                useCase: {
                  type: "string",
                  description: "Use case description"
                }
              }
            },
            "component_tutorial": {
              description: "Get a step-by-step tutorial for using a component",
              arguments: {
                componentName: {
                  type: "string",
                  description: "Name of the component for tutorial"
                }
              }
            }
          },
          tools: {
            "get_component": {
              description: "Get the source code for a specific shadcn/ui v4 component",
              inputSchema: {
                type: "object",
                properties: {
                  componentName: {
                    type: "string",
                    description: "Name of the shadcn/ui component (e.g., \"accordion\", \"button\")"
                  }
                },
                required: ["componentName"]
              }
            },
            "get_component_demo": {
              description: "Get demo code illustrating how a shadcn/ui v4 component should be used",
              inputSchema: {
                type: "object",
                properties: {
                  componentName: {
                    type: "string",
                    description: "Name of the shadcn/ui component (e.g., \"accordion\", \"button\")"
                  }
                },
                required: ["componentName"]
              }
            },
            "list_components": {
              description: "Get all available shadcn/ui v4 components",
              inputSchema: {
                type: "object",
                properties: {}
              }
            },
            "get_component_metadata": {
              description: "Get metadata for a specific shadcn/ui v4 component",
              inputSchema: {
                type: "object",
                properties: {
                  componentName: {
                    type: "string",
                    description: "Name of the shadcn/ui component (e.g., \"accordion\", \"button\")"
                  }
                },
                required: ["componentName"]
              }
            },
            "get_directory_structure": {
              description: "Get the directory structure of the shadcn-ui v4 repository",
              inputSchema: {
                type: "object",
                properties: {
                  path: {
                    type: "string",
                    description: "Path within the repository (default: v4 registry)"
                  },
                  owner: {
                    type: "string",
                    description: "Repository owner (default: \"shadcn-ui\")"
                  },
                  repo: {
                    type: "string",
                    description: "Repository name (default: \"ui\")"
                  },
                  branch: {
                    type: "string",
                    description: "Branch name (default: \"main\")"
                  }
                }
              }
            },
            "get_block": {
              description: "Get source code for a specific shadcn/ui v4 block (e.g., calendar-01, dashboard-01)",
              inputSchema: {
                type: "object",
                properties: {
                  blockName: {
                    type: "string",
                    description: "Name of the block (e.g., \"calendar-01\", \"dashboard-01\", \"login-02\")"
                  },
                  includeComponents: {
                    type: "boolean",
                    description: "Whether to include component files for complex blocks (default: true)"
                  }
                },
                required: ["blockName"]
              }
            },
            "list_blocks": {
              description: "Get all available shadcn/ui v4 blocks with categorization",
              inputSchema: {
                type: "object",
                properties: {
                  category: {
                    type: "string",
                    description: "Filter by category (calendar, dashboard, login, sidebar, products)"
                  }
                }
              }
            },
            "get_storage_stats": {
              description: "Get hybrid storage statistics and performance metrics",
              inputSchema: {
                type: "object",
                properties: {}
              }
            }
          }
        }
      }
    );

    // Set up request handlers and register components (tools, resources, etc.)
    setupHandlers(server);

    // Start server using stdio transport
    const transport = new StdioServerTransport();
    
    logInfo('Transport initialized: stdio');

    await server.connect(transport);
    
    logInfo('Server started successfully');

    // Handle graceful shutdown
    const cleanup = async () => {
      logInfo('Shutting down server...');
      try {
        await disposeStorage();
        logInfo('Storage disposed successfully');
      } catch (error) {
        logError('Error disposing storage', error);
      }
      process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
}

/**
 * Main function to start the MCP server or handle cache commands
 */
async function main() {
  try {
    // Setup command line interface
    const program = await setupCommandLine();
    
    // Check if this is a cache command before parsing
    const args = process.argv.slice(2);
    
    if (isCacheCommand(args)) {
      // Initialize storage for cache commands
      try {
        await initializeStorage();
      } catch (error) {
        logError('Failed to initialize storage for cache command', error);
      }
      
      // Parse and execute cache command
      await program.parseAsync();
      return;
    }

    // Parse arguments for MCP server mode
    await program.parseAsync();

  } catch (error) {
    logError('Failed to start server', error);
    await disposeStorage().catch(() => {}); // Best effort cleanup
    process.exit(1);
  }
}

// Start the server
main().catch((error) => {
  logError('Unhandled startup error', error);
  process.exit(1);
});