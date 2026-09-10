#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkerDiagnostics, diagnostic } from '../renderers/shared/artifact-diagnostics.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');

const TYPES = new Set(['architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle']);

function usage() {
  return `Usage:
  archify render <type> <input.json> [output.html] [--quality standard|showcase] [--repo-root path (architecture only)]
  archify deliver <type> <input.json> [output.html] [--json] [--open] [--quality standard|showcase] [--repo-root path (architecture only)]
  archify validate <type> <input.json> [--json] [--layout-json] [--quality standard|showcase] [--repo-root path (architecture only)]
  archify migrate workflow <old.json> <new.json> --to-schema 2 [--json]
  archify inspect <type> <input.json>
  archify check <output.html>
  archify doctor

Types:
  architecture, workflow, sequence, dataflow, lifecycle
`;
}

function fail(message, code = 2) {
  console.error(message);
  process.exit(code);
}

function rejectCliArgument(message, details = {}) {
  const error = new Error(message);
  error.archifyArgument = {
    code: details.code || 'cli/invalid-arguments',
    subject: details.subject || {},
    evidence: details.evidence || {},
    supportedFixes: details.supportedFixes || ['correct the command arguments and retry'],
  };
  throw error;
}

function rendererPath(type) {
  if (!TYPES.has(type)) {
    rejectCliArgument(`Unknown diagram type "${type}". Expected one of: ${[...TYPES].join(', ')}`, {
      code: 'cli/unknown-diagram-type',
      subject: { type },
      evidence: { supportedTypes: [...TYPES] },
      supportedFixes: [`use one of: ${[...TYPES].join(', ')}`],
    });
  }
  return path.join(skillRoot, 'renderers', type, `render-${type}.mjs`);
}

function runNode(args, options = {}) {
  return spawnSync(process.execPath, args, {
    cwd: options.cwd || process.cwd(),
    encoding: 'utf8',
    stdio: options.stdio || 'inherit',
    env: options.env ? { ...process.env, ...options.env } : process.env,
  });
}

function extractQualityArgs(args) {
  const rest = [];
  let quality;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--quality') {
      quality = args[index + 1];
      if (!quality || quality.startsWith('--')) rejectCliArgument('--quality requires standard or showcase.', {
        code: 'cli/missing-option-value',
        subject: { option: '--quality' },
        supportedFixes: ['provide --quality standard or --quality showcase'],
      });
      index += 1;
      continue;
    }
    if (arg.startsWith('--quality=')) {
      quality = arg.slice('--quality='.length);
      if (!quality) rejectCliArgument('--quality requires standard or showcase.', {
        code: 'cli/missing-option-value',
        subject: { option: '--quality' },
        supportedFixes: ['provide --quality standard or --quality showcase'],
      });
      continue;
    }
    rest.push(arg);
  }
  if (quality !== undefined && !['standard', 'showcase'].includes(quality)) {
    rejectCliArgument(`Unknown quality profile "${quality}". Expected standard or showcase.`, {
      code: 'cli/invalid-option-value',
      subject: { option: '--quality' },
      evidence: { value: quality, supportedValues: ['standard', 'showcase'] },
      supportedFixes: ['use --quality standard or --quality showcase'],
    });
  }
  return { rest, quality };
}

function extractRepoRootArgs(args) {
  const rest = [];
  let repoRoot;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--repo-root') {
      repoRoot = args[index + 1];
      if (!repoRoot || repoRoot.startsWith('--')) rejectCliArgument('--repo-root requires a repository path.', {
        code: 'cli/missing-option-value',
        subject: { option: '--repo-root' },
        supportedFixes: ['provide one repository path after --repo-root'],
      });
      index += 1;
      continue;
    }
    if (arg.startsWith('--repo-root=')) {
      repoRoot = arg.slice('--repo-root='.length);
      if (!repoRoot) rejectCliArgument('--repo-root requires a repository path.', {
        code: 'cli/missing-option-value',
        subject: { option: '--repo-root' },
        supportedFixes: ['provide one repository path after --repo-root'],
      });
      continue;
    }
    rest.push(arg);
  }
  return { rest, repoRoot: repoRoot ? path.resolve(repoRoot) : undefined };
}

function rendererEnv(quality, repoRoot, diagnosticJson = false) {
  return {
    ...(quality ? { ARCHIFY_QUALITY_PROFILE: quality } : {}),
    ...(repoRoot ? { ARCHIFY_REPO_ROOT: repoRoot } : {}),
    ...(diagnosticJson ? { ARCHIFY_DIAGNOSTIC_FORMAT: 'json' } : {}),
  };
}

function inputDiagnostic(error, inputPath) {
  const isSyntax = error instanceof SyntaxError;
  return diagnostic({
    code: isSyntax ? 'input/json-parse' : 'input/read',
    message: isSyntax
      ? `Input JSON could not be parsed: ${error.message}`
      : `Input could not be read: ${error.message}`,
    subject: { input: inputPath },
    evidence: {
      ...(error?.code ? { systemCode: error.code } : {}),
      reason: error.message,
    },
    supportedFixes: [isSyntax
      ? 'repair the JSON syntax and run validation again'
      : 'provide one readable JSON input file'],
  });
}

