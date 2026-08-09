import { sourceIndexesFull } from './git.js'
import { loadSpecs } from './specs.js'

export async function readSpecs(root: string) {
  const [history, drift] = await sourceIndexesFull(root)
  return loadSpecs(root, { history, drift })
}

export * from './anchors.js'
export * from './git.js'
export * from './graph.js'
export * from './harness-identity.js'
export * from './layout.js'
export * from './process-identity.js'
export * from './project-identity.js'
export * from './project-store.js'
export * from './resilience.js'
export * from './reviewSnapshot.js'
export * from './root-lru.js'
export * from './specs.js'
