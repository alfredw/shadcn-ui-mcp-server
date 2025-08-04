/**
 * Table formatting utilities for CLI output
 */

import Table from 'cli-table3';
import chalk from 'chalk';

/**
 * Format bytes to human readable format
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Format date to human readable format
 */
export function formatDate(date: Date | string | null): string {
  if (!date) return 'Never';
  
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString();
}

/**
 * Format duration in milliseconds to human readable format
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
}

/**
 * Format percentage with color coding
 */
export function formatPercentage(value: number, precision = 1): string {
  const percentage = value.toFixed(precision) + '%';
  
  if (value >= 80) return chalk.green(percentage);
  if (value >= 60) return chalk.yellow(percentage);
  return chalk.red(percentage);
}

/**
 * Create a table for cache statistics
 */
export function createStatsTable(stats: any): string {
  const table = new Table({
    head: [chalk.cyan('Category'), chalk.cyan('Metric'), chalk.cyan('Value')],
    style: { 
      head: [], 
      border: ['grey'] 
    }
  });

  // Calculate derived metrics
  const totalHits = (stats.hits?.memory || 0) + (stats.hits?.pglite || 0) + (stats.hits?.github || 0);
  const totalOps = totalHits + (stats.misses || 0);
  const hitRate = totalOps > 0 ? (totalHits / totalOps) * 100 : 0;
  
  // Calculate average response times
  const avgMemoryTime = stats.responseTimes?.memory?.length ? 
    stats.responseTimes.memory.reduce((a: number, b: number) => a + b, 0) / stats.responseTimes.memory.length : 0;
  const avgPgliteTime = stats.responseTimes?.pglite?.length ? 
    stats.responseTimes.pglite.reduce((a: number, b: number) => a + b, 0) / stats.responseTimes.pglite.length : 0;
  const avgGithubTime = stats.responseTimes?.github?.length ? 
    stats.responseTimes.github.reduce((a: number, b: number) => a + b, 0) / stats.responseTimes.github.length : 0;

  // Overview section
  table.push(
    [chalk.bold('Overview'), 'Total Operations', totalOps.toString()],
    ['', 'Hit Rate', formatPercentage(hitRate)],
    ['', 'Total Misses', (stats.misses || 0).toString()]
  );

  // Performance section
  if (stats.hits) {
    table.push(
      [chalk.bold('Performance'), 'Memory Hits', (stats.hits.memory || 0).toString()],
      ['', 'PGLite Hits', (stats.hits.pglite || 0).toString()],
      ['', 'GitHub Hits', (stats.hits.github || 0).toString()],
      ['', 'Total Misses', (stats.misses || 0).toString()]
    );
  }

  // Response times section
  table.push(
    [chalk.bold('Response Times'), 'Memory (L1)', formatDuration(avgMemoryTime)],
    ['', 'PGLite (L2)', formatDuration(avgPgliteTime)],
    ['', 'GitHub (L3)', formatDuration(avgGithubTime)]
  );

  // Circuit breaker section
  if (stats.circuitBreaker) {
    table.push(
      [chalk.bold('Circuit Breaker'), 'State', stats.circuitBreaker.state || 'Unknown'],
      ['', 'Failure Count', (stats.circuitBreaker.failureCount || 0).toString()],
      ['', 'Is Open', stats.circuitBreaker.isOpen ? 'Yes' : 'No']
    );
  }

  // Tier availability section
  if (stats.tierAvailability) {
    table.push(
      [chalk.bold('Tier Status'), 'Memory', stats.tierAvailability.memory ? 'Available' : 'Unavailable'],
      ['', 'PGLite', stats.tierAvailability.pglite ? 'Available' : 'Unavailable'],
      ['', 'GitHub', stats.tierAvailability.github ? 'Available' : 'Unavailable']
    );
  }

  // Deduplication section
  if (stats.deduplication) {
    table.push(
      [chalk.bold('Deduplication'), 'Total Requests', stats.deduplication.totalRequests.toString()],
      ['', 'Deduplicated', stats.deduplication.deduplicatedRequests.toString()],
      ['', 'Deduplication Rate', formatPercentage(stats.deduplication.deduplicationRate)],
      ['', 'Currently In-Flight', stats.deduplication.currentInFlight.toString()]
    );
  }

  return table.toString();
}

