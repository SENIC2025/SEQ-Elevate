/**
 * What a piece of work costs, for the link tests' time limits (Release 4,
 * verdict §7: at most 10 ms a text, 0.5 s a 1 MB save): the CPU time this
 * process spends on it, user and system (`process.cpuUsage()`), so the
 * load other processes put on a shared machine doesn't count. Vitest runs
 * each test file in a process of its own (its default pool, forks).
 *
 * A cost that grows with a text's length, not its square, is compared as a
 * ratio of two pieces of work: each is run once to warm up, then the two
 * in turn, and each is taken at the least of its rounds, so a pause in one
 * round (a collection, another process) never decides the answer.
 *
 * Not imported by the app.
 */

/** The CPU time `work` takes, in milliseconds. */
export function cpuMs(work: () => void): number {
  const before = process.cpuUsage();
  work();
  const used = process.cpuUsage(before);
  return (used.user + used.system) / 1_000;
}

/**
 * The least CPU time of each piece of work, in milliseconds, over `rounds`
 * rounds that run every piece once, in turn, after one round to warm up.
 */
export function leastCpuMs(works: readonly (() => void)[], rounds = 9): number[] {
  for (const work of works) work();
  const least = works.map(() => Infinity);
  for (let round = 0; round < rounds; round++) {
    works.forEach((work, i) => {
      least[i] = Math.min(least[i], cpuMs(work));
    });
  }
  return least;
}

/** How many times the CPU time of `long` is that of `short` (leastCpuMs of the two, run in turn). */
export function cpuRatio(long: () => void, short: () => void, rounds = 9): { long: number; short: number; ratio: number } {
  const [longMs, shortMs] = leastCpuMs([long, short], rounds);
  return { long: longMs, short: shortMs, ratio: longMs / shortMs };
}
