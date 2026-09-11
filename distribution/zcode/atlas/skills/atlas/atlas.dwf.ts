// SpexCode atlas, as one ZCode dynamic workflow: read this repository into a SpexCode spec tree (.spec/), draw an
// archify diagram for every node worth one, and hand over the whole tree as one browsable page. SpexCode runs
// through npx, so nothing is installed. Submit this script with CreateWorkflow as it stands, after two edits only:
// set LANGUAGE to the language the user is speaking, and rewrite each phase("...") name into that language.

const LANGUAGE = "English";
const SPEX = ["-y", "-p", "spexcode@next", "spex"];
const SPEX_WITH_PAGE = ["-y", "-p", "spexcode@next", "-p", "@spexcode/spec-dashboard@next", "spex"];
const PAGE = "spexcode-atlas.html";
const COVERAGE_FLOOR = 90;
const REPAIR_ROUNDS = 4;
const CHECK_RETRIES = 2;
const NPX_TIMEOUT = 900_000;

interface Part {
  /** Lowercase ascii-kebab id for this part's spec node ("http-client"); it becomes a folder name. */
  id: string;
  /** The part's title, in the report language. */
  title: string;
  /** One sentence: what this part is responsible for. */
  summary: string;
  /** Workspace-relative directories or files this part covers. Every governed source file belongs to exactly one part. */
  paths: string[];
}
interface Survey {
  /** Lowercase ascii-kebab id of the project's root spec node, usually the repository's name. */
  project: string;
  /** Directories whose source files must each be covered by a spec; "." means the whole repository. */
  governedRoots: string[];
  /** Source file extensions to govern, with the dot: [".py", ".ts"]. */
  sourceExtensions: string[];
  /** Repository-relative globs to leave out of coverage: vendored, generated or build output. Empty when none. */
  excludeGlobs: string[];
  /** The codebase's top-level parts, 3 to 12 of them, together covering every governed source file. */
  parts: Part[];
}
interface Written {
  /** Ids of the spec nodes written, the part's own included. */
  nodes: string[];
  /** One sentence on anything that could not be settled, or "none". */
  notes: string;
}
interface Gate {
  /** Governed source files lint counts. */
  governed: number;
  /** Percent of governed files some spec covers. */
  coverage: number;
  /** Lint errors, "rule: message" (at most 60). */
  errors: string[];
  errorCount: number;
  /** Governed files no spec covers yet (at most 200). */
  uncovered: string[];
  uncoveredCount: number;
  /** Set when lint produced no readable report: the tail of what it printed instead. */
  failed?: string;
}
interface Pick {
  /** Exactly one node id from the list you were given — a folder name, with nothing added to it. */
  id: string;
  /** The kind of picture its body calls for. */
  kind: "architecture" | "workflow" | "sequence" | "dataflow" | "lifecycle";
  /** One sentence: why this node deserves this picture. */
  why: string;
}
interface Choice {
  picks: Pick[];
  /** Nodes considered and left without a picture, each with the reason. */
  skipped: { id: string; why: string }[];
}
interface Drawn {
  id: string;
  kind: string;
  /** True when `spex diagram check` passed on the final attempt. */
  passed: boolean;
}
interface Claim {
  /** The spec node whose body makes the claim. */
  node: string;
  /** The claim, quoted or closely paraphrased. */
  claim: string;
  /** What in the code contradicts it or fails to support it, with path:line. */
  evidence: string;
}
interface Reading {
  /** At most 8 claims the code does not bear out; empty when every claim checked holds. */
  claims: Claim[];
  /** The nodes that were read. */
  read: string[];
}
interface Confirmation {
  /** True only when you reproduced the problem yourself from the evidence. */
  reproduced: boolean;
  /** One sentence: what you checked. */
  note: string;
}

// The gate reading, computed where the report is produced: lint's JSON grows with the repository, while
// world.run rejects output over 256KB, so the command prints only what the loop branches on.
const GATE = [
  "const { spawnSync } = require('node:child_process')",
  "const run = spawnSync('npx', process.argv.slice(1), { encoding: 'utf8', maxBuffer: 1 << 30 })",
  "let report",
  "try { report = JSON.parse(run.stdout) } catch { console.log(JSON.stringify({ governed: 0, coverage: 0, errors: [], errorCount: 0, uncovered: [], uncoveredCount: 0, failed: String(run.stderr || run.stdout || run.error || '').slice(-3000) })); process.exit(0) }",
  "const findings = report.findings || []",
  "const governed = (report.sourceFiles || []).length",
  "const uncovered = findings.filter((f) => f.rule === 'coverage').map((f) => f.file || f.msg)",
  "const errors = findings.filter((f) => f.level === 'error').map((f) => f.rule + ': ' + (f.spec ? f.spec + ': ' : '') + f.msg)",
  "console.log(JSON.stringify({ governed, coverage: governed ? Math.round(((governed - uncovered.length) / governed) * 100) : 0, errors: errors.slice(0, 60), errorCount: errors.length, uncovered: uncovered.slice(0, 200), uncoveredCount: uncovered.length }))",
].join("\n");

