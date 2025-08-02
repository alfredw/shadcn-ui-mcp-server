# Task 07: Cache Statistics and Monitoring Implementation

## Overview
Implement comprehensive statistics collection and monitoring for the cache system. This provides insights into cache performance, usage patterns, and helps optimize cache behavior. The statistics will be stored in dedicated tables and exposed through CLI and programmatic interfaces.

## Objectives
- Create statistics collection infrastructure
- Track cache hit/miss rates per tier
- Monitor response times and performance
- Implement usage analytics
- Create monitoring dashboards
- Add alerting capabilities

## Technical Requirements

### Statistics Schema
```sql
-- Cache statistics table
CREATE TABLE IF NOT EXISTS cache_stats (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  hour INTEGER NOT NULL CHECK (hour >= 0 AND hour <= 23),
  framework VARCHAR(50) NOT NULL,
  resource_type VARCHAR(20) NOT NULL,
  tier VARCHAR(20) NOT NULL, -- 'memory', 'pglite', 'github'
  hits INTEGER DEFAULT 0,
  misses INTEGER DEFAULT 0,
  errors INTEGER DEFAULT 0,
  total_response_time_ms BIGINT DEFAULT 0,
  max_response_time_ms INTEGER DEFAULT 0,
  min_response_time_ms INTEGER DEFAULT 0,
  bytes_served BIGINT DEFAULT 0,
  UNIQUE(date, hour, framework, resource_type, tier)
);

-- Real-time metrics table
CREATE TABLE IF NOT EXISTS cache_metrics (
  id SERIAL PRIMARY KEY,
  metric_name VARCHAR(100) NOT NULL,
  metric_value NUMERIC,
  labels JSONB,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- API call tracking
CREATE TABLE IF NOT EXISTS api_calls (
  id SERIAL PRIMARY KEY,
  endpoint VARCHAR(255) NOT NULL,
  method VARCHAR(50) NOT NULL,
  response_time_ms INTEGER,
  status_code INTEGER,
  error_message TEXT,
  github_rate_limit_remaining INTEGER,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX idx_cache_stats_date ON cache_stats(date DESC);
CREATE INDEX idx_cache_metrics_timestamp ON cache_metrics(timestamp DESC);
CREATE INDEX idx_api_calls_timestamp ON api_calls(timestamp DESC);
```

