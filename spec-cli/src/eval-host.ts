import { setSessionEvalHost, type EvalHostPort } from '@spexcode/spec-eval/sessioneval'
import { setEvalRemarkTracks } from '@spexcode/spec-eval/host'
import { loadEvalRemarkTracks } from './issues.js'
import { reviewIdentity, reviewPayload } from './sessions.js'
import { loadConfig } from './lint.js'
import { trackedSourceFiles } from './source-files.js'
import { stripRefSigil } from './mentions.js'
import { commitTrunkData } from './localIssues.js'
import { setEvalHost } from '@spexcode/spec-eval/host'
import { apiBase } from './sessions.js'

let installed = false
export function installEvalHost(): void {
  if (installed) return
  installed = true
  setEvalRemarkTracks(loadEvalRemarkTracks)
  setEvalHost({ loadConfig, trackedSourceFiles, stripRefSigil, commitTrunkData, apiBase })
  setSessionEvalHost({ reviewIdentity, reviewPayload, loadEvalRemarkTracks, loadConfig, trackedSourceFiles, stripRefSigil, commitTrunkData, apiBase } satisfies EvalHostPort)
}