const tail = (text: string) => text.slice(-4000);
// A gate that cannot read lint decides nothing, and no repair round can fix that, so the run stops and says why.
async function readGate(): Promise<Gate> {
  await world.run("git", ["add", "--", ".spec"]);
  // `--` ends node's own options; without it node takes npx's `-y` for one of its flags and runs nothing.
  const run = await world.run("node", ["-e", GATE, "--", ...SPEX, "spec", "lint", "--json"], { timeoutMs: NPX_TIMEOUT });
  if (run.exitCode !== 0 || !run.stdout.trim()) throw new Error(`The spec gate did not run:\n${tail(run.stderr || run.stdout)}`);
  const gate: Gate = JSON.parse(run.stdout);
  if (gate.failed) throw new Error(`spex spec lint produced no report:\n${gate.failed}`);
  return gate;
}
const passed = (gate: Gate) => gate.errorCount === 0 && gate.governed > 0 && gate.coverage >= COVERAGE_FLOOR;

const WRITER =
  "You write SpexCode spec nodes. A node is a folder under .spec/ holding a spec.md: YAML frontmatter with title, " +
  "desc, `code:` listing AT MOST ONE file the node governs, and `related:` listing the other files it covers or " +
  "references; then a markdown body that states the part's responsibility, its invariants and how its pieces fit, " +
  "as the code stands today — no history, no plans. A child node is a subfolder with its own spec.md. Run " +
  "`npx -y -p spexcode@next spex guide spec` once for the full format. Write only under .spec/, never touch source " +
  `code, and write every title, desc and body in ${LANGUAGE}; ids, paths and frontmatter keys stay ascii. If an ` +
  "instruction cannot be followed, escalate and say so plainly rather than working around it.";
const CARTOGRAPHER =
  "You draw one SpexCode node's diagram: a diagram.json beside its spec.md, an archify IR. Run " +
  "`npx -y -p spexcode@next spex guide diagram` once for the format, the rules and the loop. Start from " +
  "`npx -y -p spexcode@next spex diagram scaffold <node> --type <kind>`, connect what the node's body says is " +
  "connected and name each edge by what crosses it, group with regions, add cards, and write meta.note — what was " +
  "folded, which relation is an inference. Repair from `npx -y -p spexcode@next spex diagram check <node>` until it " +
  "passes. Put no self-moving numbers on the picture (node counts, drift, import counts). Edit only that node's " +
  `diagram.json, and write its visible text in ${LANGUAGE}. If the check cannot pass, escalate and say why.`;

artifact.table("pictures", {
  title: "Pictures",
  key: "id",
  columns: [{ field: "id", label: "Node" }, { field: "kind", label: "Kind" }, { field: "passed", label: "Check passed" }],
});