function rendererFailure(result) {
  if (result.error) {
    return {
      error: 'Renderer process could not start.',
      diagnostics: [diagnostic({
        code: 'internal/renderer-process',
        message: 'Renderer process could not start.',
        evidence: { reason: result.error.message },
      })],
    };
  }
  try {
    const payload = JSON.parse((result.stderr || '').trim());
    if (payload?.ok === false && Array.isArray(payload.diagnostics) && payload.diagnostics.length) {
      return {
        error: payload.error || payload.diagnostics[0].message,
        diagnostics: payload.diagnostics,
      };
    }
  } catch {
    // The diagnostic boundary is intentionally fail-closed. Never copy a raw
    // Node stack into a machine receipt when a renderer exits unexpectedly.
  }
  return {
    error: 'Renderer failed before emitting a structured diagnostic.',
    diagnostics: [diagnostic({
      code: 'internal/unclassified',
      message: 'Renderer failed before emitting a structured diagnostic.',
      evidence: { exitCode: result.status ?? 1 },
    })],
  };
}

function formatDiagnostics(error, diagnostics = []) {
  if (!diagnostics.length) return error;
  return [
    error,
    ...diagnostics.map((entry) => {
      const fix = entry.supportedFixes?.length ? ` Fix: ${entry.supportedFixes.join('; ')}.` : '';
      return `[${entry.code}] ${entry.message}${fix}`;
    }),
  ].join('\n');
}

function assertEvidenceType(type, repoRoot) {
  if (repoRoot && type !== 'architecture') {
    rejectCliArgument('--repo-root is currently supported for architecture diagrams only.', {
      code: 'cli/unsupported-option',
      subject: { option: '--repo-root', type },
      supportedFixes: ['remove --repo-root or use an architecture diagram'],
    });
  }
}

function exitFrom(result) {
  if (result.error) fail(result.error.message, 1);
  process.exit(result.status ?? 1);
}

function commandRender(args) {
  const qualityArgs = extractQualityArgs(args);
  const repoArgs = extractRepoRootArgs(qualityArgs.rest);
  // render takes no options of its own once --quality and --repo-root are
  // stripped, so anything left starting with -- is a typo. Without this a
  // mistyped flag was taken as the output path: `render architecture spec.json
  // --json out.html` wrote a file literally named `--json` and never wrote
  // out.html, exiting 0. Every sibling subcommand already guards this.
  const unknown = repoArgs.rest.filter((arg) => arg.startsWith('--'));
  if (unknown.length) fail(`Unknown render option "${unknown[0]}".`);
  const [type, input, output] = repoArgs.rest;
  if (!type || !input || repoArgs.rest.length > 3) fail(usage());
  assertEvidenceType(type, repoArgs.repoRoot);
  const result = runNode([rendererPath(type), input, ...(output ? [output] : [])], {
    env: rendererEnv(qualityArgs.quality, repoArgs.repoRoot),
  });
  if (result.status !== 0) exitFrom(result);
}

function reportArtifactFailure({ command, json, stage, type, input, output, error, diagnostics = [], status = 1, checker }) {
  const receipt = {
    schemaVersion: 1,
    ok: false,
    command,
    stage,
    type,
    input,
    ...(output === undefined ? {} : { output }),
    error,
    diagnostics,
    ...(checker ? { checker } : {}),
  };
  if (json) console.log(JSON.stringify(receipt, null, 2));
  else console.error(formatDiagnostics(error, diagnostics));
  process.exitCode = status;
}

function reportDeliveryFailure(options) {
  reportArtifactFailure({ ...options, command: 'deliver' });
}

function reportValidateFailure(options) {
  reportArtifactFailure({ ...options, command: 'validate' });
}

function reportArtifactArgumentFailure(command, error) {
  const details = error.archifyArgument || {};
  reportArtifactFailure({
    command,
    json: true,
    stage: 'arguments',
    error: error.message,
    diagnostics: [diagnostic({
      code: details.code || 'cli/invalid-arguments',
      message: error.message,
      subject: { command, ...(details.subject || {}) },
      evidence: details.evidence || {},
      supportedFixes: details.supportedFixes || ['correct the command arguments and retry'],
    })],
    status: 2,
  });
}

function sourceEvidenceFromArtifact(artifact) {
  const html = artifact.toString('utf8');
  const match = html.match(/<script id="archify-source-evidence-data" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) return null;
  const evidence = JSON.parse(match[1]);
  if (evidence?.verified !== true || !evidence.repository?.url || !evidence.repository?.revision || !Number.isInteger(evidence.referenceCount)) {
    throw new Error('Rendered source evidence receipt is incomplete.');
  }
  return evidence;
}

function engineeringProfileFromArtifact(artifact) {
  const match = artifact.toString('utf8').match(/<svg[^>]*\sdata-engineering-profile="([^"]+)"/);
  return match ? match[1] : null;
}

