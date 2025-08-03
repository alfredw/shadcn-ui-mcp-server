/**
 * Progress indicator utilities for CLI commands
 */

import ora, { Ora } from 'ora';
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
 * Mock spinner for test environments that doesn't create timers
 */
class MockSpinner {
  text: string;
  isSpinning: boolean = false;

  constructor(text: string) {
    this.text = text;
  }

  start(): this {
    this.isSpinning = true;
    return this;
  }

  stop(): this {
    this.isSpinning = false;
    return this;
  }

  succeed(text?: string): this {
    this.isSpinning = false;
    // In test mode, just log the success without emoji to avoid encoding issues
    if (process.env.NODE_ENV !== 'test') {
      console.log(`✓ ${text || this.text}`);
    }
    return this;
  }

  fail(text?: string): this {
    this.isSpinning = false;
    if (process.env.NODE_ENV !== 'test') {
      console.log(`✗ ${text || this.text}`);
    }
    return this;
  }

  warn(text?: string): this {
    this.isSpinning = false;
    if (process.env.NODE_ENV !== 'test') {
      console.log(`⚠ ${text || this.text}`);
    }
    return this;
  }

  info(text?: string): this {
    this.isSpinning = false;
    if (process.env.NODE_ENV !== 'test') {
      console.log(`ℹ ${text || this.text}`);
    }
    return this;
  }
}

/**
 * Create and manage a progress spinner
 */
export class ProgressSpinner {
  private spinner: Ora | MockSpinner;
  private startTime: number;
  private isTestMode: boolean;

  constructor(text: string, spinnerType?: string) {
    this.startTime = Date.now();
    this.isTestMode = isTestEnvironment();
    
    if (this.isTestMode) {
      this.spinner = new MockSpinner(text);
    } else {
      this.spinner = ora({
        text,
        spinner: (spinnerType as any) || 'dots'
      });
    }
  }

  /**
   * Start the spinner
   */
  start(): this {
    this.spinner.start();
    return this;
  }

  /**
   * Update spinner text
   */
  updateText(text: string): this {
    this.spinner.text = text;
    return this;
  }

  /**
   * Mark as success and stop
   */
  succeed(text?: string): this {
    const duration = Date.now() - this.startTime;
    const finalText = text || this.spinner.text;
    
    if (this.isTestMode) {
      this.spinner.succeed(finalText);
    } else {
      (this.spinner as Ora).succeed(`${finalText} ${chalk.grey(`(${duration}ms)`)}`);
    }
    return this;
  }

  /**
   * Mark as failed and stop
   */
  fail(text?: string): this {
    const duration = Date.now() - this.startTime;
    const finalText = text || this.spinner.text;
    
    if (this.isTestMode) {
      this.spinner.fail(finalText);
    } else {
      (this.spinner as Ora).fail(`${finalText} ${chalk.grey(`(${duration}ms)`)}`);
    }
    return this;
  }

  /**
   * Mark as warning and stop
   */
  warn(text?: string): this {
    const duration = Date.now() - this.startTime;
    const finalText = text || this.spinner.text;
    
    if (this.isTestMode) {
      this.spinner.warn(finalText);
    } else {
      (this.spinner as Ora).warn(`${finalText} ${chalk.grey(`(${duration}ms)`)}`);
    }
    return this;
  }

  /**
   * Mark as info and stop
   */
  info(text?: string): this {
    const duration = Date.now() - this.startTime;
    const finalText = text || this.spinner.text;
    
    if (this.isTestMode) {
      this.spinner.info(finalText);
    } else {
      (this.spinner as Ora).info(`${finalText} ${chalk.grey(`(${duration}ms)`)}`);
    }
    return this;
  }

  /**
   * Stop spinner without status
   */
  stop(): this {
    this.spinner.stop();
    return this;
  }

  /**
   * Check if spinner is currently spinning
   */
  isSpinning(): boolean {
    return this.spinner.isSpinning;
  }
}

/**
 * Progress tracker for batch operations
 */
export class BatchProgress {
  private total: number;
  private current: number = 0;
  private succeeded: number = 0;
  private failed: number = 0;
  private spinner: ProgressSpinner;
  private startTime: number;

