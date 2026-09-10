// @spexcode/archify — the library face ([[archify]]). A diagram is rendered in-process: IR in, page parts out,
// diagnostics thrown as data. The CLI (bin/archify.mjs) and these functions share every step — the same
// preparation, the same renderer functions, the same page assembly, the same final-artifact check — so the
// two produce identical bytes; the difference is only that the CLI runs each step in its own process.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { diagramPage, loadTemplate, prepareDiagram } from './renderers/shared/cli.mjs';
import { prepareDiagramBrandMarks } from './renderers/shared/brand-marks.mjs';
import { withRenderContext } from './renderers/shared/render-context.mjs';
import { checkerDiagnostics } from './renderers/shared/artifact-diagnostics.mjs';
import { renderArchitecture } from './renderers/architecture/render-architecture.mjs';
import { compileWorkflowDiagram } from './renderers/workflow/render-workflow.mjs';
import { renderSequenceSvg } from './renderers/sequence/render-sequence.mjs';
import { renderDataflowSvg } from './renderers/dataflow/render-dataflow.mjs';
import { renderLifecycleSvg } from './renderers/lifecycle/render-lifecycle.mjs';
import { checkRenderOutput } from './scripts/check-render-output.mjs';

export const DIAGRAM_TYPES = Object.freeze(['architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle']);

// A diagram that cannot be drawn. `diagnostics` is the renderers' own vocabulary: code, message, subject,
// evidence, supportedFixes — the same entries the CLI prints in its receipts.
export class DiagramError extends Error {
  constructor(message, diagnostics = [], stage = 'render') {
    super(message);
    this.name = 'DiagramError';
    this.diagnostics = diagnostics;
    this.stage = stage;
  }
}

function assertType(type) {
  if (!DIAGRAM_TYPES.includes(type)) throw new DiagramError(`unknown diagram type ${JSON.stringify(type)}`, [], 'input');
}

// A renderer or preparation step signals a diagram problem by throwing an Error carrying `archifyDiagnostics`.
// Anything else is a bug and propagates unchanged.
function asDiagramError(error, stage) {
  if (Array.isArray(error?.archifyDiagnostics)) return new DiagramError(error.message, error.archifyDiagnostics, stage);
  return error;
}

// Validate, then lay out and draw, one IR. The IR is copied first: a renderer annotates the object it is given,
// and the CLI always starts from freshly parsed JSON.
async function prepared(type, ir, repoRoot) {
  assertType(type);
  const diagram = structuredClone(ir);
  let sourceEvidence;
  try {
    sourceEvidence = prepareDiagram(type, diagram, { repoRoot });
    await prepareDiagramBrandMarks(type, diagram);
  } catch (error) { throw asDiagramError(error, 'input'); }
  return { diagram, sourceEvidence };
}

function drawSvg(type, diagram) {
  if (type === 'architecture') return renderArchitecture(diagram).svg;
  if (type === 'sequence') return renderSequenceSvg(diagram);
  if (type === 'dataflow') return renderDataflowSvg(diagram);
  if (type === 'lifecycle') return renderLifecycleSvg(diagram);
  const compiled = compileWorkflowDiagram(diagram);
  if (!compiled.ok) throw new DiagramError(compiled.error || 'Workflow compilation failed.', compiled.diagnostics || [], 'render');
  return compiled.svg;
}

// Render one IR to its page parts. `quality` is 'showcase' or 'standard' (default: the IR's own
// meta.quality_profile); `repoRoot` enables and verifies revision-pinned source evidence (architecture).
export async function renderDiagram(type, ir, { quality, repoRoot } = {}) {
  const { diagram, sourceEvidence } = await prepared(type, ir, repoRoot);
  let svg;
  try {
    svg = withRenderContext({ quality }, () => drawSvg(type, diagram));
  } catch (error) { throw asDiagramError(error, 'render'); }
  return { type, meta: diagram.meta, svg, cards: diagram.cards, sourceEvidence: sourceEvidence ?? null };
}

// The layout receipt a cartographer repairs from (architecture and workflow only).
export async function layoutReport(type, ir, { quality, repoRoot } = {}) {
  if (type !== 'architecture' && type !== 'workflow') {
    throw new DiagramError('layout reports exist for architecture and workflow diagrams only', [], 'input');
  }
  const { diagram } = await prepared(type, ir, repoRoot);
  try {
    return withRenderContext({ quality }, () => (type === 'architecture'
      ? renderArchitecture(diagram, { layoutOnly: true }).layoutReport
      : compileWorkflowDiagram(diagram).receipt));
  } catch (error) { throw asDiagramError(error, 'render'); }
}