async function commandDeliver(args) {
  const qualityArgs = extractQualityArgs(args);
  const repoArgs = extractRepoRootArgs(qualityArgs.rest);
  const json = repoArgs.rest.includes('--json');
  const open = repoArgs.rest.includes('--open');
  const knownOptions = new Set(['--json', '--open']);
  const unknown = repoArgs.rest.filter((arg) => arg.startsWith('--') && !knownOptions.has(arg));
  if (unknown.length) rejectCliArgument(`Unknown deliver option "${unknown[0]}".`, {
    code: 'cli/unknown-option',
    subject: { option: unknown[0] },
    supportedFixes: ['remove the unknown option and retry'],
  });
  const positional = repoArgs.rest.filter((arg) => !knownOptions.has(arg));
  const [type, input, requestedOutput] = positional;
  if (!type || !input || positional.length > 3) rejectCliArgument(usage(), {
    code: 'cli/usage',
    supportedFixes: ['use: archify deliver <type> <input.json> [output.html] [options]'],
  });
  assertEvidenceType(type, repoArgs.repoRoot);
  const renderer = rendererPath(type);
  const { resolveOutputPath } = await import('../renderers/shared/output-path.mjs');
  const inputPath = path.resolve(input);
  let specification;
  let diagram;
  try {
    specification = fs.readFileSync(inputPath);
    diagram = JSON.parse(specification.toString('utf8'));
  } catch (error) {
    const repair = inputDiagnostic(error, inputPath);
    reportDeliveryFailure({
      json,
      stage: 'input',
      type,
      input: inputPath,
      output: path.resolve(requestedOutput || `${type}.html`),
      error: `Could not read delivery input "${inputPath}": ${error.message}`,
      diagnostics: [repair],
    });
    return;
  }

  const authoredOutput = typeof diagram?.meta?.output === 'string' && diagram.meta.output
    ? diagram.meta.output
    : undefined;
  let outputPath;
  try {
    ({ outputPath } = resolveOutputPath({
      requestedOutput,
      authoredOutput,
      defaultOutput: `${type}.html`,
      inputPaths: [inputPath],
    }));
  } catch (error) {
    const attemptedOutput = path.resolve(requestedOutput || authoredOutput || `${type}.html`);
    reportDeliveryFailure({
      json,
      stage: 'prepare',
      type,
      input: inputPath,
      output: attemptedOutput,
      error: error.message,
      diagnostics: error.archifyDiagnostics || [diagnostic({
        code: 'output/path-resolution',
        message: error.message,
        subject: { output: attemptedOutput },
        evidence: { ...(error?.code ? { systemCode: error.code } : {}) },
        supportedFixes: ['choose a safe output path and retry'],
      })],
    });
    return;
  }
  const outputDirectory = path.dirname(outputPath);
  try {
    fs.mkdirSync(outputDirectory, { recursive: true });
  } catch (error) {
    const message = `Could not create delivery directory "${outputDirectory}": ${error.message}`;
    reportDeliveryFailure({
      json,
      stage: 'prepare',
      type,
      input: inputPath,
      output: outputPath,
      error: message,
      diagnostics: [diagnostic({
        code: 'delivery/prepare-directory',
        message,
        subject: { outputDirectory },
        evidence: { ...(error?.code ? { systemCode: error.code } : {}), reason: error.message },
        supportedFixes: ['choose a writable output directory'],
      })],
    });
    return;
  }

  // Keep the candidate beside the target so the final rename is one
  // same-filesystem commit. A render or artifact-check failure never touches
  // an existing trusted output.
  let stagingDirectory;
  try {
    stagingDirectory = fs.mkdtempSync(path.join(outputDirectory, '.archify-delivery-'));
  } catch (error) {
    const message = `Could not create a delivery candidate beside "${outputPath}": ${error.message}`;
    reportDeliveryFailure({
      json,
      stage: 'prepare',
      type,
      input: inputPath,
      output: outputPath,
      error: message,
      diagnostics: [diagnostic({
        code: 'delivery/prepare-candidate',
        message,
        subject: { output: outputPath },
        evidence: { ...(error?.code ? { systemCode: error.code } : {}), reason: error.message },
        supportedFixes: ['choose a writable output directory on the target filesystem'],
      })],
    });
    return;
  }
  const candidatePath = path.join(stagingDirectory, path.basename(outputPath));
  const specificationSnapshotPath = path.join(stagingDirectory, 'specification.snapshot.json');

  try {
    try {
      fs.writeFileSync(specificationSnapshotPath, specification, { flag: 'wx' });
    } catch (error) {
      const message = `Could not freeze the delivery specification: ${error.message}`;
      reportDeliveryFailure({
        json,
        stage: 'prepare',
        type,
        input: inputPath,
        output: outputPath,
        error: message,
        diagnostics: [diagnostic({
          code: 'delivery/freeze-specification',
          message,
          subject: { input: inputPath },
          evidence: { ...(error?.code ? { systemCode: error.code } : {}), reason: error.message },
          supportedFixes: ['choose a writable output directory on the target filesystem'],
        })],
      });
      return;
    }

    const render = runNode([renderer, specificationSnapshotPath, candidatePath], {
      stdio: 'pipe',
      env: rendererEnv(qualityArgs.quality, repoArgs.repoRoot, true),
    });
    if (render.status !== 0) {
      const failure = rendererFailure(render);
      reportDeliveryFailure({
        json,
        stage: 'render',
        type,
        input: inputPath,
        output: outputPath,
        error: failure.error,
        diagnostics: failure.diagnostics,
        status: render.status ?? 1,
      });
      return;
    }

    const check = runNode([path.join(skillRoot, 'scripts/check-render-output.mjs'), candidatePath], {
      stdio: 'pipe',
    });
    if (check.status !== 0) {
      if (check.stderr) process.stderr.write(check.stderr);
      let checker;
      try {
        checker = JSON.parse(check.stdout);
        checker.file = outputPath;
      } catch {
        checker = { ok: false, file: outputPath, diagnostic: check.stdout.trim() };
      }
      reportDeliveryFailure({
        json,
        stage: 'check',
        type,
        input: inputPath,
        output: outputPath,
        error: 'Final artifact check failed; the previous artifact was preserved.',
        diagnostics: checkerDiagnostics(checker),
        status: check.status ?? 1,
        checker,
      });
      return;
    }

    let result;
    try {
      result = JSON.parse(check.stdout);
    } catch (error) {
      const message = `Could not parse the successful artifact-check receipt: ${error.message}`;
      reportDeliveryFailure({
        json,
        stage: 'receipt',
        type,
        input: inputPath,
        output: outputPath,
        error: message,
        diagnostics: [diagnostic({
          code: 'delivery/receipt-invalid',
          message,
          subject: { output: outputPath },
          evidence: { reason: error.message },
        })],
      });
      return;
    }
    let artifact;
    try {
      artifact = fs.readFileSync(candidatePath);
    } catch (error) {
      const message = `Could not read the verified delivery candidate: ${error.message}`;
      reportDeliveryFailure({
        json,
        stage: 'receipt',
        type,
        input: inputPath,
        output: outputPath,
        error: message,
        diagnostics: [diagnostic({
          code: 'delivery/candidate-unreadable',
          message,
          subject: { output: outputPath },
          evidence: { ...(error?.code ? { systemCode: error.code } : {}), reason: error.message },
        })],
      });
      return;
    }
    let sourceEvidence;
    try {
      sourceEvidence = sourceEvidenceFromArtifact(artifact);
    } catch (error) {
      const message = `Could not read the repository evidence receipt: ${error.message}`;
      reportDeliveryFailure({
        json,
        stage: 'receipt',
        type,
        input: inputPath,
        output: outputPath,
        error: message,
        diagnostics: [diagnostic({
          code: 'delivery/evidence-receipt-invalid',
          message,
          subject: { output: outputPath },
          evidence: { reason: error.message },
        })],
      });
      return;
    }
    const engineeringProfile = engineeringProfileFromArtifact(artifact);
    const receipt = {
      schemaVersion: 1,
      ok: true,
      command: 'deliver',
      type,
      input: inputPath,
      output: outputPath,
      specification: {
        sha256: createHash('sha256').update(specification).digest('hex'),
        bytes: specification.byteLength,
      },
      artifact: {
        sha256: createHash('sha256').update(artifact).digest('hex'),
        bytes: artifact.byteLength,
      },
      validation: {
        checksPassed: result.checks.filter((checkItem) => checkItem.ok).length,
        checkCount: result.checks.length,
        compositionProfile: result.composition.profile,
        compositionStatus: result.composition.status,
        ...(engineeringProfile ? { engineeringProfile } : {}),
        errors: result.composition.summary.errors,
        warnings: result.composition.summary.warnings,
      },
      ...(sourceEvidence ? {
        evidence: {
          verified: true,
          repository: sourceEvidence.repository.url,
          revision: sourceEvidence.repository.revision,
          references: sourceEvidence.referenceCount,
          ...(sourceEvidence.repository.linkMode ? { linkMode: sourceEvidence.repository.linkMode } : {}),
        },
      } : {}),
    };

    try {
      resolveOutputPath({
        requestedOutput,
        authoredOutput,
        defaultOutput: `${type}.html`,
        inputPaths: [inputPath],
      });
    } catch (error) {
      reportDeliveryFailure({
        json,
        stage: 'commit',
        type,
        input: inputPath,
        output: outputPath,
        error: error.message,
        diagnostics: error.archifyDiagnostics || [diagnostic({
          code: 'output/path-resolution',
          message: error.message,
          subject: { output: outputPath },
          evidence: { ...(error?.code ? { systemCode: error.code } : {}) },
          supportedFixes: ['restore a safe output path and retry'],
        })],
      });
      return;
    }

    try {
      fs.renameSync(candidatePath, outputPath);
    } catch (error) {
      const message = `Could not commit verified delivery "${outputPath}": ${error.message}`;
      reportDeliveryFailure({
        json,
        stage: 'commit',
        type,
        input: inputPath,
        output: outputPath,
        error: message,
        diagnostics: [diagnostic({
          code: 'delivery/commit',
          message,
          subject: { output: outputPath },
          evidence: { ...(error?.code ? { systemCode: error.code } : {}), reason: error.message },
          supportedFixes: ['choose a replaceable file target on the same writable filesystem'],
        })],
      });
      return;
    }

    if (open) {
      try {
        const { openArtifact } = await import('./open-artifact.mjs');
        receipt.open = openArtifact(outputPath);
      } catch {
        receipt.open = {
          requested: true,
          status: 'unsupported',
          target: outputPath,
          method: null,
        };
      }
      if (receipt.open.status !== 'opened') {
        console.error(`Could not open the verified artifact (${receipt.open.status}). Open it manually: ${outputPath}`);
      }
    }

    if (json) {
      console.log(JSON.stringify(receipt, null, 2));
    } else {
      console.log(`delivered ${type} ${outputPath}`);
      const engineering = receipt.validation.engineeringProfile
        ? `; engineering ${receipt.validation.engineeringProfile}: pass`
        : '';
      console.log(`${receipt.validation.checksPassed}/${receipt.validation.checkCount} artifact checks; composition ${receipt.validation.compositionProfile}: ${receipt.validation.compositionStatus}${engineering}; sha256 ${receipt.artifact.sha256.slice(0, 12)}`);
      if (receipt.open?.status === 'opened') console.log(`opened ${outputPath}`);
    }
  } finally {
    try {
      fs.rmSync(stagingDirectory, { recursive: true, force: true });
    } catch (error) {
      console.error(`Warning: could not remove delivery staging directory "${stagingDirectory}": ${error.message}`);
    }
  }
}

