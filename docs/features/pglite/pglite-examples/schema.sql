-- PGLite Schema for shadcn-ui-mcp-server
-- Version: 1.0.0

-- Enable required extensions
-- Note: PGLite supports many extensions including pgvector

-- Components table: Stores individual UI components
CREATE TABLE IF NOT EXISTS components (
  id SERIAL PRIMARY KEY,
  framework VARCHAR(50) NOT NULL,
  name VARCHAR(100) NOT NULL,
  source_code TEXT NOT NULL,
  demo_code TEXT,
  metadata JSONB,
  dependencies TEXT[],
  registry_dependencies TEXT[],
  github_sha VARCHAR(40),
  file_size INTEGER,
  last_modified TIMESTAMP,
  cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  accessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  access_count INTEGER DEFAULT 1,
  ttl_override INTEGER, -- Override default TTL in seconds
  CONSTRAINT uk_components_framework_name UNIQUE(framework, name)
);

-- Indexes for components
CREATE INDEX IF NOT EXISTS idx_components_framework_name ON components(framework, name);
CREATE INDEX IF NOT EXISTS idx_components_cached_at ON components(cached_at);
CREATE INDEX IF NOT EXISTS idx_components_accessed_at ON components(accessed_at);
CREATE INDEX IF NOT EXISTS idx_components_access_count ON components(access_count DESC);

-- Blocks table: Stores UI blocks (complex components)
CREATE TABLE IF NOT EXISTS blocks (
  id SERIAL PRIMARY KEY,
  framework VARCHAR(50) NOT NULL,
  name VARCHAR(100) NOT NULL,
  category VARCHAR(50),
  type VARCHAR(20) CHECK (type IN ('simple', 'complex')),
  description TEXT,
  files JSONB NOT NULL, -- Stores all file contents
  structure JSONB,      -- Directory structure metadata
  dependencies TEXT[],
  components_used TEXT[],
  total_size INTEGER,
  file_count INTEGER,
  github_sha VARCHAR(40),
  cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  accessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  access_count INTEGER DEFAULT 1,
  ttl_override INTEGER,
  CONSTRAINT uk_blocks_framework_name UNIQUE(framework, name)
);

-- Indexes for blocks
CREATE INDEX IF NOT EXISTS idx_blocks_framework_name ON blocks(framework, name);
CREATE INDEX IF NOT EXISTS idx_blocks_category ON blocks(category);
CREATE INDEX IF NOT EXISTS idx_blocks_type ON blocks(type);
CREATE INDEX IF NOT EXISTS idx_blocks_cached_at ON blocks(cached_at);
CREATE INDEX IF NOT EXISTS idx_blocks_access_count ON blocks(access_count DESC);

-- Component registry: Tracks all available components
CREATE TABLE IF NOT EXISTS component_registry (
  id SERIAL PRIMARY KEY,
  framework VARCHAR(50) NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  category VARCHAR(50),
  tags TEXT[],
  is_new BOOLEAN DEFAULT false,
  is_updated BOOLEAN DEFAULT false,
  first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uk_registry_framework_name UNIQUE(framework, name)
);

-- Cache metadata: System-wide cache information
CREATE TABLE IF NOT EXISTS cache_metadata (
  key VARCHAR(255) PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Initialize cache metadata
INSERT INTO cache_metadata (key, value) VALUES 
  ('cache_version', '{"version": "1.0.0", "schema_version": 1}'),
  ('github_rate_limit', '{"limit": 60, "remaining": 60, "reset": null}'),
  ('last_full_sync', '{"timestamp": null, "components": 0, "blocks": 0}'),
  ('cache_settings', '{"ttl_seconds": 604800, "max_size_mb": 100, "auto_refresh": true}')
ON CONFLICT (key) DO NOTHING;

-- Cache statistics: Track cache performance
CREATE TABLE IF NOT EXISTS cache_stats (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  hour INTEGER NOT NULL CHECK (hour >= 0 AND hour < 24),
  framework VARCHAR(50) NOT NULL,
  resource_type VARCHAR(20) NOT NULL CHECK (resource_type IN ('component', 'block', 'metadata')),
  hits INTEGER DEFAULT 0,
  misses INTEGER DEFAULT 0,
  github_fetches INTEGER DEFAULT 0,
  avg_response_time_ms FLOAT,
  errors INTEGER DEFAULT 0,
  CONSTRAINT uk_stats_date_hour_framework_type UNIQUE(date, hour, framework, resource_type)
);

-- Index for stats queries
CREATE INDEX IF NOT EXISTS idx_stats_date ON cache_stats(date DESC);
CREATE INDEX IF NOT EXISTS idx_stats_framework ON cache_stats(framework);

-- Request log: Track individual requests (optional, for analytics)
CREATE TABLE IF NOT EXISTS request_log (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  framework VARCHAR(50),
  resource_type VARCHAR(20),
  resource_name VARCHAR(100),
  cache_hit BOOLEAN,
  response_time_ms FLOAT,
  error_message TEXT,
  user_agent TEXT,
  -- Rotate old entries automatically
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for log queries
CREATE INDEX IF NOT EXISTS idx_request_log_timestamp ON request_log(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_request_log_resource ON request_log(framework, resource_type, resource_name);

-- Create a view for popular components
CREATE OR REPLACE VIEW popular_components AS
SELECT 
  framework,
  name,
  access_count,
  accessed_at,
  ROUND(file_size::numeric / 1024, 2) as size_kb,
  cached_at
FROM components
WHERE access_count > 5
ORDER BY access_count DESC
LIMIT 50;

-- Create a view for cache health
CREATE OR REPLACE VIEW cache_health AS
SELECT 
  'components' as resource_type,
  COUNT(*) as total_count,
  SUM(file_size)::bigint as total_size_bytes,
  ROUND(SUM(file_size)::numeric / 1024 / 1024, 2) as total_size_mb,
  AVG(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - cached_at))) as avg_age_seconds,
  MAX(cached_at) as newest_entry,
  MIN(cached_at) as oldest_entry
FROM components
UNION ALL
SELECT 
  'blocks' as resource_type,
  COUNT(*) as total_count,
  SUM(total_size)::bigint as total_size_bytes,
  ROUND(SUM(total_size)::numeric / 1024 / 1024, 2) as total_size_mb,
  AVG(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - cached_at))) as avg_age_seconds,
  MAX(cached_at) as newest_entry,
  MIN(cached_at) as oldest_entry
