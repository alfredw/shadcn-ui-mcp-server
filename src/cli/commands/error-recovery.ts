/**
 * Error Recovery CLI Commands
 * 
 * CLI commands for managing error recovery system including status,
 * statistics, and circuit breaker management.
 */

import chalk from 'chalk';
import Table from 'cli-table3';
import { ErrorRecoveryManager } from '../../utils/error-recovery-manager.js';
import { RecoveryMonitor } from '../../utils/recovery-monitor.js';
import { DegradedOperationNotifier } from '../../utils/degraded-operation-notifier.js';
import { FallbackChainHandler } from '../../storage/fallback-chain-handler.js';
import { PartialResponseHandler } from '../../utils/partial-response-handler.js';

/**
 * CLI options for recovery status command
 */
interface RecoveryStatusOptions {
  format?: 'table' | 'json';
  detailed?: boolean;
  minutes?: number;
}

/**
 * CLI options for recovery stats command
 */
interface RecoveryStatsOptions {
  format?: 'table' | 'json';
  tier?: string;
  minutes?: number;
  detailed?: boolean;
}

/**
 * CLI options for circuit breaker reset command
 */
interface CircuitBreakerResetOptions {
  tier?: string;
  force?: boolean;
}

// Global instances (these would be injected in real implementation)
let recoveryManager: ErrorRecoveryManager;
let recoveryMonitor: RecoveryMonitor;
let notifier: DegradedOperationNotifier;
let fallbackHandler: FallbackChainHandler;

/**
 * Initialize error recovery components
 * This would be called during application startup
 */
export function initializeErrorRecoveryComponents(): void {
  recoveryManager = new ErrorRecoveryManager();
  recoveryMonitor = new RecoveryMonitor();
  notifier = new DegradedOperationNotifier();
  fallbackHandler = new FallbackChainHandler(
    recoveryManager,
    notifier,
    new PartialResponseHandler()
  );
}

/**
 * Handle recovery status command
 */
export async function handleRecoveryStatus(options: RecoveryStatusOptions): Promise<void> {
  try {
    if (!notifier) {
      initializeErrorRecoveryComponents();
    }
    
    const minutes = options.minutes || 5;
    const activeIssues = notifier.getActiveIssues(minutes);
    const degradationSummary = notifier.getDegradationSummary(minutes);
    const circuitBreakerStatuses = recoveryManager.getAllCircuitBreakerStatuses();
    
    if (options.format === 'json') {
      const status = {
        timestamp: new Date().toISOString(),
        isDegraded: degradationSummary.isDegraded,
        summary: degradationSummary,
        activeIssues,
        circuitBreakers: circuitBreakerStatuses,
        periodMinutes: minutes
      };
      
      console.log(JSON.stringify(status, null, 2));
      return;
    }
    
    // Table format output
    console.log(chalk.bold('\n🔧 Error Recovery Status\n'));
    
    // System status header
    if (degradationSummary.isDegraded) {
      console.log(chalk.red('⚠️  System is currently degraded'));
    } else {
      console.log(chalk.green('✅ All systems operational'));
    }
    
    console.log(`📊 Status for last ${minutes} minutes\n`);
    
    // Summary table
    const summaryTable = new Table({
      head: ['Metric', 'Count'],
      style: { head: ['cyan'] }
    });
    
    summaryTable.push(
      ['Critical Issues', degradationSummary.criticalIssues],
      ['Error Issues', degradationSummary.errorIssues],
      ['Warning Issues', degradationSummary.warningIssues],
      ['Total Issues', degradationSummary.totalIssues],
      ['Affected Tiers', degradationSummary.affectedTiers.join(', ') || 'None']
    );
    
    console.log(summaryTable.toString());
    console.log();
    
    // Circuit breaker status
    if (Object.keys(circuitBreakerStatuses).length > 0) {
      console.log(chalk.bold('Circuit Breaker Status:'));
      const cbTable = new Table({
        head: ['Tier', 'State', 'Failures'],
        style: { head: ['cyan'] }
      });
      
      for (const [tier, status] of Object.entries(circuitBreakerStatuses)) {
        const stateColor = status.state === 'CLOSED' ? 'green' : 
                          status.state === 'HALF_OPEN' ? 'yellow' : 'red';
        
        cbTable.push([
          tier,
          chalk[stateColor](status.state),
          status.failures.toString()
        ]);
      }
      
      console.log(cbTable.toString());
      console.log();
    }
    
    // Active issues
    if (activeIssues.length > 0) {
      console.log(chalk.bold('Active Issues:'));
      const issuesTable = new Table({
        head: ['Type', 'Tier', 'Severity', 'Message', 'Occurrences', 'Age'],
        style: { head: ['cyan'] }
      });
      
      activeIssues.forEach(issue => {
        const age = formatDuration(Date.now() - issue.firstSeen);
        const severityColor = issue.severity === 'critical' ? 'red' :
                             issue.severity === 'error' ? 'red' :
                             issue.severity === 'warning' ? 'yellow' : 'blue';
        
        issuesTable.push([
          issue.type,
          issue.tier,
          chalk[severityColor](issue.severity),
          issue.message.substring(0, 50) + (issue.message.length > 50 ? '...' : ''),
          issue.occurrences.toString(),
          age
        ]);
      });
      
      console.log(issuesTable.toString());
    } else {
      console.log(chalk.green('No active issues detected'));
    }
    
    console.log();
    
  } catch (error) {
    console.error(chalk.red('Failed to get recovery status:'), error);
    process.exit(1);
  }
}