### Statistics Collector
```typescript
interface MetricEvent {
  type: 'hit' | 'miss' | 'error';
  tier: 'memory' | 'pglite' | 'github';
  framework: string;
  resourceType: 'component' | 'block' | 'metadata';
  responseTime: number;
  bytesServed?: number;
  error?: Error;
}

class StatisticsCollector {
  private buffer: MetricEvent[] = [];
  private flushInterval: NodeJS.Timer;
  private aggregator: MetricsAggregator;
  
  constructor(private db: PGLite, config: StatsConfig) {
    this.aggregator = new MetricsAggregator();
    this.startPeriodicFlush(config.flushIntervalMs || 5000);
  }
  
  recordEvent(event: MetricEvent): void {
    this.buffer.push({
      ...event,
      timestamp: Date.now()
    });
    
    // Flush if buffer is getting large
    if (this.buffer.length >= 1000) {
      this.flush();
    }
  }
  
  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    
    const events = [...this.buffer];
    this.buffer = [];
    
    try {
      // Aggregate events by hour
      const aggregated = this.aggregator.aggregate(events);
      
      // Bulk insert
      await this.db.query('BEGIN');
      
      for (const [key, stats] of aggregated) {
        await this.updateStats(key, stats);
      }
      
      await this.db.query('COMMIT');
      
    } catch (error) {
      this.logger.error('Failed to flush statistics:', error);
      // Re-add events to buffer for retry
      this.buffer.unshift(...events);
    }
  }
  
  private async updateStats(key: string, stats: AggregatedStats): Promise<void> {
    const [date, hour, framework, resourceType, tier] = key.split(':');
    
    await this.db.query(`
      INSERT INTO cache_stats (
        date, hour, framework, resource_type, tier,
        hits, misses, errors, total_response_time_ms,
        max_response_time_ms, min_response_time_ms, bytes_served
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (date, hour, framework, resource_type, tier)
      DO UPDATE SET
        hits = cache_stats.hits + EXCLUDED.hits,
        misses = cache_stats.misses + EXCLUDED.misses,
        errors = cache_stats.errors + EXCLUDED.errors,
        total_response_time_ms = cache_stats.total_response_time_ms + EXCLUDED.total_response_time_ms,
        max_response_time_ms = GREATEST(cache_stats.max_response_time_ms, EXCLUDED.max_response_time_ms),
        min_response_time_ms = LEAST(cache_stats.min_response_time_ms, EXCLUDED.min_response_time_ms),
        bytes_served = cache_stats.bytes_served + EXCLUDED.bytes_served
    `, [date, hour, framework, resourceType, tier, 
        stats.hits, stats.misses, stats.errors,
        stats.totalResponseTime, stats.maxResponseTime,
        stats.minResponseTime, stats.bytesServed]);
  }
}
```

### Metrics Aggregator
```typescript
class MetricsAggregator {
  aggregate(events: MetricEvent[]): Map<string, AggregatedStats> {
    const aggregated = new Map<string, AggregatedStats>();
    
    for (const event of events) {
      const date = new Date(event.timestamp);
      const key = this.buildKey(date, event);
      
      if (!aggregated.has(key)) {
        aggregated.set(key, {
          hits: 0,
          misses: 0,
          errors: 0,
          totalResponseTime: 0,
          maxResponseTime: 0,
          minResponseTime: Infinity,
          bytesServed: 0,
          count: 0
        });
      }
      
      const stats = aggregated.get(key)!;
      
      // Update counters
      if (event.type === 'hit') stats.hits++;
      else if (event.type === 'miss') stats.misses++;
      else if (event.type === 'error') stats.errors++;
      
      // Update response times
      stats.totalResponseTime += event.responseTime;
      stats.maxResponseTime = Math.max(stats.maxResponseTime, event.responseTime);
      stats.minResponseTime = Math.min(stats.minResponseTime, event.responseTime);
      stats.count++;
      
      // Update bytes
      if (event.bytesServed) {
        stats.bytesServed += event.bytesServed;
      }
    }
    
    return aggregated;
  }
  
  private buildKey(date: Date, event: MetricEvent): string {
    const dateStr = date.toISOString().split('T')[0];
    const hour = date.getHours();
    return `${dateStr}:${hour}:${event.framework}:${event.resourceType}:${event.tier}`;
  }
}
```

### Real-time Metrics
```typescript
class RealtimeMetrics {
  private gauges: Map<string, number> = new Map();
  private counters: Map<string, number> = new Map();
  
  // Prometheus-style metrics
  setGauge(name: string, value: number, labels?: Record<string, string>): void {
    const key = this.buildMetricKey(name, labels);
    this.gauges.set(key, value);
    
    // Also store in database for persistence
    this.storeMetric('gauge', name, value, labels);
  }
  
  incrementCounter(name: string, value: number = 1, labels?: Record<string, string>): void {
    const key = this.buildMetricKey(name, labels);
    const current = this.counters.get(key) || 0;
    this.counters.set(key, current + value);
    
    this.storeMetric('counter', name, current + value, labels);
  }
  
  async getMetrics(): Promise<PrometheusMetrics> {
    const metrics: string[] = [];
    
    // Format gauges
    for (const [key, value] of this.gauges) {
      const [name, labels] = this.parseMetricKey(key);
      metrics.push(this.formatMetric('gauge', name, value, labels));
    }
    
    // Format counters
    for (const [key, value] of this.counters) {
      const [name, labels] = this.parseMetricKey(key);
      metrics.push(this.formatMetric('counter', name, value, labels));
    }
    
    return metrics.join('\n');
  }
}
```

### Analytics Queries
```typescript
class CacheAnalytics {
  async getHitRate(timeRange: TimeRange, filters?: AnalyticsFilters): Promise<HitRateData> {
    const result = await this.db.query(`
      SELECT 
        date,
        SUM(hits) as total_hits,
        SUM(misses) as total_misses,
        ROUND(SUM(hits)::numeric / NULLIF(SUM(hits) + SUM(misses), 0) * 100, 2) as hit_rate
      FROM cache_stats
      WHERE date >= $1 AND date <= $2
        ${filters?.framework ? 'AND framework = $3' : ''}
        ${filters?.tier ? 'AND tier = $4' : ''}
      GROUP BY date
      ORDER BY date
    `, this.buildQueryParams(timeRange, filters));
    
    return {
      dates: result.rows.map(r => r.date),
      hitRates: result.rows.map(r => r.hit_rate),
      totalHits: result.rows.reduce((sum, r) => sum + r.total_hits, 0),
      totalMisses: result.rows.reduce((sum, r) => sum + r.total_misses, 0)
    };
  }
  
  async getPerformanceMetrics(timeRange: TimeRange): Promise<PerformanceData> {
    const result = await this.db.query(`
      SELECT 
        tier,
        COUNT(*) as requests,
        AVG(total_response_time_ms::numeric / NULLIF(hits + misses, 0)) as avg_response_time,
        MAX(max_response_time_ms) as max_response_time,
        MIN(min_response_time_ms) as min_response_time,
        PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY total_response_time_ms::numeric / NULLIF(hits + misses, 0)) as p50,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY total_response_time_ms::numeric / NULLIF(hits + misses, 0)) as p95,
        PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY total_response_time_ms::numeric / NULLIF(hits + misses, 0)) as p99
      FROM cache_stats
      WHERE date >= $1 AND date <= $2
      GROUP BY tier
    `, [timeRange.start, timeRange.end]);
    
    return result.rows;
  }
  
  async getTopComponents(limit: number = 10): Promise<ComponentUsage[]> {
    const result = await this.db.query(`
      SELECT 
        c.framework,
        c.name,
        c.access_count,
        c.file_size,
        c.last_modified,
        c.accessed_at
      FROM components c
      ORDER BY c.access_count DESC
      LIMIT $1
    `, [limit]);
    
    return result.rows;
  }
}
```