FROM blocks;

-- Function to clean expired cache entries
CREATE OR REPLACE FUNCTION clean_expired_cache(ttl_seconds INTEGER DEFAULT 604800)
RETURNS TABLE(
  resource_type TEXT,
  deleted_count INTEGER
) AS $$
DECLARE
  component_count INTEGER;
  block_count INTEGER;
BEGIN
  -- Delete expired components
  WITH deleted AS (
    DELETE FROM components
    WHERE cached_at < CURRENT_TIMESTAMP - (ttl_seconds || ' seconds')::INTERVAL
    AND (ttl_override IS NULL OR cached_at < CURRENT_TIMESTAMP - (ttl_override || ' seconds')::INTERVAL)
    RETURNING 1
  )
  SELECT COUNT(*)::INTEGER INTO component_count FROM deleted;

  -- Delete expired blocks
  WITH deleted AS (
    DELETE FROM blocks
    WHERE cached_at < CURRENT_TIMESTAMP - (ttl_seconds || ' seconds')::INTERVAL
    AND (ttl_override IS NULL OR cached_at < CURRENT_TIMESTAMP - (ttl_override || ' seconds')::INTERVAL)
    RETURNING 1
  )
  SELECT COUNT(*)::INTEGER INTO block_count FROM deleted;

  -- Return results
  RETURN QUERY
  SELECT 'components'::TEXT, component_count
  UNION ALL
  SELECT 'blocks'::TEXT, block_count;
END;
$$ LANGUAGE plpgsql;

-- Function to update access statistics
CREATE OR REPLACE FUNCTION update_access_stats(
  p_framework VARCHAR(50),
  p_resource_type VARCHAR(20),
  p_resource_name VARCHAR(100),
  p_cache_hit BOOLEAN,
  p_response_time_ms FLOAT
)
RETURNS VOID AS $$
BEGIN
  -- Update cache stats
  INSERT INTO cache_stats (date, hour, framework, resource_type, hits, misses, github_fetches, avg_response_time_ms)
  VALUES (
    CURRENT_DATE,
    EXTRACT(HOUR FROM CURRENT_TIMESTAMP)::INTEGER,
    p_framework,
    p_resource_type,
    CASE WHEN p_cache_hit THEN 1 ELSE 0 END,
    CASE WHEN NOT p_cache_hit THEN 1 ELSE 0 END,
    CASE WHEN NOT p_cache_hit THEN 1 ELSE 0 END,
    p_response_time_ms
  )
  ON CONFLICT (date, hour, framework, resource_type)
  DO UPDATE SET
    hits = cache_stats.hits + CASE WHEN p_cache_hit THEN 1 ELSE 0 END,
    misses = cache_stats.misses + CASE WHEN NOT p_cache_hit THEN 1 ELSE 0 END,
    github_fetches = cache_stats.github_fetches + CASE WHEN NOT p_cache_hit THEN 1 ELSE 0 END,
    avg_response_time_ms = (
      (cache_stats.avg_response_time_ms * (cache_stats.hits + cache_stats.misses) + p_response_time_ms) /
      (cache_stats.hits + cache_stats.misses + 1)
    );

  -- Update access timestamp and count
  IF p_resource_type = 'component' THEN
    UPDATE components 
    SET accessed_at = CURRENT_TIMESTAMP, 
        access_count = access_count + 1
    WHERE framework = p_framework AND name = p_resource_name;
  ELSIF p_resource_type = 'block' THEN
    UPDATE blocks 
    SET accessed_at = CURRENT_TIMESTAMP, 
        access_count = access_count + 1
    WHERE framework = p_framework AND name = p_resource_name;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update cache_metadata timestamps
CREATE OR REPLACE FUNCTION update_metadata_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_cache_metadata_timestamp
BEFORE UPDATE ON cache_metadata
FOR EACH ROW
EXECUTE FUNCTION update_metadata_timestamp();

-- Create indexes for JSON queries (if needed for specific use cases)
CREATE INDEX IF NOT EXISTS idx_components_metadata ON components USING GIN (metadata);
CREATE INDEX IF NOT EXISTS idx_blocks_files ON blocks USING GIN (files);

-- Add comments for documentation
COMMENT ON TABLE components IS 'Stores individual shadcn/ui components with their source code and metadata';
COMMENT ON TABLE blocks IS 'Stores complex UI blocks consisting of multiple files';
COMMENT ON TABLE component_registry IS 'Registry of all known components across frameworks';
COMMENT ON TABLE cache_metadata IS 'System-wide cache configuration and state';
COMMENT ON TABLE cache_stats IS 'Aggregated statistics for cache performance monitoring';
COMMENT ON TABLE request_log IS 'Optional detailed request logging for analytics';