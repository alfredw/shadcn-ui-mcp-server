-- Add performance indexes for common queries
CREATE INDEX IF NOT EXISTS idx_components_access_count ON components(access_count DESC);
CREATE INDEX IF NOT EXISTS idx_blocks_access_count ON blocks(access_count DESC);

-- Add index for framework-specific queries with access time
CREATE INDEX IF NOT EXISTS idx_components_framework_accessed ON components(framework, accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_blocks_framework_accessed ON blocks(framework, accessed_at DESC);

-- DOWN
DROP INDEX IF EXISTS idx_components_access_count;
DROP INDEX IF EXISTS idx_blocks_access_count;
DROP INDEX IF EXISTS idx_components_framework_accessed;
DROP INDEX IF EXISTS idx_blocks_framework_accessed;