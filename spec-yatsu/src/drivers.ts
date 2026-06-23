import { readFileSync } from 'node:fs'
import type { Scenario } from './yatsu.js'

// @@@ Driver - a PRODUCER of readings: the interchangeable thing that reads a scenario's live state.
// A human eyeballing, a backend call, or a future computer-use "stupid user" are all the same shape — the
// engine (eval/scan/clean) never names a concrete one. The core ships ONLY the manual producer; another
// producer slots in by registering here, with NO change to eval. (Scripted browser drivers are deliberately
// off the roadmap: the ledger + manual/computer-use producer is the capture story, not Playwright/WebDriver.)
//
// `version` is the EVALUATOR freshness axis: it is recorded on every reading as `<name>@<version>`, and
// bumping it marks every reading the driver produced stale (the measuring instrument changed, so re-read).
export interface Driver {
  name: string
  version: number
  // capture the scenario's current state → the bytes to store as the reading's blob, or null (a pixel-less
  // observation). A browser driver returns screenshot bytes here; the manual driver returns a provided image
  // (or null when none is given), which is what makes the whole loop runnable with no browser.
  capture(scenario: Scenario, opts: CaptureOpts): Promise<Buffer | null>
}

export type CaptureOpts = { image?: string }   // a human-provided image path (the manual loop)

// the reading's `evaluator` tag — `<name>@<version>`. freshness compares a reading's tag to this.
export function evaluatorTag(d: Driver): string {
  return `${d.name}@${d.version}`
}

// parse a recorded evaluator tag back into name + version (for comparing against the live driver).
export function parseEvaluator(tag: string): { name: string; version: number } {
  const at = tag.lastIndexOf('@')
  if (at < 0) return { name: tag, version: NaN }
  return { name: tag.slice(0, at), version: Number(tag.slice(at + 1)) }
}

// @@@ manual driver - the default, browser-free producer: a human (or any out-of-band process) observed
// the surface. With `--image` it stores the provided file as the reading's blob; without one it records a
// pixel-less observation (blob null). This is the [[spec-forge]]-shaped "human eyeballing" producer that
// lets `spex yatsu eval` close the loop today, before any driver exists. Bump `version` if the manual
// contract itself changes (what a manual reading attests to).
export const manualDriver: Driver = {
  name: 'manual',
  version: 1,
  async capture(_scenario, opts) {
    return opts.image ? readFileSync(opts.image) : null
  },
}

// @@@ driver registry - selecting a producer goes THROUGH this list keyed by `name`, never a hardcoded
// branch (the [[forge-cli]] driver-registry shape). A scenario's `driver` field is a lookup here; a future
// producer (a computer-use "stupid user") slots in by adding itself here, with NO change to eval. The core
// ships only the manual producer. An unregistered name still resolves to undefined so eval skips it loudly
// rather than crash.
const DRIVERS: Driver[] = [manualDriver]
export const DEFAULT_DRIVER = manualDriver.name

export function driverFor(name: string | undefined): Driver | undefined {
  return DRIVERS.find((d) => d.name === (name || DEFAULT_DRIVER))
}
