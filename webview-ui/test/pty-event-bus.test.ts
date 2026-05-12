import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PtyEventBus } from '../src/office/panel/ptyEventBus.ts';

test('PtyEventBus: emit/subscribe round-trip for ptyData', () => {
  const bus = new PtyEventBus();
  const received: string[] = [];
  bus.subscribe(5, 'ptyData', (data) => received.push(data));
  bus.emitData(5, 'hello');
  bus.emitData(5, 'world');
  assert.deepEqual(received, ['hello', 'world']);
});

test('PtyEventBus: subscriber for one agent does not receive another agent’s events', () => {
  const bus = new PtyEventBus();
  const a: string[] = [];
  const b: string[] = [];
  bus.subscribe(1, 'ptyData', (data) => a.push(data));
  bus.subscribe(2, 'ptyData', (data) => b.push(data));
  bus.emitData(1, 'for-1');
  bus.emitData(2, 'for-2');
  assert.deepEqual(a, ['for-1']);
  assert.deepEqual(b, ['for-2']);
});

test('PtyEventBus: subscribe returns dispose that detaches handler', () => {
  const bus = new PtyEventBus();
  const received: string[] = [];
  const sub = bus.subscribe(7, 'ptyData', (data) => received.push(data));
  bus.emitData(7, 'before');
  sub.dispose();
  bus.emitData(7, 'after');
  assert.deepEqual(received, ['before']);
});

test('PtyEventBus: multiple subscribers for same agent all receive events', () => {
  const bus = new PtyEventBus();
  const x: string[] = [];
  const y: string[] = [];
  bus.subscribe(3, 'ptyData', (d) => x.push(d));
  bus.subscribe(3, 'ptyData', (d) => y.push(d));
  bus.emitData(3, 'fanout');
  assert.deepEqual(x, ['fanout']);
  assert.deepEqual(y, ['fanout']);
});

test('PtyEventBus: emit to unknown agent is a no-op (no throw)', () => {
  const bus = new PtyEventBus();
  assert.doesNotThrow(() => bus.emitData(999, 'ignored'));
});

test('PtyEventBus: ptyExit event has its own subscriber list', () => {
  const bus = new PtyEventBus();
  const dataEvents: string[] = [];
  const exitEvents: Array<{ code: number; signal?: string }> = [];
  bus.subscribe(4, 'ptyData', (d) => dataEvents.push(d));
  bus.subscribe(4, 'ptyExit', (e) => exitEvents.push(e));
  bus.emitData(4, 'still alive');
  bus.emitExit(4, { code: 0 });
  assert.deepEqual(dataEvents, ['still alive']);
  assert.deepEqual(exitEvents, [{ code: 0 }]);
});

test('PtyEventBus: ptyScrollback event carries an array of lines', () => {
  const bus = new PtyEventBus();
  const received: string[][] = [];
  bus.subscribe(8, 'ptyScrollback', (lines) => received.push(lines));
  bus.emitScrollback(8, ['line1', 'line2']);
  assert.deepEqual(received, [['line1', 'line2']]);
});
