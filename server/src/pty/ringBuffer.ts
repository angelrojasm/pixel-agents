/**
 * Bounded FIFO buffer used as a scrollback ring for pty output. Once `capacity`
 * is exceeded, the oldest item is evicted on each new push. `replay()` returns
 * a defensive copy in insertion order; mutating the returned array does not
 * affect the buffer.
 */
export class RingBuffer<T> {
  private items: T[] = [];

  constructor(private readonly capacity: number) {
    if (capacity <= 0) {
      throw new Error(`RingBuffer capacity must be positive (got ${capacity})`);
    }
  }

  push(item: T): void {
    this.items.push(item);
    if (this.items.length > this.capacity) {
      this.items.splice(0, this.items.length - this.capacity);
    }
  }

  replay(): T[] {
    return this.items.slice();
  }

  size(): number {
    return this.items.length;
  }

  clear(): void {
    this.items.length = 0;
  }
}
