import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RequestDeduplicator } from '../../src/utils/request-deduplicator.js';

describe('RequestDeduplicator', () => {
  let deduplicator: RequestDeduplicator;

  beforeEach(() => {
    deduplicator = new RequestDeduplicator();
  });

  describe('deduplicate', () => {
    it('should execute factory function for unique requests', async () => {
      const mockFactory = vi.fn().mockResolvedValue('result');
      
      const result = await deduplicator.deduplicate('key1', mockFactory);
      
      expect(result).toBe('result');
      expect(mockFactory).toHaveBeenCalledOnce();
    });

    it('should prevent duplicate work for concurrent requests', async () => {
      let callCount = 0;
      const mockFactory = vi.fn().mockImplementation(async () => {
        callCount++;
        await new Promise(resolve => setTimeout(resolve, 50));
        return `result-${callCount}`;
      });

      // Make 5 concurrent requests for same key
      const promises = Array(5).fill(0).map(() =>
        deduplicator.deduplicate('same-key', mockFactory)
      );

      const results = await Promise.all(promises);

      // Should only execute factory once
      expect(mockFactory).toHaveBeenCalledOnce();
      expect(callCount).toBe(1);

      // All requesters should get same result
      expect(results).toEqual(['result-1', 'result-1', 'result-1', 'result-1', 'result-1']);
    });

    it('should allow different keys to execute independently', async () => {
      const factory1 = vi.fn().mockResolvedValue('result1');
      const factory2 = vi.fn().mockResolvedValue('result2');

      const [result1, result2] = await Promise.all([
        deduplicator.deduplicate('key1', factory1),
        deduplicator.deduplicate('key2', factory2)
      ]);

      expect(result1).toBe('result1');
      expect(result2).toBe('result2');
      expect(factory1).toHaveBeenCalledOnce();
      expect(factory2).toHaveBeenCalledOnce();
    });

    it('should propagate errors to all waiting requesters', async () => {
      const error = new Error('Test error');
      const mockFactory = vi.fn().mockRejectedValue(error);

      const promises = Array(3).fill(0).map(() =>
        deduplicator.deduplicate('error-key', mockFactory)
      );

      await expect(Promise.all(promises)).rejects.toThrow('Test error');
      expect(mockFactory).toHaveBeenCalledOnce();
    });

    it('should allow new requests after previous request completes', async () => {
      const factory1 = vi.fn().mockResolvedValue('result1');
      const factory2 = vi.fn().mockResolvedValue('result2');

      const result1 = await deduplicator.deduplicate('key1', factory1);
      const result2 = await deduplicator.deduplicate('key1', factory2);

      expect(result1).toBe('result1');
      expect(result2).toBe('result2');
      expect(factory1).toHaveBeenCalledOnce();
      expect(factory2).toHaveBeenCalledOnce();
    });
  });

  describe('getInFlightCount', () => {
    it('should report zero active requests initially', () => {
      expect(deduplicator.getInFlightCount()).toBe(0);
    });

    it('should accurately report number of active concurrent requests', async () => {
      const slowFactory = () => new Promise(resolve => setTimeout(() => resolve('result'), 100));

      const promise1 = deduplicator.deduplicate('key1', slowFactory);
      const promise2 = deduplicator.deduplicate('key2', slowFactory);

      expect(deduplicator.getInFlightCount()).toBe(2);

      await Promise.all([promise1, promise2]);
      expect(deduplicator.getInFlightCount()).toBe(0);
    });

    it('should count deduplicated requests as single active request', async () => {
      const slowFactory = () => new Promise(resolve => setTimeout(() => resolve('result'), 50));

      // Start 3 concurrent requests for same key
      const promise1 = deduplicator.deduplicate('same-key', slowFactory);
      const promise2 = deduplicator.deduplicate('same-key', slowFactory);
      const promise3 = deduplicator.deduplicate('same-key', slowFactory);

      // Should only count as 1 active request
      expect(deduplicator.getInFlightCount()).toBe(1);

      await Promise.all([promise1, promise2, promise3]);
      expect(deduplicator.getInFlightCount()).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return initial empty statistics', () => {
      const stats = deduplicator.getStats();
      expect(stats).toEqual({
        totalRequests: 0,
        deduplicatedRequests: 0,
        currentInFlight: 0,
        deduplicationRate: 0
      });
    });

    it('should accurately track deduplication metrics', async () => {
      const mockFactory = vi.fn().mockResolvedValue('result');

      // Single request - no deduplication
      await deduplicator.deduplicate('key1', mockFactory);

      let stats = deduplicator.getStats();
      expect(stats.totalRequests).toBe(1);
      expect(stats.deduplicatedRequests).toBe(0);
      expect(stats.deduplicationRate).toBe(0);

      // Concurrent requests - should deduplicate
      const promises = Array(4).fill(0).map(() =>
        deduplicator.deduplicate('key2', mockFactory)
      );
      await Promise.all(promises);

      stats = deduplicator.getStats();
      expect(stats.totalRequests).toBe(5); // 1 + 4
      expect(stats.deduplicatedRequests).toBe(3); // 3 of the 4 were deduplicated
      expect(stats.deduplicationRate).toBe(60); // 3/5 * 100
    });

    it('should calculate deduplication rate correctly', async () => {
      const mockFactory = vi.fn().mockResolvedValue('result');

      // 10 concurrent requests - 9 should be deduplicated
      const promises = Array(10).fill(0).map(() =>
        deduplicator.deduplicate('same-key', mockFactory)
      );
      await Promise.all(promises);

      const stats = deduplicator.getStats();
      expect(stats.totalRequests).toBe(10);
      expect(stats.deduplicatedRequests).toBe(9);
      expect(stats.deduplicationRate).toBe(90);
    });

    it('should include current in-flight count in statistics', async () => {
      const slowFactory = () => new Promise(resolve => setTimeout(() => resolve('result'), 100));

      const promise1 = deduplicator.deduplicate('key1', slowFactory);
      const promise2 = deduplicator.deduplicate('key2', slowFactory);

      const stats = deduplicator.getStats();
      expect(stats.currentInFlight).toBe(2);

      await Promise.all([promise1, promise2]);
      
      const finalStats = deduplicator.getStats();
      expect(finalStats.currentInFlight).toBe(0);
    });
  });

  describe('clear', () => {
    it('should reset deduplicator to initial state', async () => {
      const mockFactory = vi.fn().mockResolvedValue('result');

      // Populate some stats
      await deduplicator.deduplicate('key1', mockFactory);
      
      // Add in-flight request
      const slowFactory = () => new Promise(resolve => setTimeout(() => resolve('result'), 100));
      deduplicator.deduplicate('key2', slowFactory);

      expect(deduplicator.getInFlightCount()).toBe(1);
      expect(deduplicator.getStats().totalRequests).toBe(2);

      deduplicator.clear();

      expect(deduplicator.getInFlightCount()).toBe(0);
      const stats = deduplicator.getStats();
      expect(stats.totalRequests).toBe(0);
      expect(stats.deduplicatedRequests).toBe(0);
      expect(stats.deduplicationRate).toBe(0);
    });
  });

  describe('error handling and resource management', () => {
    it('should clean up after successful requests', async () => {
      const mockFactory = vi.fn().mockResolvedValue('result');

      await deduplicator.deduplicate('key1', mockFactory);
      
      expect(deduplicator.getInFlightCount()).toBe(0);
    });

    it('should clean up after failed requests', async () => {
      const mockFactory = vi.fn().mockRejectedValue(new Error('Test error'));

      await expect(deduplicator.deduplicate('error-key', mockFactory)).rejects.toThrow('Test error');
      
      expect(deduplicator.getInFlightCount()).toBe(0);
    });

    it('should handle mixed success and error scenarios', async () => {
      const successFactory = vi.fn().mockResolvedValue('success');
      const errorFactory = vi.fn().mockRejectedValue(new Error('error'));

      const promises = [
        deduplicator.deduplicate('success-key', successFactory),
        deduplicator.deduplicate('error-key', errorFactory).catch(e => e.message)
      ];

      const results = await Promise.all(promises);

      expect(results).toEqual(['success', 'error']);
      expect(deduplicator.getInFlightCount()).toBe(0);
    });
  });
});