### Monitoring Dashboard Data
```typescript
class MonitoringDashboard {
  async getDashboardData(): Promise<DashboardData> {
    const [
      currentStats,
      hitRateTrend,
      performanceMetrics,
      topComponents,
      cacheSize,
      githubRateLimit
    ] = await Promise.all([
      this.getCurrentStats(),
      this.getHitRateTrend(7), // Last 7 days
      this.getPerformanceMetrics(),
      this.getTopComponents(10),
      this.getCacheSize(),
      this.getGitHubRateLimit()
    ]);
    
    return {
      overview: {
        totalRequests: currentStats.totalRequests,
        hitRate: currentStats.hitRate,
        avgResponseTime: currentStats.avgResponseTime,
        cacheSize: cacheSize.total,
        lastUpdated: new Date()
      },
      trends: {
        hitRate: hitRateTrend,
        performance: performanceMetrics
      },
      topContent: topComponents,
      system: {
        githubRateLimit,
        cacheUtilization: (cacheSize.used / cacheSize.total) * 100,
        oldestEntry: cacheSize.oldestEntry,
        newestEntry: cacheSize.newestEntry
      }
    };
  }
}
```

### Alerting System
```typescript
interface AlertRule {
  name: string;
  condition: string;
  threshold: number;
  action: 'log' | 'email' | 'webhook';
  config: any;
}

class AlertManager {
  private rules: AlertRule[] = [
    {
      name: 'low_hit_rate',
      condition: 'hit_rate < threshold',
      threshold: 50,
      action: 'log',
      config: { level: 'warn' }
    },
    {
      name: 'high_response_time',
      condition: 'avg_response_time > threshold',
      threshold: 1000,
      action: 'log',
      config: { level: 'error' }
    },
    {
      name: 'github_rate_limit_low',
      condition: 'rate_limit_remaining < threshold',
      threshold: 100,
      action: 'log',
      config: { level: 'warn' }
    }
  ];
  
  async checkAlerts(): Promise<void> {
    for (const rule of this.rules) {
      const triggered = await this.evaluateRule(rule);
      
      if (triggered) {
        await this.triggerAlert(rule);
      }
    }
  }
}
```

### Implementation Details

1. **Directory Structure**:
   ```
   src/monitoring/
   ├── collector.ts
   ├── aggregator.ts
   ├── analytics.ts
   ├── dashboard.ts
   ├── alerts.ts
   └── exporters/
       ├── prometheus.ts
       └── json.ts
   ```

2. **Performance Considerations**:
   - Async metrics collection
   - Batch database writes
   - Materialized views for dashboards
   - Efficient aggregation queries

3. **Export Formats**:
   - Prometheus metrics endpoint
   - JSON API for dashboards
   - CSV export for analysis

### Acceptance Criteria
- [ ] Statistics collection doesn't impact performance
- [ ] Hit/miss rates accurately tracked
- [ ] Response time percentiles calculated correctly
- [ ] Dashboard provides real-time insights
- [ ] Alerts trigger at correct thresholds
- [ ] Historical data retained and queryable
- [ ] Prometheus-compatible metrics endpoint

### Testing Requirements
- Unit tests for aggregation logic
- Integration tests for statistics collection
- Performance impact tests
- Alert triggering tests
- Dashboard data accuracy tests
- Metrics export format tests

### Dependencies
- Task 03: PGLite Storage Provider
- Task 04: Hybrid Storage Orchestrator

### Estimated Effort
- 3-4 days

### Example Usage
```typescript
// Initialize monitoring
const stats = new StatisticsCollector(db, {
  flushIntervalMs: 5000,
  retentionDays: 30
});

// Record events automatically in storage layer
storage.on('cache:hit', (event) => {
  stats.recordEvent({
    type: 'hit',
    tier: event.tier,
    framework: event.framework,
    resourceType: event.resourceType,
    responseTime: event.responseTime,
    bytesServed: event.size
  });
});

// Query analytics
const analytics = new CacheAnalytics(db);
const hitRate = await analytics.getHitRate({
  start: new Date('2024-01-01'),
  end: new Date('2024-01-31')
}, { framework: 'react' });

console.log(`January hit rate: ${hitRate.average}%`);

// Dashboard endpoint
app.get('/api/dashboard', async (req, res) => {
  const dashboard = new MonitoringDashboard(db);
  const data = await dashboard.getDashboardData();
  res.json(data);
});

// Prometheus metrics
app.get('/metrics', async (req, res) => {
  const metrics = await realtimeMetrics.getMetrics();
  res.type('text/plain');
  res.send(metrics);
});
```

### Notes
- Consider adding OpenTelemetry support
- Plan for data retention policies
- Add support for custom metrics
- Document dashboard setup procedures