/**
 * Handle recovery statistics command
 */
export async function handleRecoveryStats(options: RecoveryStatsOptions): Promise<void> {
  try {
    if (!recoveryMonitor) {
      initializeErrorRecoveryComponents();
    }
    
    const minutes = options.minutes || 60;
    const recentMetrics = recoveryMonitor.getRecentMetrics(minutes);
    const overallMetrics = recoveryMonitor.getMetrics();
    const tierFailures = recoveryMonitor.getTierFailureCounts();
    
    if (options.format === 'json') {
      const stats = {
        timestamp: new Date().toISOString(),
        overall: {
          totalAttempts: overallMetrics.totalRecoveries,
          successfulRecoveries: overallMetrics.successfulRecoveries,
          failedRecoveries: overallMetrics.failedRecoveries,
          successRate: recoveryMonitor.getRecoveryRate(),
          averageRecoveryTime: overallMetrics.averageRecoveryTime
        },
        recent: {
          ...recentMetrics,
          periodMinutes: minutes
        },
        tiers: Object.fromEntries(
          Object.entries(tierFailures).map(([tier, failures]) => [
            tier,
            {
              failures,
              successRate: recoveryMonitor.getTierRecoveryRate(tier)
            }
          ])
        )
      };
      
      console.log(JSON.stringify(stats, null, 2));
      return;
    }
    
    // Table format output
    console.log(chalk.bold('\n📈 Recovery Statistics\n'));
    
    // Overall metrics
    const overallTable = new Table({
      head: ['Metric', 'Value'],
      style: { head: ['cyan'] }
    });
    
    const successRate = (recoveryMonitor.getRecoveryRate() * 100).toFixed(1);
    const successRateColor = parseFloat(successRate) >= 80 ? 'green' : 
                             parseFloat(successRate) >= 60 ? 'yellow' : 'red';
    
    overallTable.push(
      ['Total Attempts', overallMetrics.totalRecoveries.toString()],
      ['Successful Recoveries', overallMetrics.successfulRecoveries.toString()],
      ['Failed Recoveries', overallMetrics.failedRecoveries.toString()],
      ['Success Rate', chalk[successRateColor](`${successRate}%`)],
      ['Average Recovery Time', `${overallMetrics.averageRecoveryTime.toFixed(0)}ms`]
    );
    
    console.log(chalk.bold('Overall Statistics:'));
    console.log(overallTable.toString());
    console.log();
    
    // Recent metrics
    if (recentMetrics.attempts > 0) {
      console.log(chalk.bold(`Recent Activity (Last ${minutes} minutes):`));
      const recentTable = new Table({
        head: ['Metric', 'Value'],
        style: { head: ['cyan'] }
      });
      
      const recentSuccessRate = (recentMetrics.successRate * 100).toFixed(1);
      const recentRateColor = parseFloat(recentSuccessRate) >= 80 ? 'green' : 
                             parseFloat(recentSuccessRate) >= 60 ? 'yellow' : 'red';
      
      recentTable.push(
        ['Attempts', recentMetrics.attempts.toString()],
        ['Successes', recentMetrics.successes.toString()],
        ['Failures', recentMetrics.failures.toString()],
        ['Success Rate', chalk[recentRateColor](`${recentSuccessRate}%`)],
        ['Average Time', `${recentMetrics.averageTime.toFixed(0)}ms`]
      );
      
      console.log(recentTable.toString());
      console.log();
    }
    
    // Tier-specific failures
    if (Object.keys(tierFailures).length > 0) {
      console.log(chalk.bold('Tier Failure Counts:'));
      const tierTable = new Table({
        head: ['Tier', 'Failures', 'Success Rate'],
        style: { head: ['cyan'] }
      });
      
      for (const [tier, failures] of Object.entries(tierFailures)) {
        const tierRate = (recoveryMonitor.getTierRecoveryRate(tier) * 100).toFixed(1);
        const tierRateColor = parseFloat(tierRate) >= 80 ? 'green' : 
                             parseFloat(tierRate) >= 60 ? 'yellow' : 'red';
        
        tierTable.push([
          tier,
          failures.toString(),
          chalk[tierRateColor](`${tierRate}%`)
        ]);
      }
      
      console.log(tierTable.toString());
      console.log();
    }
    
    // Show slowest operations if detailed
    if (options.detailed) {
      const slowestOps = recoveryMonitor.getSlowestOperations(5);
      if (slowestOps.length > 0) {
        console.log(chalk.bold('Slowest Recent Operations:'));
        const slowTable = new Table({
          head: ['Tier', 'Key', 'Duration', 'Status', 'Age'],
          style: { head: ['cyan'] }
        });
        
        slowestOps.forEach(op => {
          const age = formatDuration(Date.now() - op.timestamp);
          const statusColor = op.success ? 'green' : 'red';
          const status = op.success ? '✓' : '✗';
          
          slowTable.push([
            op.tier,
            op.key.substring(0, 20) + (op.key.length > 20 ? '...' : ''),
            `${op.duration.toFixed(0)}ms`,
            chalk[statusColor](status),
            age
          ]);
        });
        
        console.log(slowTable.toString());
        console.log();
      }
    }
    
  } catch (error) {
    console.error(chalk.red('Failed to get recovery statistics:'), error);
    process.exit(1);
  }
}

