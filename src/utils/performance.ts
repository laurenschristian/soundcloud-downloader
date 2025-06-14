import { useCallback, useEffect, useRef } from "react";

// Debounce hook for performance optimization
export function useDebounce<T extends (...args: any[]) => any>(callback: T, delay: number): T {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const debouncedCallback = useCallback(
    (...args: Parameters<T>): ReturnType<T> => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      // For async functions, return a Promise
      if (callback.constructor.name === "AsyncFunction" || (callback as any)[Symbol.toStringTag] === "AsyncFunction") {
        return new Promise((resolve, reject) => {
          timeoutRef.current = setTimeout(async () => {
            try {
              const result = await callback(...args);
              resolve(result);
            } catch (error) {
              reject(error);
            }
          }, delay);
        }) as ReturnType<T>;
      }

      // For regular functions
      timeoutRef.current = setTimeout(() => {
        callback(...args);
      }, delay);

      return undefined as ReturnType<T>;
    },
    [callback, delay],
  ) as T;

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return debouncedCallback;
}

// Resource cleanup utility
export class ResourceManager {
  private resources: Set<() => void> = new Set();

  addResource(cleanup: () => void): void {
    this.resources.add(cleanup);
  }

  removeResource(cleanup: () => void): void {
    this.resources.delete(cleanup);
  }

  cleanup(): void {
    this.resources.forEach((cleanup) => {
      try {
        cleanup();
      } catch (error) {
        console.error("Error during resource cleanup:", error);
      }
    });
    this.resources.clear();
  }
}

// Process manager for handling external processes
export class ProcessManager {
  private processes: Map<string, any> = new Map();

  addProcess(id: string, process: any): void {
    // Kill existing process with same ID if it exists
    this.killProcess(id);
    this.processes.set(id, process);

    // Set up process cleanup on completion
    if (process && typeof process.then === "function") {
      process.finally(() => {
        this.processes.delete(id);
        console.log(`🗑️ Process ${id} cleaned up automatically`);
      });
    }
  }

  killProcess(id: string): boolean {
    const process = this.processes.get(id);
    if (process) {
      try {
        if (process.kill) {
          process.kill("SIGTERM");
        } else if (process.cancel) {
          process.cancel();
        }
        this.processes.delete(id);
        console.log(`🔪 Process ${id} killed successfully`);
        return true;
      } catch (error) {
        console.error(`Error killing process ${id}:`, error);
        // Still remove from map even if kill failed
        this.processes.delete(id);
        return false;
      }
    }
    return false;
  }

  killAllProcesses(): void {
    console.log(`🔪 Killing all ${this.processes.size} processes`);
    this.processes.forEach((process, id) => {
      this.killProcess(id);
    });
  }

  getProcessCount(): number {
    return this.processes.size;
  }

  isProcessRunning(id: string): boolean {
    return this.processes.has(id);
  }
}

// Memory usage monitoring
export class MemoryMonitor {
  private static instance: MemoryMonitor;
  private measurements: Array<{ timestamp: number; usage: number }> = [];
  private readonly maxMeasurements = 100;

  static getInstance(): MemoryMonitor {
    if (!MemoryMonitor.instance) {
      MemoryMonitor.instance = new MemoryMonitor();
    }
    return MemoryMonitor.instance;
  }

  recordUsage(): void {
    if (typeof process !== "undefined" && process.memoryUsage) {
      const usage = process.memoryUsage();
      this.measurements.push({
        timestamp: Date.now(),
        usage: usage.heapUsed,
      });

      // Keep only recent measurements
      if (this.measurements.length > this.maxMeasurements) {
        this.measurements = this.measurements.slice(-this.maxMeasurements);
      }
    }
  }

  getAverageUsage(windowMs: number = 60000): number {
    const now = Date.now();
    const recentMeasurements = this.measurements.filter((m) => now - m.timestamp <= windowMs);

    if (recentMeasurements.length === 0) return 0;

    const total = recentMeasurements.reduce((sum, m) => sum + m.usage, 0);
    return total / recentMeasurements.length;
  }