function commandCheck(args) {
  const [html] = args;
  if (!html) fail(usage());
  const result = runNode([path.join(skillRoot, 'scripts/check-render-output.mjs'), html]);
  if (result.status !== 0) exitFrom(result);
}

async function commandDoctor() {
  const checks = [];
  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
  checks.push({
    label: `Node.js v${process.versions.node} (requires >=18)`,
    ok: nodeMajor >= 18,
    missing: 0,
    failureLabel: 'unsupported',
  });

  const template = path.join(skillRoot, 'assets/template.html');
  checks.push({
    label: 'Core template',
    ok: fs.existsSync(template),
    missing: fs.existsSync(template) ? 0 : 1,
  });




  const outputPathRuntime = path.join(skillRoot, 'renderers/shared/output-path.mjs');
  checks.push({
    label: 'Output path safety runtime',
    ok: fs.existsSync(outputPathRuntime),
    missing: fs.existsSync(outputPathRuntime) ? 0 : 1,
  });




  const validators = path.join(skillRoot, 'renderers/shared/generated-validators.mjs');
  const validatorsExist = fs.existsSync(validators);
  let validatorsValid = false;
  if (validatorsExist) {
    try {
      const module = await import(`${pathToFileURL(validators).href}?doctor=${Date.now()}`);
      validatorsValid = [...TYPES].every((type) => typeof module[type] === 'function');
    } catch {
      validatorsValid = false;
    }
  }
  checks.push({
    label: 'Standalone schema validators',
    ok: validatorsValid,
    missing: validatorsExist ? 0 : 1,
    invalid: validatorsExist && !validatorsValid ? 1 : 0,
    failureLabel: validatorsExist ? 'invalid' : 'missing',
  });

  const examples = {
    architecture: 'web-app.architecture.json',
    workflow: 'agent-tool-call.workflow.json',
    sequence: 'cache-miss-request.sequence.json',
    dataflow: 'product-analytics.dataflow.json',
    lifecycle: 'agent-run.lifecycle.json',
  };

  for (const type of TYPES) {
    const required = [
      path.join(skillRoot, 'renderers', type, `render-${type}.mjs`),
      path.join(skillRoot, 'schemas', `${type}.schema.json`),
      path.join(skillRoot, 'examples', examples[type]),
    ];
    const missing = required.filter((file) => !fs.existsSync(file)).length;
    checks.push({
      label: `${type} renderer, schema, and example`,
      ok: missing === 0,
      missing,
    });
  }

  console.log('Archify doctor\n');
  for (const check of checks) {
    console.log(`[${check.ok ? 'ok' : (check.failureLabel || 'missing')}] ${check.label}`);
  }

  const nodeFailed = checks[0].ok ? 0 : 1;
  const missingFiles = checks.reduce((count, check) => count + check.missing, 0);
  const invalidRuntime = checks.reduce((count, check) => count + (check.invalid || 0), 0);
  if (nodeFailed === 0 && missingFiles === 0 && invalidRuntime === 0) {
    console.log('\nArchify is ready.');
    return;
  }

  const problems = [];
  if (nodeFailed) problems.push('Node.js 18 or newer is required');
  if (missingFiles) problems.push(`${missingFiles} required file${missingFiles === 1 ? '' : 's'} missing`);
  if (invalidRuntime) problems.push(`${invalidRuntime} runtime check${invalidRuntime === 1 ? '' : 's'} failed`);
  console.error(`\nArchify is not ready: ${problems.join('; ')}.`);
  process.exitCode = 1;
}

