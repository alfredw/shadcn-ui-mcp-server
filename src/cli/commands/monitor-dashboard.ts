/**
 * Monitoring dashboard command implementation
 */

import chalk from 'chalk';
import Table from 'cli-table3';
import { writeFile } from 'fs/promises';
import { SimpleMetricsCollector } from '../../monitoring/simple-metrics-collector.js';
import { SimpleAlertManager } from '../../monitoring/simple-alert-manager.js';
import { isStorageInitialized, getConfigurationManager } from '../../utils/storage-integration.js';
import { createSpinner } from '../utils/progress.js';

export interface MonitoringOptions {
  watch?: boolean;
  interval?: number;
  export?: 'json' | 'csv';
  filename?: string;
}

let globalMetricsCollector: SimpleMetricsCollector | null = null;
let globalAlertManager: SimpleAlertManager | null = null;

/**
 * Initialize monitoring components
 */
function initializeMonitoring(): { collector: SimpleMetricsCollector; alertManager: SimpleAlertManager } {
  if (!globalMetricsCollector || !globalAlertManager) {
    const config = getConfigurationManager();
    globalMetricsCollector = new SimpleMetricsCollector();
    globalAlertManager = new SimpleAlertManager(config);
  }
  
  return {
    collector: globalMetricsCollector,
    alertManager: globalAlertManager
  };
}

/**
 * Show monitoring dashboard
 */
