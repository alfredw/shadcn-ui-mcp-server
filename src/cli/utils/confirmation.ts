/**
 * User confirmation utilities for CLI commands
 */

import { createInterface } from 'readline';
import chalk from 'chalk';

/**
 * Detect if we're running in a test environment
 */
function isTestEnvironment(): boolean {
  return (
    process.env.NODE_ENV === 'test' ||
    process.env.VITEST === 'true' ||
    process.env.JEST_WORKER_ID !== undefined ||
    !!(globalThis as any).__VITEST__ ||
    process.argv.includes('--test') ||
    !process.stdout.isTTY
  );
}

/**
 * Mock confirmation for test environments
 */
class MockConfirmation {
  static defaultResponses = {
    confirmation: true,
    input: 'yes',
    choice: 0
  };

  static async askConfirmation(message: string, defaultValue = false): Promise<boolean> {
    // In test mode, return the default or configured response
    return MockConfirmation.defaultResponses.confirmation ?? defaultValue;
  }

  static async askInput(message: string, validator?: (input: string) => boolean | string, defaultValue?: string): Promise<string> {
    const response = MockConfirmation.defaultResponses.input || defaultValue || '';
    
    // Apply validation if provided
    if (validator) {
      const validation = validator(response);
      if (validation !== true) {
        // In test mode, if validation fails, return the default
        return defaultValue || '';
      }
    }
    
    return response;
  }

  static async askChoice(message: string, choices: string[], defaultIndex = 0): Promise<string> {
    const index = MockConfirmation.defaultResponses.choice ?? defaultIndex;
    return choices[Math.max(0, Math.min(index, choices.length - 1))];
  }

  static async confirmDangerousAction(action: string, warnings: string[], confirmText = 'yes'): Promise<boolean> {
    return MockConfirmation.defaultResponses.confirmation ?? true;
  }

  static async confirmClearCache(options: any): Promise<boolean> {
    return MockConfirmation.defaultResponses.confirmation ?? true;
  }
}

/**
 * Prompt user for confirmation
 */