function migrationPathDiagnostics(error, sourcePath, destinationPath) {
  if (Array.isArray(error?.archifyDiagnostics) && error.archifyDiagnostics.length) {
    return error.archifyDiagnostics.map((entry) => ({
      ...entry,
      subject: { ...(entry.subject || {}) },
      evidence: { ...(entry.evidence || {}) },
      supportedFixes: [...(entry.supportedFixes || [])],
    }));
  }
  return [diagnostic({
    code: 'migration/path-preflight',
    message: 'Could not verify that the workflow migration paths are distinct.',
    subject: { source: sourcePath, destination: destinationPath },
    evidence: {
      ...(error?.code ? { systemCode: error.code } : {}),
      reason: error?.message || String(error),
    },
    supportedFixes: ['remove unsafe path aliases or choose a different destination path'],
  })];
}

function migrationReport({
  ok,
  sourcePath,
  destinationPath,
  sourceBytes,
  destinationBytes,
  fromSchemaVersion,
  preExistingDiagnostics = [],
  migrationDiagnostics = [],
  newSchemaDiagnostics = [],
  changedCoordinates = [],
  oldRequiredViewBox = null,
  newRequiredViewBox = null,
}) {
  const report = {
    ok,
    command: 'migrate',
    type: 'workflow',
    source: {
      path: sourcePath,
      ...(sourceBytes ? {
        sha256: createHash('sha256').update(sourceBytes).digest('hex'),
        bytes: sourceBytes.length,
      } : {}),
    },
    destination: {
      path: destinationPath,
      ...(destinationBytes ? {
        sha256: createHash('sha256').update(destinationBytes).digest('hex'),
        bytes: destinationBytes.length,
      } : {}),
    },
    fromSchemaVersion: fromSchemaVersion ?? null,
    toSchemaVersion: 2,
    preExistingDiagnostics,
    migrationDiagnostics,
    newSchemaDiagnostics,
    changedCoordinates,
    oldRequiredViewBox,
    newRequiredViewBox,
  };
  if (!ok) {
    report.diagnostics = [
      ...migrationDiagnostics,
      ...newSchemaDiagnostics,
      ...preExistingDiagnostics,
    ];
    if (!report.diagnostics.length) {
      report.diagnostics.push(diagnostic({
        code: 'migration/internal',
        message: 'Workflow migration failed without a classified diagnostic.',
      }));
    }
    report.error = report.diagnostics[0].message;
  }
  return report;
}

