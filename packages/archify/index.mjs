// @spexcode/archify — the library face ([[archify]]). A diagram is rendered in-process: IR in, SVG and page parts
// out, diagnostics thrown as data. The CLI (bin/archify.mjs) and these functions share every step — the same
// preparation, the same renderer functions, the same page assembly, the same final-artifact check — so the
// two produce identical bytes; the difference is only that the CLI runs each step in its own process.
// The browser half is separate and imports nothing from here: assets/diagram.css and browser.mjs.
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
// @@@evidence - an architecture IR may cite its sources (components[].sources, pinned by meta.repository), and
// archify then refuses to render until it has verified them in a repository: origin matching the declared URL,
// the pinned commit present, each file there. That feeds the delivered page's source beacons; the SVG itself
// does not carry evidence (measured: byte-identical with it verified or dropped). `evidence: false` drops it from
// the copy, so a reader that wants only the picture needs no repository and reads no git.
async function prepared(type, ir, repoRoot, evidence) {
  assertType(type);
  const diagram = structuredClone(ir);
  if (!evidence) {
    if (diagram.meta) delete diagram.meta.repository;
    for (const component of Array.isArray(diagram.components) ? diagram.components : []) delete component?.sources;
  }
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
// meta.quality_profile); `repoRoot` enables and verifies revision-pinned source evidence (architecture);
// `evidence: false` draws without it (see above) and returns sourceEvidence null.
export async function renderDiagram(type, ir, { quality, repoRoot, evidence = true } = {}) {
  const { diagram, sourceEvidence } = await prepared(type, ir, repoRoot, evidence);
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
  const { diagram } = await prepared(type, ir, repoRoot, true);
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

// One diagram's self-contained page — the exact file `archify render` delivers (viewer, font, cards, note). The
// final-artifact check reads this page; a host that shows diagrams inline uses the svg with assets/diagram.css.
export function diagramHtml({ meta, svg, cards, sourceEvidence = null }) {
  return diagramPage({ template: loadTemplate(), meta, svg, cards, sourceEvidence });
}
