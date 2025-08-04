# Phase 1, Task 1: Request Deduplication

## Overview
Implement request deduplication to prevent duplicate concurrent API calls for the same resource. This optimization will reduce unnecessary GitHub API calls when multiple components request the same data simultaneously.

## Problem Statement
Currently, if multiple tools or components request the same data at the same time, each request results in a separate API call to GitHub. This wastes API quota and increases latency.

## Objectives
- Prevent duplicate concurrent requests for the same resource
- Share results between concurrent requesters
- Maintain request isolation and error handling
- Zero impact on non-concurrent requests

## Technical Requirements

### Implementation Location
Update `src/utils/storage-integration.ts` to add deduplication layer before cache checking.

### Request Deduplicator Class
```typescript
export class RequestDeduplicator {
  private inFlightRequests = new Map<string, Promise<any>>();
  
  async deduplicate<T>(
    key: string, 
    factory: () => Promise<T>
  ): Promise<T> {
    // Check if request is already in flight
    if (this.inFlightRequests.has(key)) {
      return this.inFlightRequests.get(key)!;
    }
    
    // Create new request
    const promise = factory()
      .finally(() => {
        // Clean up after completion
        this.inFlightRequests.delete(key);
      });
    
    this.inFlightRequests.set(key, promise);
    
    return promise;
  }
  
  // Get current in-flight request count
  getInFlightCount(): number {
    return this.inFlightRequests.size;
  }
  
  // Clear all in-flight requests (for testing)
  clear(): void {
    this.inFlightRequests.clear();
  }
}
```

### Integration with getCachedData
```typescript
const deduplicator = new RequestDeduplicator();

export async function getCachedData<T>(
  cacheKey: string,
  fetchFunction: () => Promise<T>,
  ttl?: number
): Promise<T> {
  try {
    // First check if storage is available
    if (!isStorageInitialized()) {
      return fetchFunction();
    }

    const storage = getStorage();
    
    // Check cache first
    const cached = await storage.get(cacheKey);
    if (cached) {
      return cached;
    }
    
    // Deduplicate the fetch request
    const data = await deduplicator.deduplicate(
      cacheKey,
      async () => {
        // Double-check cache in case another request populated it
        const rechecked = await storage.get(cacheKey);
        if (rechecked) {
          return rechecked;
        }
        
        // Fetch and cache
        const result = await fetchFunction();
        await storage.set(cacheKey, result, ttl);
        return result;
      }
    );
    
    return data;
    
  } catch (error) {
    logger.error('Cache operation failed:', error);
    return fetchFunction();
  }
}
```

### Batch Operation Deduplication
```typescript
export async function getCachedDataBatch<T>(
  requests: Array<{
    key: string;
    fetchFunction: () => Promise<T>;
    ttl?: number;
  }>
): Promise<T[]> {
  // Group by deduplication potential
  const uniqueRequests = new Map<string, typeof requests[0]>();
  const keyToIndices = new Map<string, number[]>();
  
  requests.forEach((req, index) => {
    if (!keyToIndices.has(req.key)) {
      keyToIndices.set(req.key, []);
      uniqueRequests.set(req.key, req);
    }
    keyToIndices.get(req.key)!.push(index);
  });
  
  // Fetch unique requests
  const uniqueResults = await Promise.all(
    Array.from(uniqueRequests.values()).map(req =>
      getCachedData(req.key, req.fetchFunction, req.ttl)
    )
  );
  
  // Map results back to original order
  const results = new Array(requests.length);
  let uniqueIndex = 0;
  
  for (const [key, indices] of keyToIndices) {
    const result = uniqueResults[uniqueIndex++];
    indices.forEach(i => {
      results[i] = result;
    });
  }
  
  return results;
}
```

## Implementation Details

### Statistics Integration
Add deduplication metrics to statistics:
```typescript
interface DeduplicationStats {
  totalRequests: number;
  deduplicatedRequests: number;
  currentInFlight: number;
  deduplicationRate: number; // percentage
}
```

### Testing Concurrent Requests
```typescript
describe('Request Deduplication', () => {
  it('should deduplicate concurrent requests', async () => {
    let callCount = 0;
    const fetchFn = async () => {
      callCount++;
      await new Promise(resolve => setTimeout(resolve, 100));
      return `result-${callCount}`;
    };
    
    // Make 5 concurrent requests
    const promises = Array(5).fill(0).map(() =>
      getCachedData('test-key', fetchFn)
    );
    
    const results = await Promise.all(promises);
    
    // Should only call fetch once
    expect(callCount).toBe(1);
    
    // All results should be identical
    expect(results).toEqual(['result-1', 'result-1', 'result-1', 'result-1', 'result-1']);
  });
});
```

## Acceptance Criteria
- [ ] Concurrent requests for same key only trigger one fetch
- [ ] All requesters receive the same result
- [ ] Errors are propagated to all waiting requesters  
- [ ] No memory leaks from in-flight request tracking
- [ ] Deduplication statistics are tracked
- [ ] Batch operations benefit from deduplication
- [ ] Zero performance impact on non-concurrent requests

## Testing Requirements
- Unit tests for RequestDeduplicator class
- Integration tests with getCachedData
- Concurrent request tests
- Error propagation tests
- Memory leak tests
- Performance benchmarks

## Estimated Effort
- 4-6 hours

## Dependencies
- Existing storage-integration.ts
- Statistics collection system

## Notes
- Consider adding request cancellation support in future
- Monitor memory usage of in-flight request map
- Add configuration for max in-flight requests