  getPeakUsage(windowMs: number = 60000): number {
    const now = Date.now();
    const recentMeasurements = this.measurements.filter((m) => now - m.timestamp <= windowMs);

    if (recentMeasurements.length === 0) return 0;

    return Math.max(...recentMeasurements.map((m) => m.usage));
  }
}

// Performance timer utility
export class PerformanceTimer {
  private startTime: number = 0;
  private endTime: number = 0;
  private measurements: Map<string, number[]> = new Map();

  start(): void {
    this.startTime = performance.now();
  }

  end(): number {
    this.endTime = performance.now();
    return this.endTime - this.startTime;
  }

  measure(label: string): number {
    const duration = this.end();

    if (!this.measurements.has(label)) {
      this.measurements.set(label, []);
    }

    const measurements = this.measurements.get(label)!;
    measurements.push(duration);

    // Keep only recent measurements (last 100)
    if (measurements.length > 100) {
      measurements.splice(0, measurements.length - 100);
    }

    return duration;
  }

  getAverageDuration(label: string): number {
    const measurements = this.measurements.get(label);
    if (!measurements || measurements.length === 0) return 0;

    const sum = measurements.reduce((acc, val) => acc + val, 0);
    return sum / measurements.length;
  }

  getStats(label: string): { avg: number; min: number; max: number; count: number } {
    const measurements = this.measurements.get(label);
    if (!measurements || measurements.length === 0) {
      return { avg: 0, min: 0, max: 0, count: 0 };
    }

    const sum = measurements.reduce((acc, val) => acc + val, 0);
    return {
      avg: sum / measurements.length,
      min: Math.min(...measurements),
      max: Math.max(...measurements),
      count: measurements.length,
    };
  }
}

// Throttle function for limiting function calls
export function throttle<T extends (...args: any[]) => any>(func: T, limit: number): T {
  let inThrottle: boolean;
  return ((...args: Parameters<T>): ReturnType<T> => {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
    return undefined as ReturnType<T>;
  }) as T;
}

// Batch processor for handling multiple operations efficiently
export class BatchProcessor<T> {
  private batch: T[] = [];
  private readonly batchSize: number;
  private readonly processFn: (items: T[]) => Promise<void>;
  private timeoutId: NodeJS.Timeout | null = null;
  private readonly flushDelay: number;

  constructor(batchSize: number, processFn: (items: T[]) => Promise<void>, flushDelay: number = 1000) {
    this.batchSize = batchSize;
    this.processFn = processFn;
    this.flushDelay = flushDelay;
  }

  add(item: T): void {
    this.batch.push(item);

    // Process immediately if batch is full
    if (this.batch.length >= this.batchSize) {
      this.flush();
      return;
    }

    // Schedule delayed processing
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
    }
    this.timeoutId = setTimeout(() => this.flush(), this.flushDelay);
  }

  async flush(): Promise<void> {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }

    if (this.batch.length === 0) return;

    const itemsToProcess = [...this.batch];
    this.batch = [];

    try {
      await this.processFn(itemsToProcess);
    } catch (error) {
      console.error("Error processing batch:", error);
      // Re-add items to batch for retry (optional)
      // this.batch.unshift(...itemsToProcess);
    }
  }

  destroy(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    this.batch = [];
  }
}

// Global performance optimization function
export const optimizePerformance = (): void => {
  // Enable performance monitoring
  const memoryMonitor = MemoryMonitor.getInstance();
  memoryMonitor.recordUsage();

  // Set up periodic memory monitoring
  const monitoringInterval = setInterval(() => {
    memoryMonitor.recordUsage();
  }, 5000);

  // Clean up after 5 minutes
  setTimeout(() => {
    clearInterval(monitoringInterval);
  }, 300000);

  console.log("🚀 Performance optimizations applied");
};