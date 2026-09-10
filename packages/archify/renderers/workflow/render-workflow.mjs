import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDiagramWithBrandMarks, writeDiagram } from '../shared/cli.mjs';
import { throwDiagnosticError } from '../shared/diagnostics.mjs';
import { compileWorkflow } from './workflow-compiler.mjs';
import { isMainModule, qualityProfileOverride } from '../shared/render-context.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// @@@ library seam - compile a workflow IR: { ok, svg, receipt, diagnostics }. The quality profile comes from the
// render context (library) or the environment (CLI), never from both ([[archify]]).
export function compileWorkflowDiagram(workflow) {
  return compileWorkflow({
    workflow,
    qualityProfile: qualityProfileOverride() || workflow.meta?.quality_profile,
  });
}

if (isMainModule(import.meta.url)) {
  const { diagram: workflow, template, outPath } = await loadDiagramWithBrandMarks({
    rendererDir: __dirname,
    diagramType: 'workflow',
    defaultExample: 'agent-tool-call.workflow.json'
  });

  const compiled = compileWorkflowDiagram(workflow);

  const layoutJson = process.argv.includes('--layout-json');

  if (layoutJson) {
    process.stdout.write(`${JSON.stringify(compiled.receipt, null, 2)}\n`);
    if (!compiled.ok) process.exitCode = 1;
  } else if (!compiled.ok) {
    throwDiagnosticError(compiled.error || 'Workflow compilation failed.', compiled.diagnostics);
  } else {
    writeDiagram({
      outPath,
      template,
      diagramType: 'workflow',
      meta: workflow.meta,
      svg: compiled.svg,
      cards: workflow.cards,
    });
  }
}