/**
 * Create a table for component/block listings
 */
export function createListTable(items: any[], type: 'components' | 'blocks'): string {
  if (items.length === 0) {
    return chalk.yellow(`No ${type} found.`);
  }

  const table = new Table({
    head: type === 'components' 
      ? [chalk.cyan('Name'), chalk.cyan('Framework'), chalk.cyan('Size'), chalk.cyan('Last Accessed')]
      : [chalk.cyan('Name'), chalk.cyan('Category'), chalk.cyan('Framework'), chalk.cyan('Size'), chalk.cyan('Last Accessed')],
    style: { 
      head: [], 
      border: ['grey'] 
    }
  });

  items.forEach(item => {
    if (type === 'components') {
      table.push([
        item.name || 'Unknown',
        item.framework || 'Unknown',
        formatBytes(item.size || 0),
        formatDate(item.lastAccessed)
      ]);
    } else {
      table.push([
        item.name || 'Unknown',
        item.category || 'Unknown',
        item.framework || 'Unknown',
        formatBytes(item.size || 0),
        formatDate(item.lastAccessed)
      ]);
    }
  });

  return table.toString();
}

/**
 * Create a simple key-value table
 */
export function createKeyValueTable(data: Record<string, any>): string {
  const table = new Table({
    head: [chalk.cyan('Property'), chalk.cyan('Value')],
    style: { 
      head: [], 
      border: ['grey'] 
    }
  });

  Object.entries(data).forEach(([key, value]) => {
    let formattedValue = value;
    
    // Format special values
    if (typeof value === 'number' && key.toLowerCase().includes('size')) {
      formattedValue = formatBytes(value);
    } else if (typeof value === 'number' && key.toLowerCase().includes('time')) {
      formattedValue = formatDuration(value);
    } else if (typeof value === 'number' && key.toLowerCase().includes('rate')) {
      formattedValue = formatPercentage(value);
    } else if (value instanceof Date || (typeof value === 'string' && !isNaN(Date.parse(value)))) {
      formattedValue = formatDate(value);
    } else if (typeof value === 'object') {
      formattedValue = JSON.stringify(value, null, 2);
    }

    table.push([key, formattedValue]);
  });

  return table.toString();
}

/**
 * Create a simple status indicator
 */
export function createStatusIndicator(status: 'success' | 'warning' | 'error' | 'info', message: string): string {
  const icons = {
    success: chalk.green('✅'),
    warning: chalk.yellow('⚠️'),
    error: chalk.red('❌'),
    info: chalk.blue('ℹ️')
  };

  return `${icons[status]} ${message}`;
}

/**
 * Create a progress bar representation
 */
export function createProgressBar(current: number, total: number, width = 20): string {
  const percentage = Math.min(100, (current / total) * 100);
  const filled = Math.floor((percentage / 100) * width);
  const empty = width - filled;
  
  const bar = chalk.green('█'.repeat(filled)) + chalk.grey('░'.repeat(empty));
  return `${bar} ${percentage.toFixed(1)}% (${current}/${total})`;
}

/**
 * Percentile statistics interface
 */
export interface PercentileStats {
  p50: number;
  p95: number;
  p99: number;
}

/**
 * Calculate percentiles from response time arrays
 */
export function calculatePercentiles(times: number[]): PercentileStats {
  if (times.length === 0) {
    return { p50: 0, p95: 0, p99: 0 };
  }
  
  const sorted = [...times].sort((a, b) => a - b);
  const len = sorted.length;
  
  return {
    p50: sorted[Math.floor(len * 0.5)] || 0,
    p95: sorted[Math.floor(len * 0.95)] || 0,
    p99: sorted[Math.floor(len * 0.99)] || 0
  };
}

/**
 * Format latency value with color coding
 */
export function formatLatency(ms: number): string {
  const duration = formatDuration(ms);
  
  if (ms < 100) return chalk.green(duration);
  if (ms < 500) return chalk.yellow(duration);
  return chalk.red(duration);
}

/**
 * Create latency percentiles table section
 */
