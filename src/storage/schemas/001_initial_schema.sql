-- Components table
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
  UNIQUE(framework, name)
);

-- Indexes
CREATE INDEX idx_components_framework_name ON components(framework, name);
CREATE INDEX idx_components_cached_at ON components(cached_at);
CREATE INDEX idx_components_accessed_at ON components(accessed_at);

-- Blocks table
CREATE TABLE IF NOT EXISTS blocks (
  id SERIAL PRIMARY KEY,
  framework VARCHAR(50) NOT NULL,
  name VARCHAR(100) NOT NULL,
  category VARCHAR(50),
  type VARCHAR(20) CHECK (type IN ('simple', 'complex')),
  description TEXT,
  files JSONB NOT NULL,
  structure JSONB,
  dependencies TEXT[],
  components_used TEXT[],
  total_size INTEGER,
  github_sha VARCHAR(40),
  cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  accessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  access_count INTEGER DEFAULT 1,
  UNIQUE(framework, name)
);

-- Indexes
CREATE INDEX idx_blocks_framework_name ON blocks(framework, name);
CREATE INDEX idx_blocks_category ON blocks(category);

-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);