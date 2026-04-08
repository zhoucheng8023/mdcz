import PQueue from "p-queue";

export interface DomainRateLimit {
  requestsPerSecond: number;
  intervalMs?: number;
  intervalCap?: number;
  concurrency?: number;
}

export class RateLimiter {
  private readonly defaultLimit: DomainRateLimit;

  private readonly domainLimits = new Map<string, DomainRateLimit>();

  private readonly queues = new Map<string, PQueue>();

  constructor(defaultRequestsPerSecond = 5) {
    this.defaultLimit = {
      requestsPerSecond: defaultRequestsPerSecond,
      concurrency: 1,
    };
  }

  setDomainLimit(domain: string, requestsPerSecond: number, concurrency = 1): void {
    this.domainLimits.set(domain, { requestsPerSecond, concurrency });
    this.queues.delete(domain);
  }

  setDomainInterval(domain: string, intervalMs: number, intervalCap = 1, concurrency = 1): void {
    this.domainLimits.set(domain, {
      requestsPerSecond: Math.max(1, intervalCap),
      intervalMs: Math.max(1, Math.trunc(intervalMs)),
      intervalCap: Math.max(1, Math.trunc(intervalCap)),
      concurrency,
    });
    this.queues.delete(domain);
  }

  async schedule<T>(urlOrDomain: string, task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const domain = this.extractDomain(urlOrDomain);
    const queue = this.getOrCreateQueue(domain);

    return queue.add(task, signal ? { signal } : undefined);
  }

  clear(): void {
    this.queues.forEach((queue) => {
      queue.clear();
    });
    this.queues.clear();
  }

  private getOrCreateQueue(domain: string): PQueue {
    const existing = this.queues.get(domain);

    if (existing) {
      return existing;
    }

    const limit = this.domainLimits.get(domain) ?? this.defaultLimit;
    const intervalMs = limit.intervalMs ? Math.max(1, Math.trunc(limit.intervalMs)) : 1000;
    const intervalCap = limit.intervalCap ?? Math.max(1, Math.trunc(limit.requestsPerSecond));
    const queue = new PQueue({
      concurrency: limit.concurrency ?? 1,
      interval: intervalMs,
      intervalCap,
    });

    this.queues.set(domain, queue);

    return queue;
  }

  private extractDomain(urlOrDomain: string): string {
    try {
      const normalized = urlOrDomain.startsWith("http") ? urlOrDomain : `https://${urlOrDomain}`;
      return new URL(normalized).hostname;
    } catch {
      return urlOrDomain;
    }
  }
}
