import { describe, expect, it } from 'vitest';

import { RingBuffer } from '../ringBuffer.js';

describe('RingBuffer', () => {
  it('push + replay returns items in insertion order', () => {
    const rb = new RingBuffer<string>(10);
    rb.push('a');
    rb.push('b');
    rb.push('c');
    expect(rb.replay()).toEqual(['a', 'b', 'c']);
  });

  it('replay returns an empty array on a fresh buffer', () => {
    const rb = new RingBuffer<number>(5);
    expect(rb.replay()).toEqual([]);
  });

  it('drops oldest items once capacity is exceeded', () => {
    const rb = new RingBuffer<number>(3);
    rb.push(1);
    rb.push(2);
    rb.push(3);
    rb.push(4); // evicts 1
    rb.push(5); // evicts 2
    expect(rb.replay()).toEqual([3, 4, 5]);
  });

  it('clear empties the buffer', () => {
    const rb = new RingBuffer<string>(5);
    rb.push('x');
    rb.push('y');
    rb.clear();
    expect(rb.replay()).toEqual([]);
  });

  it('size reports the current item count', () => {
    const rb = new RingBuffer<number>(3);
    expect(rb.size()).toEqual(0);
    rb.push(1);
    rb.push(2);
    expect(rb.size()).toEqual(2);
    rb.push(3);
    rb.push(4); // evicts 1, size still 3
    expect(rb.size()).toEqual(3);
    rb.clear();
    expect(rb.size()).toEqual(0);
  });

  it('replay returns a snapshot (mutating it does not affect the buffer)', () => {
    const rb = new RingBuffer<string>(3);
    rb.push('a');
    const out = rb.replay();
    out.push('mutated');
    expect(rb.replay()).toEqual(['a']);
  });
});
