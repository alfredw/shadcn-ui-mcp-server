import { logInfo } from './logger.js';

export interface DeduplicationStats {
  totalRequests: number;
  deduplicatedRequests: number;
  currentInFlight: number;
  deduplicationRate: number;
}

export class RequestDeduplicator {
  private inFlightRequests = new Map<string, Promise<any>>();
  private stats = {
    totalRequests: 0,
    deduplicatedRequests: 0,
  };

  async deduplicate<T>(
    key: string,
    factory: () => Promise<T>
  ): Promise<T> {
    this.stats.totalRequests++;

    if (this.inFlightRequests.has(key)) {
      this.stats.deduplicatedRequests++;
      logInfo(`Deduplicating request for key: ${key}`);
      return this.inFlightRequests.get(key)!;
    }

    const promise = factory()
      .finally(() => {
        this.inFlightRequests.delete(key);
      });

    this.inFlightRequests.set(key, promise);

    return promise;
  }

  getInFlightCount(): number {
    return this.inFlightRequests.size;
  }

  getStats(): DeduplicationStats {
    const { totalRequests, deduplicatedRequests } = this.stats;
    return {
      totalRequests,
      deduplicatedRequests,
      currentInFlight: this.inFlightRequests.size,
      deduplicationRate: totalRequests > 0 ? (deduplicatedRequests / totalRequests) * 100 : 0,
    };
  }

  clear(): void {
    this.inFlightRequests.clear();
    this.stats = {
      totalRequests: 0,
      deduplicatedRequests: 0,
    };
  }
}