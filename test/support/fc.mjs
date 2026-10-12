// fast-check settings shared by every property: NUM_RUNS and FC_SEED from the
// environment, the seed always printed so any failure replays with
//   FC_SEED=<seed> [FC_PATH=<path>] node --test <file>
import fc from 'fast-check';

export const NUM_RUNS = Number(process.env.NUM_RUNS ?? 1000);
const seed = process.env.FC_SEED !== undefined ? Number(process.env.FC_SEED) : (Date.now() ^ (Math.random() * 0x100000000)) | 0;

export function fcOptions(name, overrides = {}) {
  const options = { numRuns: NUM_RUNS, seed, verbose: 1, ...overrides };
  if (process.env.FC_PATH) options.path = process.env.FC_PATH;
  console.log(`[fc] ${name}: seed=${options.seed} numRuns=${options.numRuns}${options.path ? ` path=${options.path}` : ''}`);
  return options;
}

export { fc };