phase("Read the repository and plan its spec tree");
const npx = await world.run("npx", [...SPEX, "--version"], { timeoutMs: NPX_TIMEOUT });
if (npx.exitCode !== 0) throw new Error(`SpexCode did not start through npx:\n${tail(npx.stderr || npx.stdout)}`);
const existing = await files.glob(".spec/**/spec.md");
let project = "";
if (existing.length === 0) {
  const surveyor = agent("Repository surveyor", { tools: "readonly" });
  const survey = await surveyor.ask<Survey>(
    "Read this repository and plan its SpexCode spec tree. Decide which directories hold its source (governedRoots) " +
      "and which file extensions count as source, name what should stay out of coverage (vendored, generated, build " +
      "output), and divide the codebase into 3 to 12 top-level parts by responsibility, not by file type. Each part " +
      "gets an ascii-kebab id, a title, one sentence of summary, and the paths it covers; together the parts cover " +
      `every governed source file. Titles and summaries in ${LANGUAGE}.`,
  );
  project = survey.project;
  const seen = new Set<string>();
  const parts = survey.parts.filter((part) => !seen.has(part.id) && Boolean(seen.add(part.id)));
  log(`Planned ${parts.length} parts for ${project}`);

  phase("Write the spec for each part in parallel");
  const lead = agent("Spec lead", WRITER);
  await lead.ask(
    `Create .spec/spexcode.json with exactly {"lint": {"governedRoots": ${JSON.stringify(survey.governedRoots)}, ` +
      `"sourceExtensions": ${JSON.stringify(survey.sourceExtensions)}, "sourceExcludeGlobs": ${JSON.stringify(survey.excludeGlobs)}}}. ` +
      `Then write the root node .spec/${project}/spec.md: what this repository is, and how its parts fit together — ` +
      `name each part by a [[part-id]] mention. The parts are:\n${JSON.stringify(parts, null, 2)}\n` +
      "Do not write the parts' own folders; other writers are doing that now.",
  );
  const written = await Promise.all(
    parts.map((part) =>
      agent(`Spec writer: ${part.id}`, WRITER).ask<Written>(
        `Write the spec nodes for one part of this repository: .spec/${project}/${part.id}/spec.md for the part itself, ` +
          "and a child node for each file or cluster of files worth its own statement. Every governed source file under " +
          `the part's paths must end up in some node's code: or related: list. The part:\n${JSON.stringify(part, null, 2)}\n` +
          "Write only inside that folder.",
      ),
    ),
  );
  report({ step: "written", parts: parts.length, nodes: written.reduce((sum, part) => sum + part.nodes.length, 0) });
}

phase("Check the spec tree and repair it until it passes");
const repairer = agent("Spec repairer", WRITER);
let gate = await readGate();
for (let round = 1; round <= REPAIR_ROUNDS && !passed(gate); round++) {
  log(`Repair round ${round}: ${gate.errorCount} lint errors, ${gate.coverage}% of ${gate.governed} source files covered`);
  await repairer.ask(
    "The spec tree does not pass SpexCode's gate yet.\n" +
      `Lint errors (${gate.errorCount}):\n${gate.errors.join("\n") || "none"}\n` +
      `Source files no spec covers (${gate.uncoveredCount}):\n${gate.uncovered.join("\n") || "none"}\n` +
      "Fix every error and cover every listed file — in an existing node's related: list when it belongs to that " +
      "node, in a new child node when it deserves its own statement.",
  );
  gate = await readGate();
}
report({ step: "gate", passed: passed(gate), coverage: gate.coverage, governed: gate.governed, errors: gate.errorCount });
const firstCommit = await world.run("git", ["commit", "-m", "spec: SpexCode spec tree", "--", ".spec"]);
log(firstCommit.exitCode === 0 ? "Committed the spec tree" : "Nothing new to commit in .spec");

phase("Choose the nodes worth a picture");
const specs = await files.glob(".spec/**/spec.md");
// A node's id is its folder's name; a pick that names anything else would send a cartographer after nothing.
const known = new Set(specs.map((path) => path.split("/").slice(-2, -1).join("")));
const unknownIds = (c: Choice) => c.picks.map((pick) => pick.id).filter((id) => !known.has(id));
const planner = agent("Atlas planner", { tools: "readonly" });
let choice = await planner.ask<Choice>(
  "Choose which nodes of this SpexCode spec tree deserve a diagram. A node whose body explains how its children fit " +
    "together gets an architecture diagram of those children; a node whose body is a process, a protocol, a data " +
    "path or a lifecycle gets that kind instead. Skip leaves with nothing to show and nodes that already have a " +
    "diagram.json beside their spec.md. Always include the root node. A node's id is its folder's name. The nodes:\n" +
    specs.join("\n"),
);
if (unknownIds(choice).length) {
  choice = await planner.ask<Choice>(
    `These picks name no node: ${unknownIds(choice).join(", ")}. A pick's id is exactly one folder name from the ` +
      "list, with nothing added to it. Give the whole choice again.",
  );
}
const drawnIds = new Set<string>();
const picks = choice.picks.filter((pick) => known.has(pick.id) && !drawnIds.has(pick.id) && Boolean(drawnIds.add(pick.id)));
const skipped = [
  ...choice.skipped,
  ...unknownIds(choice).map((id) => ({ id, why: "the planner named a node that does not exist, twice" })),
];
log(`Drawing ${picks.length} pictures, skipping ${skipped.length} nodes`);