function extractMigrationOptions(args) {
  const positional = [];
  let json = false;
  let toSchema;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--to-schema') {
      toSchema = args[index + 1];
      if (!toSchema || toSchema.startsWith('--')) fail('--to-schema requires a schema version.');
      index += 1;
      continue;
    }
    if (arg.startsWith('--to-schema=')) {
      toSchema = arg.slice('--to-schema='.length);
      if (!toSchema) fail('--to-schema requires a schema version.');
      continue;
    }
    if (arg.startsWith('--')) fail(`Unknown migrate option "${arg}".`);
    positional.push(arg);
  }
  return { positional, json, toSchema };
}

async function commandMigrate(args) {
  const options = extractMigrationOptions(args);
  const [type, sourceArgument, destinationArgument] = options.positional;
  if (
    type !== 'workflow'
    || !sourceArgument
    || !destinationArgument
    || options.positional.length !== 3
    || options.toSchema !== '2'
  ) {
    fail('Usage: archify migrate workflow <old.json> <new.json> --to-schema 2 [--json]');
  }

  const sourcePath = path.resolve(sourceArgument);
  const destinationPath = path.resolve(destinationArgument);
  let sourceBytes;
  let sourceDocument;
  const reportMigrationFailure = ({ status = 1, ...details }) => {
    const report = migrationReport({
      ...details,
      ok: false,
      sourcePath,
      destinationPath,
      sourceBytes,
      fromSchemaVersion: sourceDocument?.schema_version,
    });
    if (options.json) console.log(JSON.stringify(report, null, 2));
    else console.error(formatDiagnostics(report.error, report.diagnostics));
    process.exitCode = status;
  };
  try {
    sourceBytes = fs.readFileSync(sourcePath);
    sourceDocument = JSON.parse(sourceBytes.toString('utf8'));
  } catch (error) {
    reportMigrationFailure({
      preExistingDiagnostics: [inputDiagnostic(error, sourcePath)],
    });
    return;
  }
  // Unlike render/validate, migrate has no --quality override. Pin every stage
  // to the document's durable policy and scrub any ambient profile from the
  // staged renderer by passing this value explicitly.
  const activeQualityProfile = sourceDocument?.meta?.quality_profile || 'standard';

  const { pathsAlias } = await import('../renderers/shared/output-path.mjs');
  let sourceDestinationAlias;
  try {
    sourceDestinationAlias = pathsAlias(sourcePath, destinationPath);
  } catch (error) {
    reportMigrationFailure({
      migrationDiagnostics: migrationPathDiagnostics(error, sourcePath, destinationPath),
    });
    return;
  }
  if (sourceDestinationAlias) {
    reportMigrationFailure({
      migrationDiagnostics: [diagnostic({
        code: 'migration/source-destination',
        message: 'Workflow migration source and destination must be different files.',
        subject: { source: sourcePath, destination: destinationPath },
        supportedFixes: ['choose a different destination path and keep the source unchanged'],
      })],
    });
    return;
  }

  const { migrateWorkflowDocument, serializeMigratedWorkflow } = await import('../migrations/workflow-v2.mjs');
  let migration;
  try {
    migration = migrateWorkflowDocument(sourceDocument);
  } catch (error) {
    migration = {
      ok: false,
      migrationDiagnostics: [diagnostic({
        code: 'migration/internal',
        message: 'Workflow migration failed unexpectedly.',
        evidence: { reason: error.message },
        supportedFixes: ['report the source workflow and this diagnostic to the Archify maintainers'],
      })],
    };
  }

  if (!migration.ok) {
    reportMigrationFailure(migration);
    return;
  }

  if (fs.existsSync(destinationPath) && !fs.lstatSync(destinationPath).isFile()) {
    reportMigrationFailure({
      ...migration,
      migrationDiagnostics: [...migration.migrationDiagnostics, diagnostic({
        code: 'migration/destination-type',
        message: 'Workflow migration destination must be a regular file path.',
        subject: { destination: destinationPath },
        supportedFixes: ['choose a destination path that is absent or names a regular file'],
      })],
    });
    return;
  }

  const destinationDirectory = path.dirname(destinationPath);
  let stagingDirectory;
  try {
    fs.mkdirSync(destinationDirectory, { recursive: true });
    stagingDirectory = fs.mkdtempSync(path.join(destinationDirectory, '.archify-migration-'));
  } catch (error) {
    reportMigrationFailure({
      ...migration,
      migrationDiagnostics: [...migration.migrationDiagnostics, diagnostic({
        code: 'migration/prepare-destination',
        message: 'Could not prepare the workflow migration destination.',
        subject: { destination: destinationPath },
        evidence: { ...(error?.code ? { systemCode: error.code } : {}), reason: error.message },
        supportedFixes: ['choose a writable destination directory'],
      })],
    });
    return;
  }

  const candidatePath = path.join(stagingDirectory, 'candidate.workflow.json');
  const artifactPath = path.join(stagingDirectory, 'migration-check.html');
  const destinationBytes = Buffer.from(serializeMigratedWorkflow(migration.document));
  try {
    fs.writeFileSync(candidatePath, destinationBytes, { flag: 'wx' });
    const render = runNode([rendererPath('workflow'), candidatePath, artifactPath], {
      stdio: 'pipe',
      env: rendererEnv(activeQualityProfile, undefined, true),
    });
    if (render.status !== 0) {
      const failure = rendererFailure(render);
      reportMigrationFailure({
        ...migration,
        newSchemaDiagnostics: [...migration.newSchemaDiagnostics, ...failure.diagnostics],
        status: render.status ?? 1,
      });
      return;
    }

    const check = runNode([path.join(skillRoot, 'scripts/check-render-output.mjs'), artifactPath], {
      stdio: 'pipe',
    });
    if (check.status !== 0) {
      let checker;
      try {
        checker = JSON.parse(check.stdout);
      } catch {
        checker = null;
      }
      reportMigrationFailure({
        ...migration,
        newSchemaDiagnostics: [
          ...migration.newSchemaDiagnostics,
          ...checkerDiagnostics(checker),
        ],
        status: check.status ?? 1,
      });
      return;
    }

    if (pathsAlias(sourcePath, destinationPath)) {
      reportMigrationFailure({
        ...migration,
        migrationDiagnostics: [...migration.migrationDiagnostics, diagnostic({
          code: 'migration/source-destination',
          message: 'Workflow migration source and destination resolved to the same file before commit.',
          subject: { source: sourcePath, destination: destinationPath },
          supportedFixes: ['choose a different destination path and retry'],
        })],
      });
      return;
    }
    const currentSourceBytes = fs.readFileSync(sourcePath);
    if (!currentSourceBytes.equals(sourceBytes)) {
      reportMigrationFailure({
        ...migration,
        migrationDiagnostics: [...migration.migrationDiagnostics, diagnostic({
          code: 'migration/source-changed',
          message: 'Workflow migration source changed while the destination was being verified.',
          subject: { source: sourcePath },
          supportedFixes: ['retry the migration from a stable workflow source file'],
        })],
      });
      return;
    }

    fs.renameSync(candidatePath, destinationPath);
    const report = migrationReport({
      ...migration,
      sourcePath,
      destinationPath,
      sourceBytes,
      destinationBytes,
      fromSchemaVersion: sourceDocument.schema_version,
    });
    if (options.json) console.log(JSON.stringify(report, null, 2));
    else if (sourceDocument.schema_version === 1) {
      console.log(`migrated workflow schema v1→v2: ${sourcePath} → ${destinationPath}`);
    } else {
      console.log(`verified workflow schema v2 migration: ${sourcePath} → ${destinationPath}`);
    }
  } catch (error) {
    const migrationDiagnostics = Array.isArray(error?.archifyDiagnostics)
      ? migrationPathDiagnostics(error, sourcePath, destinationPath)
      : [diagnostic({
        code: 'migration/commit',
        message: 'Could not commit the verified workflow migration.',
        subject: { destination: destinationPath },
        evidence: { ...(error?.code ? { systemCode: error.code } : {}), reason: error.message },
        supportedFixes: ['choose a writable regular-file destination and retry'],
      })];
    reportMigrationFailure({
      ...migration,
      migrationDiagnostics: [...migration.migrationDiagnostics, ...migrationDiagnostics],
    });
  } finally {
    try {
      fs.rmSync(stagingDirectory, { recursive: true, force: true });
    } catch (error) {
      console.error(`Warning: could not remove workflow migration staging directory "${stagingDirectory}": ${error.message}`);
    }
  }
}