/**
 * Handle circuit breaker reset command
 */
export async function handleCircuitBreakerReset(options: CircuitBreakerResetOptions): Promise<void> {
  try {
    if (!recoveryManager) {
      initializeErrorRecoveryComponents();
    }
    
    if (options.tier) {
      // Reset specific tier
      if (!options.force) {
        const response = await promptForConfirmation(
          `Reset circuit breaker for tier '${options.tier}'?`
        );
        if (!response) {
          console.log('Operation cancelled');
          return;
        }
      }
      
      const success = recoveryManager.resetCircuitBreaker(options.tier);
      if (success) {
        console.log(chalk.green(`✅ Circuit breaker reset successfully for tier: ${options.tier}`));
      } else {
        console.log(chalk.red(`❌ Failed to reset circuit breaker for tier: ${options.tier} (tier not found)`));
        process.exit(1);
      }
    } else {
      // Reset all circuit breakers
      if (!options.force) {
        const response = await promptForConfirmation(
          'Reset ALL circuit breakers?'
        );
        if (!response) {
          console.log('Operation cancelled');
          return;
        }
      }
      
      recoveryManager.resetAllCircuitBreakers();
      console.log(chalk.green('✅ All circuit breakers reset successfully'));
    }
    
  } catch (error) {
    console.error(chalk.red('Failed to reset circuit breaker:'), error);
    process.exit(1);
  }
}

/**
 * Handle error history clear command
 */
export async function handleClearErrorHistory(options: { tier?: string; force?: boolean }): Promise<void> {
  try {
    if (!recoveryManager) {
      initializeErrorRecoveryComponents();
    }
    
    if (options.tier) {
      // Clear specific tier
      if (!options.force) {
        const response = await promptForConfirmation(
          `Clear error history for tier '${options.tier}'?`
        );
        if (!response) {
          console.log('Operation cancelled');
          return;
        }
      }
      
      recoveryManager.clearErrorHistory(options.tier);
      console.log(chalk.green(`✅ Error history cleared for tier: ${options.tier}`));
    } else {
      // Clear all error history
      if (!options.force) {
        const response = await promptForConfirmation(
          'Clear ALL error history?'
        );
        if (!response) {
          console.log('Operation cancelled');
          return;
        }
      }
      
      recoveryManager.clearErrorHistory();
      console.log(chalk.green('✅ All error history cleared'));
    }
    
  } catch (error) {
    console.error(chalk.red('Failed to clear error history:'), error);
    process.exit(1);
  }
}

/**
 * Format duration in human-readable format
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
  return `${Math.round(ms / 3600000)}h`;
}

/**
 * Simple confirmation prompt
 * In a real implementation, this would use a proper CLI prompt library
 */
async function promptForConfirmation(message: string): Promise<boolean> {
  // For now, just assume yes in non-interactive environments
  // In a real implementation, you'd use readline or inquirer
  process.stdout.write(`${message} (y/N): `);
  
  return new Promise((resolve) => {
    process.stdin.once('data', (data) => {
      const response = data.toString().trim().toLowerCase();
      resolve(response === 'y' || response === 'yes');
    });
  });
}