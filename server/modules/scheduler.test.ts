import { expect, test, setSystemTime } from 'bun:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDue, startScheduler } from './scheduler';

const job = { at: '02:30', catchUpMinutes: 1440, retry: { attempts: 3, delayMinutes: 5 } };
const last = { at: '2026-10-20T21:00:00Z', date: '2026-10-21', ok: false, ms: 1, attempts: 1 };
test('content planning catches up after a sleeping PC wakes in the morning', () => {
  expect(isDue(job, undefined, new Date('2026-10-21T03:30:00Z'))).toBe(true);
  expect(isDue({ at: '02:30' }, undefined, new Date('2026-10-21T03:30:00Z'))).toBe(false);
});
test('a failed daily plan retries with a delay and a bounded attempt count', () => {
  expect(isDue(job, last, new Date('2026-10-20T21:01:00Z'))).toBe(false);
  expect(isDue(job, last, new Date('2026-10-20T21:05:00Z'))).toBe(true);
  expect(isDue(job, { ...last, attempts: 3 }, new Date('2026-10-20T21:10:00Z'))).toBe(false);
  expect(isDue(job, { ...last, ok: true }, new Date('2026-10-20T21:10:00Z'))).toBe(false);
  expect(isDue(job, last, new Date('2026-10-21T21:00:00Z'))).toBe(true);
});

test('retry receipts survive a restart and a successful plan does not run twice', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aos-scheduler-'));
  let calls = 0;
  const deps = {
    dataDir: dir, log: () => {}, ctxFor: () => ({ ctx: {} as any, close: () => {} }),
    modules: [{ name: 'fixture', handle: async () => null, jobs: [{ id: 'plan', ...job, run: async () => { if (++calls === 1) throw new Error('synthetic database lock'); } }] }],
  };
  setSystemTime(new Date('2026-10-20T21:00:00Z'));
  let scheduler = startScheduler(deps);
  try {
    scheduler.tick();
    await Bun.sleep(10);
    expect(scheduler.runs()['fixture:plan']).toMatchObject({ ok: false, attempts: 1 });
    scheduler.stop();
    setSystemTime(new Date('2026-10-20T21:05:00Z'));
    scheduler = startScheduler(deps);
    scheduler.tick();
    await Bun.sleep(10);
    expect(scheduler.runs()['fixture:plan']).toMatchObject({ ok: true, attempts: 2 });
    scheduler.tick();
    await Bun.sleep(10);
    expect(calls).toBe(2);
    expect(JSON.parse(readFileSync(join(dir, 'mod', 'jobs.json'), 'utf8'))['fixture:plan'].ok).toBe(true);
  } finally { scheduler.stop(); setSystemTime(); }
});

// the night shift (work.ts: 23:00 IST, 180 minutes): the PC wakes after midnight and still runs the night's slot, once
test('a 23:00 job catches up across midnight and counts for the night it began', () => {
  const night = { at: '23:00', catchUpMinutes: 180 };
  // 00:40 IST on the 23rd is 19:10Z on the 22nd: 100 minutes after the 22nd's slot
  expect(isDue(night, undefined, new Date('2026-10-22T19:10:00Z'))).toBe(true);
  expect(isDue(night, { at: '2026-10-22T17:35:00Z', date: '2026-10-22', ok: true, ms: 1 }, new Date('2026-10-22T19:10:00Z'))).toBe(false);
  // last ran the night before: the 22nd's slot is still owed
  expect(isDue(night, { at: '2026-10-21T17:31:00Z', date: '2026-10-21', ok: true, ms: 1 }, new Date('2026-10-22T19:10:00Z'))).toBe(true);
  // 02:01 IST is 181 minutes late: past the window, the night is skipped
  expect(isDue(night, undefined, new Date('2026-10-22T20:31:00Z'))).toBe(false);
  // 22:59 IST: not yet (and not yesterday's slot, 1439 minutes late)
  expect(isDue(night, undefined, new Date('2026-10-22T17:29:00Z'))).toBe(false);
  // weekdays follow the slot: a Thursday-only 23:00 job caught up at 00:40 on Friday still runs
  expect(isDue({ ...night, days: ['thu'] }, undefined, new Date('2026-10-22T19:10:00Z'))).toBe(true);
  expect(isDue({ ...night, days: ['fri'] }, undefined, new Date('2026-10-22T19:10:00Z'))).toBe(false);
});

test('a run after midnight is recorded on the slot day, so the next tick does not repeat it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aos-scheduler-night-'));
  let calls = 0;
  const deps = {
    dataDir: dir, log: () => {}, ctxFor: () => ({ ctx: {} as any, close: () => {} }),
    modules: [{ name: 'work', handle: async () => null, jobs: [{ id: 'night-shift', at: '23:00', catchUpMinutes: 180, run: async () => { calls++; } }] }],
  };
  setSystemTime(new Date('2026-10-22T19:10:00Z'));   // 00:40 IST, 23 Oct
  const scheduler = startScheduler(deps);
  try {
    scheduler.tick();
    await Bun.sleep(10);
    expect(scheduler.runs()['work:night-shift']).toMatchObject({ ok: true, date: '2026-10-22' });
    setSystemTime(new Date('2026-10-22T19:11:00Z'));
    scheduler.tick();
    await Bun.sleep(10);
    expect(calls).toBe(1);
  } finally { scheduler.stop(); setSystemTime(); }
});
