// Types for the library face (index.mjs). The renderers stay plain JavaScript; this file only describes the
// functions a TypeScript consumer calls.
export declare const DIAGRAM_TYPES: readonly ['architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle'];
export type DiagramType = (typeof DIAGRAM_TYPES)[number];

export interface DiagramDiagnostic {
  code: string;
  message: string;
  subject?: unknown;
  evidence?: unknown;
  supportedFixes?: unknown;
}

export declare class DiagramError extends Error {
  constructor(message: string, diagnostics?: DiagramDiagnostic[], stage?: 'input' | 'render' | 'check');
  diagnostics: DiagramDiagnostic[];
  stage: 'input' | 'render' | 'check';
}

export interface DiagramOptions {
  quality?: 'showcase' | 'standard';
  repoRoot?: string;
}

export interface DiagramParts {
  type: DiagramType;
  meta: { title?: string; note?: string; [key: string]: unknown };
  svg: string;
  cards: unknown;
  sourceEvidence: unknown;
}

export declare function renderDiagram(type: string, ir: unknown, options?: DiagramOptions): Promise<DiagramParts>;
export declare function layoutReport(type: string, ir: unknown, options?: DiagramOptions): Promise<unknown>;
export declare function checkDiagram(type: string, ir: unknown, options?: DiagramOptions): Promise<{
  ok: boolean;
  stage?: 'input' | 'render' | 'check';
  error?: string;
  diagnostics: DiagramDiagnostic[];
  checks: unknown[];
  composition: unknown;
}>;
export declare function diagramHtml(parts: Pick<DiagramParts, 'meta' | 'svg' | 'cards'> & { sourceEvidence?: unknown }): string;