// Render and then run the final-artifact check, the way `archify validate` does. Never throws for a diagram
// problem: `ok` is false and `diagnostics` says why. The check judges the page by the quality profile the
// renderer wrote into it, so it runs with no override — exactly as the CLI's check process does.
export async function checkDiagram(type, ir, options = {}) {
  let parts;
  try {
    parts = await renderDiagram(type, ir, options);
  } catch (error) {
    if (!(error instanceof DiagramError)) throw error;
    return { ok: false, stage: error.stage, error: error.message, diagnostics: error.diagnostics, checks: [], composition: null };
  }
  const result = withRenderContext({ quality: undefined }, () => checkRenderOutput(diagramHtml(parts), null));
  return {
    ok: result.ok,
    ...(result.ok ? {} : { stage: 'check', error: 'Final artifact check failed.' }),
    diagnostics: result.ok ? [] : checkerDiagnostics(result),
    checks: result.checks,
    composition: result.composition,
  };
}

// ---- the viewer runtime, and the page ------------------------------------------------------------------
// The viewer is three blocks of the template: the embedded font face, the stylesheet, and the viewer script.
// None of them carries a translated string or a per-diagram slot (every {{i18n:…}} token and every ARCHIFY
// slot is in the markup), so one copy serves every page in every language. A page either carries them inline
// (a single self-contained file) or links a shared copy (a site of many diagrams downloads the viewer once).
const RUNTIME_BLOCKS = [
  { key: 'fonts', ext: 'css', pattern: /<style id="archify-fonts">\n?([\s\S]*?)<\/style>/ },
  { key: 'viewer', ext: 'css', pattern: /<style>\n?([\s\S]*?)<\/style>/ },
  { key: 'viewer', ext: 'js', pattern: /<script>\n?(\s*var Archify = \{\};[\s\S]*?)<\/script>/ },
];
let runtime = null;
function runtimeParts() {
  if (runtime) return runtime;
  const template = loadTemplate();
  const blocks = RUNTIME_BLOCKS.map((block) => {
    const matches = [...template.matchAll(new RegExp(block.pattern.source, 'g'))];
    if (matches.length !== 1) throw new Error(`archify runtime: expected one ${block.key}.${block.ext} block in the template, found ${matches.length}`);
    const [whole, content] = matches[0];
    const hash = createHash('sha256').update(content).digest('hex').slice(0, 10);
    return { ...block, whole, content, name: `archify-${block.key}.${hash}.${block.ext}` };
  });
  runtime = { template, blocks };
  return runtime;
}

// The shared runtime's files: [{ name, content }]. Names carry a content hash, so a cache never serves a stale viewer.
export function runtimeAssets() {
  return runtimeParts().blocks.map(({ name, content }) => ({ name, content }));
}

// Write the runtime into `dir` (idempotent: an existing file with the same name has the same bytes).
export function writeRuntime(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const names = [];
  for (const { name, content } of runtimeAssets()) {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) fs.writeFileSync(file, content);
    names.push(name);
  }
  return names;
}

const linkedTemplates = new Map();
function linkedTemplate(base) {
  if (linkedTemplates.has(base)) return linkedTemplates.get(base);
  const { template, blocks } = runtimeParts();
  const href = (name) => `${base.replace(/\/+$/, '')}/${name}`;
  let linked = template;
  for (const block of blocks) {
    const tag = block.ext === 'css'
      ? `<link rel="stylesheet" href="${href(block.name)}">`
      : `<script src="${href(block.name)}"></script>`;
    linked = linked.replace(block.whole, () => tag);
  }
  linkedTemplates.set(base, linked);
  return linked;
}

// One diagram's page. `runtime: 'inline'` (default) is a self-contained file — identical to what the CLI
// delivers; `runtime: { base }` links the shared runtime at `base` (a URL path relative to the page, or absolute).
export function diagramHtml({ meta, svg, cards, sourceEvidence = null }, { runtime: mode = 'inline' } = {}) {
  const template = mode === 'inline' ? loadTemplate() : linkedTemplate(mode.base);
  return diagramPage({ template, meta, svg, cards, sourceEvidence });
}
