import PQueue from 'p-queue';

const IDLE_TIMEOUT_MS = 30 * 60_000; // 30 minutes

export class AgentPool {
  private projectQueues = new Map<string, PQueue>();
  private globalSemaphore: PQueue;
  private idleTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private maxConcurrent: number,
    private maxQueueDepth: number,
    private maxMemoryMB: number,
  ) {
    this.globalSemaphore = new PQueue({ concurrency: maxConcurrent });
  }

  async enqueue<T>(
    project: string,
    fn: () => Promise<T>,
  ): Promise<{ result: Promise<T>; position: number }> {
    // Check memory pressure
    const rss = process.memoryUsage().rss;
    if (rss > this.maxMemoryMB * 1024 * 1024) {
      throw new Error(
        `Memory pressure: RSS ${Math.round(rss / 1024 / 1024)}MB exceeds limit ${this.maxMemoryMB}MB`,
      );
    }

    const queue = this.getOrCreateQueue(project);

    // Check queue depth
    const depth = queue.size + queue.pending;
    if (depth >= this.maxQueueDepth) {
      throw new Error(
        `Queue full for project "${project}": ${depth}/${this.maxQueueDepth}`,
      );
    }

    const position = depth;

    // Reset idle timer for this project
    this.resetIdleTimer(project);

    const result = queue.add(async () => {
      // Wait for a global semaphore slot before running
      return this.globalSemaphore.add(() => fn()) as Promise<T>;
    }) as Promise<T>;

    return { result, position };
  }

  getQueueDepth(project: string): number {
    const queue = this.projectQueues.get(project);
    if (!queue) return 0;
    return queue.size + queue.pending;
  }

  getActiveCount(): number {
    return this.globalSemaphore.pending;
  }

  async shutdown(): Promise<void> {
    // Clear all idle timers
    for (const timer of this.idleTimers.values()) {
      clearTimeout(timer);
    }
    this.idleTimers.clear();

    // Clear all project queues
    for (const queue of this.projectQueues.values()) {
      queue.clear();
    }
    this.projectQueues.clear();

    // Wait for in-flight work to complete
    await this.globalSemaphore.onIdle();
    this.globalSemaphore.clear();
  }

  private getOrCreateQueue(project: string): PQueue {
    let queue = this.projectQueues.get(project);
    if (!queue) {
      queue = new PQueue({ concurrency: 1 });
      this.projectQueues.set(project, queue);
    }
    return queue;
  }

  private resetIdleTimer(project: string): void {
    const existing = this.idleTimers.get(project);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      const queue = this.projectQueues.get(project);
      if (queue && queue.size === 0 && queue.pending === 0) {
        this.projectQueues.delete(project);
        this.idleTimers.delete(project);
      }
    }, IDLE_TIMEOUT_MS);

    // Don't hold the process open for idle timers
    timer.unref();
    this.idleTimers.set(project, timer);
  }
}