phase("Draw each picture and check it until it passes");
const drawn = await Promise.all(
  picks.map(async (pick) => {
    const cartographer = agent(`Cartographer: ${pick.id}`, CARTOGRAPHER);
    await cartographer.ask(`Draw node ${pick.id} as a ${pick.kind} diagram. Why this node: ${pick.why}`);
    let check = await world.run("npx", [...SPEX, "diagram", "check", pick.id], { timeoutMs: NPX_TIMEOUT });
    for (let attempt = 1; attempt <= CHECK_RETRIES && check.exitCode !== 0; attempt++) {
      await cartographer.ask(`The check still fails:\n${tail(check.stdout + check.stderr)}\nRepair the diagram until it passes.`);
      check = await world.run("npx", [...SPEX, "diagram", "check", pick.id], { timeoutMs: NPX_TIMEOUT });
    }
    const result: Drawn = { id: pick.id, kind: pick.kind, passed: check.exitCode === 0 };
    report(result, "pictures");
    return result;
  }),
);

phase("Have an independent reader check the tree against the code");
const reader = agent("Independent reader", { tools: "readonly" });
const reading = await reader.ask<Reading>(
  `Read the root node .spec/${project || "<the one folder under .spec>"}/spec.md and each top-level part's spec.md, and ` +
    "check what they claim against the code. List the claims the code does not bear out, with the evidence; an empty " +
    `list is a fine answer. Write in ${LANGUAGE}.`,
);
const claims = await Promise.all(
  reading.claims.map(async (claim, index) => {
    const confirmation = await agent(`Confirmer ${index + 1}`, { tools: "readonly" }).ask<Confirmation>(
      `Reproduce this finding from its evidence alone: read the code it cites.\n${JSON.stringify(claim)}`,
    );
    const status: "verified" | "unconfirmed" = confirmation.reproduced ? "verified" : "unconfirmed";
    const finding = { ...claim, status };
    report(finding);
    return finding;
  }),
);

phase("Build the browsable page and hand it over");
await world.run("git", ["add", "--", ".spec"]);
const lastCommit = await world.run("git", ["commit", "-m", "spec: SpexCode atlas diagrams", "--", ".spec"]);
const page = await world.run("npx", [...SPEX_WITH_PAGE, "graph", "--public", "--html", PAGE], { timeoutMs: NPX_TIMEOUT });
let pageNote = `The page is ${PAGE}; it is not committed.`;
if (page.exitCode === 0) {
  await artifact.file("atlas", PAGE, { title: "Spec atlas", description: "The whole spec tree with its pictures, one self-contained page." });
} else {
  pageNote = `The page could not be written:\n${tail(page.stderr || page.stdout)}`;
}
const drawnOk = drawn.filter((d) => d.passed);
const verifiedClaims = claims.filter((c) => c.status === "verified");
await artifact.markdown(
  "report",
  [
    `# Spec atlas: ${gate.coverage}% of ${gate.governed} source files covered, ${drawnOk.length} of ${drawn.length} pictures pass`,
    "",
    `Spec gate: ${passed(gate) ? "passed" : "not passed"} — ${gate.errorCount} lint errors, coverage ${gate.coverage}% (floor ${COVERAGE_FLOOR}%).`,
    "",
    "## Pictures",
    ...drawn.map((d) => `- ${d.id} (${d.kind}): ${d.passed ? "check passes" : "check still fails"}`),
    "",
    "## Skipped",
    ...skipped.map((s) => `- ${s.id}: ${s.why}`),
    "",
    "## Claims the code does not bear out",
    ...(claims.length ? claims.map((c) => `- ${c.node} (${c.status}): ${c.claim} — ${c.evidence}`) : ["- none found"]),
    "",
    pageNote,
    lastCommit.exitCode === 0 || firstCommit.exitCode === 0 ? "The spec tree and its diagrams are committed under .spec/." : "Nothing under .spec/ needed a commit.",
  ].join("\n"),
  { title: "Atlas report" },
);
return {
  conclusion:
    `The spec tree covers ${gate.coverage}% of ${gate.governed} source files with ${gate.errorCount} lint errors; ` +
    `${drawnOk.length} of ${drawn.length} diagrams pass their check. ${pageNote}`,
  findings: claims.map((c) => ({ where: c.node, what: c.claim, evidence: c.evidence, status: c.status, severity: "medium" as const })),
  verified: [
    "spex spec lint --json after every repair round (errors and coverage)",
    ...drawn.map((d) => `spex diagram check ${d.id}: ${d.passed ? "passed" : "failed"}`),
    `each of ${claims.length} reported claims re-read by a separate subagent (${verifiedClaims.length} reproduced)`,
  ],
  notCovered: [
    "claims in nodes below the top-level parts were not checked against the code",
    ...(passed(gate) ? [] : [`the spec gate did not pass within ${REPAIR_ROUNDS} repair rounds`]),
  ],
};