  constructor(total: number, initialText: string) {
    this.total = total;
    this.spinner = new ProgressSpinner(this.getProgressText(initialText));
    this.startTime = Date.now();
  }

  /**
   * Start the progress tracker
   */
  start(): this {
    this.spinner.start();
    return this;
  }

  /**
   * Update progress for successful operation
   */
  success(itemName?: string): this {
    this.current++;
    this.succeeded++;
    
    const text = itemName 
      ? `Processing... ${itemName} ✓`
      : 'Processing...';
      
    this.spinner.updateText(this.getProgressText(text));
    return this;
  }

  /**
   * Update progress for failed operation
   */
  failure(itemName?: string, error?: string): this {
    this.current++;
    this.failed++;
    
    const text = itemName 
      ? `Processing... ${itemName} ✗`
      : 'Processing...';
      
    this.spinner.updateText(this.getProgressText(text));
    
    if (error) {
      console.log(chalk.red(`  Error: ${error}`));
    }
    
    return this;
  }

  /**
   * Complete the progress tracker
   */
  complete(successText?: string): this {
    const duration = Date.now() - this.startTime;
    const summary = `${this.succeeded} succeeded, ${this.failed} failed`;
    const finalText = successText 
      ? `${successText} - ${summary}`
      : `Completed - ${summary}`;

    if (this.failed === 0) {
      this.spinner.succeed(`${finalText} ${chalk.grey(`(${duration}ms)`)}`);
    } else if (this.succeeded === 0) {
      this.spinner.fail(`${finalText} ${chalk.grey(`(${duration}ms)`)}`);
    } else {
      this.spinner.warn(`${finalText} ${chalk.grey(`(${duration}ms)`)}`);
    }

    return this;
  }

  /**
   * Get current progress statistics
   */
  getStats() {
    return {
      total: this.total,
      current: this.current,
      succeeded: this.succeeded,
      failed: this.failed,
      remaining: this.total - this.current,
      percentage: (this.current / this.total) * 100
    };
  }

  /**
   * Generate progress text with percentage
   */
  private getProgressText(baseText: string): string {
    const percentage = ((this.current / this.total) * 100).toFixed(1);
    const progress = `(${this.current}/${this.total}, ${percentage}%)`;
    return `${baseText} ${chalk.grey(progress)}`;
  }
}

/**
 * Simple progress bar for determinate operations
 */
export function createProgressBar(current: number, total: number, width = 20): string {
  const percentage = Math.min(100, (current / total) * 100);
  const filled = Math.floor((percentage / 100) * width);
  const empty = width - filled;
  
  const bar = chalk.green('█'.repeat(filled)) + chalk.grey('░'.repeat(empty));
  return `${bar} ${percentage.toFixed(1)}% (${current}/${total})`;
}

/**
 * Create a simple spinner for quick operations
 */
export function createSpinner(text: string): ProgressSpinner {
  return new ProgressSpinner(text);
}

/**
 * Create a batch progress tracker
 */
export function createBatchProgress(total: number, text: string): BatchProgress {
  return new BatchProgress(total, text);
}

/**
 * Utility to measure operation time
 */
export function measureTime<T>(operation: () => Promise<T>): Promise<{ result: T; duration: number }> {
  const start = Date.now();
  return operation().then(result => ({
    result,
    duration: Date.now() - start
  }));
}

/**
 * Show operation summary with timing
 */
export function showOperationSummary(
  operation: string,
  stats: {
    succeeded: number;
    failed: number;
    duration: number;
  }
): void {
  const { succeeded, failed, duration } = stats;
  const total = succeeded + failed;
  
  console.log();
  console.log(chalk.cyan.bold(`📊 ${operation} Summary`));
  console.log(chalk.grey('─'.repeat(40)));
  console.log(`${chalk.green('✓')} Succeeded: ${succeeded}`);
  console.log(`${chalk.red('✗')} Failed: ${failed}`);
  console.log(`${chalk.blue('⏱')} Duration: ${duration}ms`);
  
  if (total > 0) {
    const successRate = ((succeeded / total) * 100).toFixed(1);
    console.log(`${chalk.yellow('📈')} Success Rate: ${successRate}%`);
  }
  
  console.log();
}