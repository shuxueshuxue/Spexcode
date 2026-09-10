import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

// @@@ render context - the one seam between the two ways this code runs ([[archify]]). A CLI renderer is its
// own process: bin/archify.mjs hands it options through the environment. The library runs many renders in one
// process and hands them over explicitly. Every option a renderer reads goes through here, so neither caller
// leaks into the other: the library never touches process.env, and the CLI never learns the library exists.
//
// A context is scoped to one SYNCHRONOUS call. Renderers are synchronous once their input is prepared, so no
// other render can interleave while a context is active; an async callback here would break that guarantee.
let active = null;

export function withRenderContext(context, callback) {
  const previous = active;
  active = context;
  try {
    const result = callback();
    if (result && typeof result.then === 'function') throw new Error('withRenderContext: the callback must be synchronous');
    return result;
  } finally {
    active = previous;
  }
}

// The requested quality profile: the active context's (authoritative even when absent), else the CLI's env.
export function qualityProfileOverride() {
  return active ? active.quality : process.env.ARCHIFY_QUALITY_PROFILE;
}

// True when this module file is the process's entry script — the CLI path. Both sides are real paths: Node
// resolves the entry module through symlinks, so a renderer reached through node_modules still matches.
export function isMainModule(metaUrl) {
  if (!process.argv[1]) return false;
  try {
    return pathToFileURL(fs.realpathSync(process.argv[1])).href === metaUrl;
  } catch {
    return false;
  }
}