export async function handleMonitoringDashboard(options: MonitoringOptions = {}): Promise<void> {
  const { watch = false, interval = 5, export: exportFormat, filename } = options;
  
  // Check if storage is initialized
  if (!isStorageInitialized()) {
    console.log(chalk.yellow('⚠️  Storage not initialized'));
    console.log(chalk.grey('Run the server first to initialize the storage system.'));
    return;
  }
  
  const { collector, alertManager } = initializeMonitoring();
  
  if (exportFormat) {
    await handleMetricsExport(collector, exportFormat, filename);
    return;
  }
  
  const displayDashboard = async () => {
    // Wait a moment for initial metrics collection
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.clear();
    
    const metrics = collector.getCurrentMetrics();
    if (!metrics) {
      console.log(chalk.yellow('📊 No metrics available yet...'));
      console.log(chalk.grey('Collecting initial metrics, please wait...'));
      return;
    }
    
    // Header
    console.log(chalk.bold.blue('🎯 Performance Monitoring Dashboard'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log(chalk.gray(`Last updated: ${new Date(metrics.timestamp).toLocaleString()}`));
    
    // Cache Performance
    console.log(chalk.bold('\n📊 Cache Performance'));
    const cacheTable = new Table({
      head: ['Metric', 'Value'],
      style: { head: ['cyan'] }
    });
    
    const hitRateColor = metrics.cacheMetrics.hitRate >= 70 ? 'green' : 
                        metrics.cacheMetrics.hitRate >= 50 ? 'yellow' : 'red';
    
    cacheTable.push(
      ['Hit Rate', chalk[hitRateColor](`${metrics.cacheMetrics.hitRate.toFixed(1)}%`)],
      ['Total Requests', metrics.cacheMetrics.totalRequests.toLocaleString()],
      ['Hits / Misses', `${chalk.green(metrics.cacheMetrics.hits)} / ${chalk.red(metrics.cacheMetrics.misses)}`],
      ['Avg Response Time', `${metrics.cacheMetrics.avgResponseTime.toFixed(0)}ms`]
    );
    
    console.log(cacheTable.toString());
    
    // Storage Health
    console.log(chalk.bold('\n💾 Storage Health'));
    const storageTable = new Table({
      head: ['Tier', 'Status', 'Response Time', 'Usage'],
      style: { head: ['cyan'] }
    });
    
    for (const [tier, tierMetrics] of Object.entries(metrics.storageMetrics)) {
      const status = tierMetrics.available 
        ? chalk.green('✓ Online') 
        : chalk.red('✗ Offline');
      
      const responseTimeColor = tierMetrics.responseTime < 100 ? 'green' :
                               tierMetrics.responseTime < 1000 ? 'yellow' : 'red';
      
      const usageColor = tierMetrics.usage < 70 ? 'green' :
                        tierMetrics.usage < 90 ? 'yellow' : 'red';
      
      storageTable.push([
        tier.charAt(0).toUpperCase() + tier.slice(1),
        status,
        chalk[responseTimeColor](`${tierMetrics.responseTime.toFixed(0)}ms`),
        chalk[usageColor](`${tierMetrics.usage.toFixed(0)}%`)
      ]);
    }
    
    console.log(storageTable.toString());
    
    // GitHub API Status
    console.log(chalk.bold('\n🌐 GitHub API Status'));
    const apiTable = new Table({
      head: ['Metric', 'Value'],
      style: { head: ['cyan'] }
    });
    
    const rateLimitColor = metrics.apiMetrics.rateLimitRemaining >= 1000 ? 'green' :
                          metrics.apiMetrics.rateLimitRemaining >= 100 ? 'yellow' : 'red';
    
    apiTable.push(
      ['Total Requests', metrics.apiMetrics.githubRequests.toLocaleString()],
      ['Rate Limit Remaining', chalk[rateLimitColor](`${metrics.apiMetrics.rateLimitRemaining}/5000`)],
      ['Avg Response Time', `${metrics.apiMetrics.avgResponseTime.toFixed(0)}ms`],
      ['Errors', metrics.apiMetrics.errors > 0 ? chalk.red(metrics.apiMetrics.errors) : chalk.green('0')]
    );
    
    console.log(apiTable.toString());
    
    // System Info
    console.log(chalk.bold('\n💻 System Info'));
    const systemTable = new Table({
      head: ['Metric', 'Value'],
      style: { head: ['cyan'] }
    });
    
    systemTable.push(
      ['Uptime', formatDuration(metrics.systemMetrics.uptime)],
      ['Memory Usage', `${(metrics.systemMetrics.memoryUsage / 1024 / 1024).toFixed(1)} MB`],
      ['Memory Storage', formatStorageSize(metrics.systemMetrics.storageSize.memory)],
      ['PGLite Storage', formatStorageSize(metrics.systemMetrics.storageSize.pglite)]
    );
    
    console.log(systemTable.toString());
    
    // Active Alerts
    const alerts = alertManager.checkMetrics(metrics);
    if (alerts.length > 0) {
      console.log(chalk.bold.red('\n⚠️  Active Alerts'));
      
      const alertTable = new Table({
        head: ['Severity', 'Type', 'Message'],
        style: { head: ['cyan'] }
      });
      
      alerts.forEach(alert => {
        const severityColor = alert.severity === 'critical' ? 'red' : 
                             alert.severity === 'warning' ? 'yellow' : 'blue';
        const severityIcon = alert.severity === 'critical' ? '🚨' : 
                            alert.severity === 'warning' ? '⚠️' : 'ℹ️';
        
        alertTable.push([
          chalk[severityColor](`${severityIcon} ${alert.severity.toUpperCase()}`),
          alert.type,
          alert.message
        ]);
      });
      
      console.log(alertTable.toString());
    } else {
      console.log(chalk.bold.green('\n✅ No Active Alerts'));
      console.log(chalk.green('All systems operating normally'));
    }
    
    if (watch) {
      console.log(chalk.gray(`\nRefreshing every ${interval} seconds... (Ctrl+C to exit)`));
    }
  };
  
  await displayDashboard();
  
  if (watch) {
    const intervalId = setInterval(displayDashboard, interval * 1000);
    
    // Handle graceful shutdown
    const cleanup = () => {
      clearInterval(intervalId);
      if (globalMetricsCollector) {
        globalMetricsCollector.dispose();
        globalMetricsCollector = null;
      }
      globalAlertManager = null;
      console.log(chalk.yellow('\n\nMonitoring stopped.'));
      process.exit(0);
    };
    
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
  }
}

/**
 * Handle metrics export
 */
async function handleMetricsExport(
  collector: SimpleMetricsCollector, 
  format: 'json' | 'csv', 
  filename?: string
): Promise<void> {
  const spinner = createSpinner('Exporting metrics...').start();
  
  try {
    const data = collector.exportMetrics(format);
    const defaultFilename = `metrics-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.${format}`;
    const exportFilename = filename || defaultFilename;
    
    await writeFile(exportFilename, data);
    spinner.succeed(`Metrics exported to ${exportFilename}`);
    
    console.log(chalk.green(`✅ Successfully exported metrics to ${chalk.bold(exportFilename)}`));
    
    if (format === 'json') {
      const metricsCount = JSON.parse(data).length;
      console.log(chalk.gray(`📊 Exported ${metricsCount} metric snapshots`));
    } else {
      const lines = data.split('\n').length - 1; // Subtract header
      console.log(chalk.gray(`📊 Exported ${lines} metric snapshots`));
    }
  } catch (error) {
    spinner.fail('Failed to export metrics');
    console.error(chalk.red('❌ Export failed:'), error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

/**
 * Format duration in human-readable format
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

/**
 * Format storage size with usage percentage
 */
function formatStorageSize(storage: { used: number; max: number }): string {
  const usedMB = (storage.used / 1024 / 1024).toFixed(1);
  const maxMB = (storage.max / 1024 / 1024).toFixed(0);
  const percentage = storage.max > 0 ? (storage.used / storage.max * 100).toFixed(1) : '0.0';
  
  const color = parseFloat(percentage) < 70 ? 'green' :
               parseFloat(percentage) < 90 ? 'yellow' : 'red';
  
  return chalk[color](`${usedMB}/${maxMB} MB (${percentage}%)`);
}