function commandValidate(args) {
  const qualityArgs = extractQualityArgs(args);
  const repoArgs = extractRepoRootArgs(qualityArgs.rest);
  args = repoArgs.rest;
  const quality = qualityArgs.quality;
  const repoRoot = repoArgs.repoRoot;
  const knownOptions = new Set(['--json', '--layout-json']);
  const unknown = args.filter((arg) => arg.startsWith('--') && !knownOptions.has(arg));
  if (unknown.length) rejectCliArgument(`Unknown validate option "${unknown[0]}".`, {
    code: 'cli/unknown-option',
    subject: { option: unknown[0] },
    supportedFixes: ['remove the unknown option and retry'],
  });
  const json = args.includes('--json');
  const layoutJson = args.includes('--layout-json');
  const rest = args.filter((arg) => !knownOptions.has(arg));
  const [type, input] = rest;
  if (!type || !input || rest.length !== 2) rejectCliArgument(usage(), {
    code: 'cli/usage',
    supportedFixes: ['use: archify validate <type> <input.json> [options]'],
  });
  assertEvidenceType(type, repoRoot);
  const renderer = rendererPath(type);

  if (layoutJson && !['architecture', 'workflow'].includes(type)) {
    rejectCliArgument('--layout-json is currently supported for architecture and workflow diagrams only.', {
      code: 'cli/unsupported-option',
      subject: { option: '--layout-json', type },
      supportedFixes: ['remove --layout-json or use an architecture or workflow diagram'],
    });
  }

  if (layoutJson) {
    // Layout mode emits JSON without writing HTML; keep its unused target typed.
    const layoutOutput = path.join(os.tmpdir(), `archify-layout-${process.pid}-${type}.html`);
    const result = runNode([renderer, input, layoutOutput, '--layout-json'], {
      stdio: 'pipe',
      env: rendererEnv(quality, repoRoot, true),
    });
    if (result.status !== 0) {
      try {
        const receipt = JSON.parse(result.stdout);
        if (receipt?.contract && Array.isArray(receipt.diagnostics)) {
          process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
          process.exitCode = result.status ?? 1;
          return;
        }
      } catch {
        // Fall through to the renderer failure contract when no compiler
        // receipt was produced (for example, input JSON could not be read).
      }
      const failure = rendererFailure(result);
      reportValidateFailure({
        json,
        stage: failure.diagnostics.some((entry) => entry.code.startsWith('input/')) ? 'input' : 'render',
        type,
        input: path.resolve(input),
        error: failure.error,
        diagnostics: failure.diagnostics,
        status: result.status ?? 1,
      });
      return;
    }
    process.stdout.write(result.stdout);
    return;
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-validate-'));
  const out = path.join(tmp, `${type}.html`);
  let exitCode = 0;

  try {
    const render = runNode([renderer, input, out], {
      stdio: 'pipe',
      env: rendererEnv(quality, repoRoot, true),
    });
    if (render.status !== 0) {
      const failure = rendererFailure(render);
      reportValidateFailure({
        json,
        stage: failure.diagnostics.some((entry) => entry.code.startsWith('input/')) ? 'input' : 'render',
        type,
        input: path.resolve(input),
        error: failure.error,
        diagnostics: failure.diagnostics,
        status: render.status ?? 1,
      });
      exitCode = render.status ?? 1;
    } else {
      const check = runNode([path.join(skillRoot, 'scripts/check-render-output.mjs'), out], { stdio: 'pipe' });
      if (check.status !== 0) {
        let checker;
        try {
          checker = JSON.parse(check.stdout);
          checker.file = path.resolve(input);
        } catch {
          checker = { ok: false, diagnostic: 'Artifact checker failed without a parseable receipt.' };
        }
        reportValidateFailure({
          json,
          stage: 'check',
          type,
          input: path.resolve(input),
          error: 'Final artifact check failed.',
          diagnostics: checkerDiagnostics(checker),
          checker,
          status: check.status ?? 1,
        });
        exitCode = check.status ?? 1;
      } else {
        const result = JSON.parse(check.stdout);
        const engineeringProfile = engineeringProfileFromArtifact(fs.readFileSync(out));
        if (json) {
          console.log(JSON.stringify({
            schemaVersion: 1,
            ok: true,
            command: 'validate',
            type,
            input: path.resolve(input),
            checks: result.checks,
            composition: result.composition,
            ...(engineeringProfile ? { engineeringProfile } : {}),
          }, null, 2));
        } else {
          const engineering = engineeringProfile
            ? `; engineering ${engineeringProfile}: pass`
            : '';
          console.log(`ok ${type} ${path.resolve(input)} (${result.checks.length} artifact checks; composition ${result.composition.profile}: ${result.composition.summary.errors} errors, ${result.composition.summary.warnings} warnings${engineering})`);
        }
      }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  if (exitCode !== 0) process.exitCode = exitCode;
}

const [command, ...args] = process.argv.slice(2);

try {
  switch (command) {
    case undefined:
    case '-h':
    case '--help':
    case 'help':
      console.log(usage());
      break;
    case 'render':
      commandRender(args);
      break;
    case 'deliver':
      await commandDeliver(args);
      break;
    case 'validate':
      commandValidate(args);
      break;
    case 'migrate':
      await commandMigrate(args);
      break;
    case 'inspect':
      if (args[0] !== 'architecture') {
        fail('inspect is currently supported for architecture diagrams only.');
      }
      commandValidate([...args, '--layout-json']);
      break;
    case 'check':
      commandCheck(args);
      break;
    case 'doctor':
      await commandDoctor();
      break;
    default:
      fail(`Unknown command "${command}".\n\n${usage()}`);
  }
} catch (error) {
  if (!error.archifyArgument) throw error;
  if (['validate', 'deliver'].includes(command) && args.includes('--json')) {
    reportArtifactArgumentFailure(command, error);
  } else {
    fail(error.message);
  }
}