export async function askConfirmation(message: string, defaultValue = false): Promise<boolean> {
  // Use mock in test environment
  if (isTestEnvironment()) {
    return MockConfirmation.askConfirmation(message, defaultValue);
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const defaultText = defaultValue ? '[Y/n]' : '[y/N]';
  const prompt = `${chalk.yellow('?')} ${message} ${chalk.grey(defaultText)} `;

  let attempts = 0;
  const maxAttempts = 3;

  return new Promise((resolve) => {
    const askQuestion = () => {
      rl.question(prompt, (answer) => {
        const normalized = answer.toLowerCase().trim();
        
        if (normalized === '') {
          rl.close();
          resolve(defaultValue);
        } else if (normalized === 'y' || normalized === 'yes') {
          rl.close();
          resolve(true);
        } else if (normalized === 'n' || normalized === 'no') {
          rl.close();
          resolve(false);
        } else {
          attempts++;
          if (attempts >= maxAttempts) {
            console.log(chalk.red(`Too many invalid attempts. Using default: ${defaultValue}`));
            rl.close();
            resolve(defaultValue);
          } else {
            console.log(chalk.red('Please answer with y/yes or n/no'));
            askQuestion(); // Non-recursive retry
          }
        }
      });
    };

    askQuestion();
  });
}

/**
 * Get user input with optional validation
 */
export async function askInput(
  message: string, 
  validator?: (input: string) => boolean | string,
  defaultValue?: string
): Promise<string> {
  // Use mock in test environment
  if (isTestEnvironment()) {
    return MockConfirmation.askInput(message, validator, defaultValue);
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const defaultText = defaultValue ? chalk.grey(`(${defaultValue})`) : '';
  const prompt = `${chalk.yellow('?')} ${message} ${defaultText}: `;

  let attempts = 0;
  const maxAttempts = 3;

  return new Promise((resolve) => {
    const askQuestion = () => {
      rl.question(prompt, (answer) => {
        const input = answer.trim() || defaultValue || '';
        
        if (validator) {
          const validation = validator(input);
          if (validation !== true) {
            attempts++;
            if (attempts >= maxAttempts) {
              const errorMessage = typeof validation === 'string' ? validation : 'Invalid input';
              console.log(chalk.red(`${errorMessage}. Using default: ${defaultValue || 'empty'}`));
              rl.close();
              resolve(defaultValue || '');
            } else {
              const errorMessage = typeof validation === 'string' ? validation : 'Invalid input';
              console.log(chalk.red(errorMessage));
              askQuestion(); // Non-recursive retry
            }
            return;
          }
        }
        
        rl.close();
        resolve(input);
      });
    };

    askQuestion();
  });
}

/**
 * Ask user to select from multiple options
 */
export async function askChoice(
  message: string,
  choices: string[],
  defaultIndex = 0
): Promise<string> {
  // Use mock in test environment
  if (isTestEnvironment()) {
    return MockConfirmation.askChoice(message, choices, defaultIndex);
  }

  console.log(chalk.cyan(message));
  
  choices.forEach((choice, index) => {
    const prefix = index === defaultIndex ? chalk.green('❯') : ' ';
    const number = chalk.grey(`${index + 1}.`);
    console.log(`${prefix} ${number} ${choice}`);
  });

  const input = await askInput(
    'Choose an option',
    (value) => {
      const num = parseInt(value);
      if (isNaN(num) || num < 1 || num > choices.length) {
        return `Please enter a number between 1 and ${choices.length}`;
      }
      return true;
    },
    (defaultIndex + 1).toString()
  );

  return choices[parseInt(input) - 1];
}

/**
 * Display warning and ask for confirmation
 */
export async function confirmDangerousAction(
  action: string,
  warnings: string[],
  confirmText = 'yes'
): Promise<boolean> {
  // Use mock in test environment
  if (isTestEnvironment()) {
    return MockConfirmation.confirmDangerousAction(action, warnings, confirmText);
  }

  console.log(chalk.red.bold(`⚠️  WARNING: ${action}`));
  console.log();
  
  warnings.forEach(warning => {
    console.log(chalk.yellow(`  • ${warning}`));
  });
  
  console.log();
  
  const confirmation = await askInput(
    `Type "${confirmText}" to confirm this action`,
    (input) => {
      if (input !== confirmText) {
        return `You must type exactly "${confirmText}" to confirm`;
      }
      return true;
    }
  );

  return confirmation === confirmText;
}

/**
 * Show clear cache confirmation with details
 */
export async function confirmClearCache(options: {
  framework?: string;
  type?: string;
  olderThan?: number;
  estimatedCount?: number;
  estimatedSize?: number;
}): Promise<boolean> {
  // Use mock in test environment
  if (isTestEnvironment()) {
    return MockConfirmation.confirmClearCache(options);
  }

  const warnings: string[] = [];
  let action = 'Clear cache data';

  if (options.framework) {
    action += ` for ${options.framework} framework`;
  }

  if (options.type && options.type !== 'all') {
    action += ` (${options.type} only)`;
  }

  if (options.olderThan) {
    action += ` older than ${options.olderThan} days`;
    warnings.push(`Items older than ${options.olderThan} days will be permanently removed`);
  } else {
    warnings.push('ALL cache data will be permanently removed');
  }

  if (options.estimatedCount !== undefined) {
    warnings.push(`Approximately ${options.estimatedCount} items will be deleted`);
  }

  if (options.estimatedSize !== undefined) {
    const sizeText = formatBytes(options.estimatedSize);
    warnings.push(`Approximately ${sizeText} of disk space will be freed`);
  }

  warnings.push('This action cannot be undone');
  warnings.push('Cache will need to be rebuilt from GitHub API');

  return confirmDangerousAction(action, warnings);
}

/**
 * Format bytes helper (duplicate from table.ts to avoid circular import)
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}