export function createLatencyTable(stats: any): string {
  if (!stats.responseTimes) {
    return chalk.yellow('No latency data available');
  }
  
  const table = new Table({
    head: [chalk.cyan('Tier'), chalk.cyan('p50'), chalk.cyan('p95'), chalk.cyan('p99'), chalk.cyan('Samples')],
    style: { 
      head: [], 
      border: ['grey'] 
    }
  });

  // Calculate percentiles for each tier
  const memoryPercentiles = calculatePercentiles(stats.responseTimes.memory || []);
  const pglitePercentiles = calculatePercentiles(stats.responseTimes.pglite || []);
  const githubPercentiles = calculatePercentiles(stats.responseTimes.github || []);

  table.push(
    [
      'Memory (L1)',
      formatLatency(memoryPercentiles.p50),
      formatLatency(memoryPercentiles.p95),
      formatLatency(memoryPercentiles.p99),
      (stats.responseTimes.memory?.length || 0).toString()
    ],
    [
      'PGLite (L2)',
      formatLatency(pglitePercentiles.p50),
      formatLatency(pglitePercentiles.p95),
      formatLatency(pglitePercentiles.p99),
      (stats.responseTimes.pglite?.length || 0).toString()
    ],
    [
      'GitHub (L3)',
      formatLatency(githubPercentiles.p50),
      formatLatency(githubPercentiles.p95),
      formatLatency(githubPercentiles.p99),
      (stats.responseTimes.github?.length || 0).toString()
    ]
  );

  return table.toString();
}

/**
 * Create recent operations history table
 */
export function createHistoryTable(stats: any, limit: number = 10): string {
  // For now, we'll simulate recent operations since the current stats don't track individual operations
  // In a future enhancement, we could add operation tracking to the storage layer
  
  if (!stats.responseTimes || Object.values(stats.responseTimes).every((arr: any) => !arr?.length)) {
    return chalk.yellow('No operation history available');
  }
  
  const table = new Table({
    head: [chalk.cyan('Tier'), chalk.cyan('Response Time'), chalk.cyan('Status')],
    style: { 
      head: [], 
      border: ['grey'] 
    }
  });

  // Show recent response times from each tier (most recent first)
  const recentOperations: Array<{tier: string, time: number}> = [];
  
  // Get last few operations from each tier
  const memoryTimes = (stats.responseTimes.memory || []).slice(-3);
  const pgliteTimes = (stats.responseTimes.pglite || []).slice(-3);
  const githubTimes = (stats.responseTimes.github || []).slice(-3);
  
  memoryTimes.forEach((time: number) => recentOperations.push({ tier: 'Memory (L1)', time }));
  pgliteTimes.forEach((time: number) => recentOperations.push({ tier: 'PGLite (L2)', time }));
  githubTimes.forEach((time: number) => recentOperations.push({ tier: 'GitHub (L3)', time }));
  
  // Sort by response time (most recent activity typically has different patterns)
  recentOperations.sort((a, b) => b.time - a.time);
  
  // Take the requested limit
  const limitedOps = recentOperations.slice(0, limit);
  
  if (limitedOps.length === 0) {
    return chalk.yellow('No recent operations found');
  }
  
  limitedOps.forEach(op => {
    const status = op.time < 100 ? chalk.green('Fast') : 
                   op.time < 500 ? chalk.yellow('Normal') : 
                   chalk.red('Slow');
    
    table.push([
      op.tier,
      formatLatency(op.time),
      status
    ]);
  });

  return table.toString();
}

/**
 * Generic function to format array of objects as table
 */
export function formatAsTable(data: Record<string, any>[]): string {
  if (!data || data.length === 0) {
    return chalk.yellow('No data to display');
  }
  
  // Get all unique keys from the data
  const keys = [...new Set(data.flatMap(Object.keys))];
  
  const table = new Table({
    head: keys.map(key => chalk.cyan(key)),
    style: { 
      head: [], 
      border: ['grey'] 
    }
  });
  
  data.forEach(row => {
    const values = keys.map(key => {
      const value = row[key];
      if (value === null || value === undefined) {
        return chalk.gray('--');
      }
      if (typeof value === 'boolean') {
        return value ? chalk.green('✓') : chalk.red('✗');
      }
      if (typeof value === 'object') {
        return chalk.gray('[object]');
      }
      return String(value);
    });
    table.push(values);
  });
  
  return table.toString();
}