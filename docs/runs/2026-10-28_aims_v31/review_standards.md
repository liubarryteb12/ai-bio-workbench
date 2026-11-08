# Standards Review: T-FT-05 Real Input Adapters

Fixed comparison: `git diff HEAD -- BioanalysDesktop/server/figure_adapters.js BioanalysDesktop/server/task.js BioanalysDesktop/tests/figure_adapters.test.js BioanalysDesktop/tests/wp33_figure_adapt.test.js`. No commit yet; worktree v3.1 changes only.

Verification: `node --test BioanalysDesktop/tests/figure_adapters.test.js BioanalysDesktop/tests/wp33_figure_adapt.test.js` passed 12/12. `git diff --check` passed. LF endings, seed exit 3 contracts, path boundary validation, and credential redaction checks pass.

## Documented Hard Violations

1. Path containment check can pass for any path inside REPO_ROOT, not only `reference/05.`: [task.js:603](/D:/00.AIagent/codespace/AI辅助生信分析流程工作台/BioanalysDesktop/server/task.js#L603) normalizes the prefix but compares only against `REPO_ROOT`, leaving the asserted `reference/05.` boundary unenforced.
2. `canonical_output` reaches a generated shell branch unquoted at line 785 of [task.js](/D:/00.AIagent/codespace/AI辅助生信分析流程工作台/BioanalysDesktop/server/task.js#L785), unlike `shellQuote` elsewhere; a hostile template could inject shell commands.

## Judgement Calls

1. `template.canonical_output` is interpolated directly into generated R/Python string literals: [figure_adapters.js:100-124](/D:/00.AIagent/codespace/AI辅助生信分析流程工作台/BioanalysDesktop/server/figure_adapters.js#L100). Registry-sourced today, but unescaped; possible Primitive Obsession and injection surface if data ever flows from user input.
2. Task.js now carries failover, node health, step resolution, and figure adaptation concerns: possible Divergent Change. Tests are interface-level, so this is a cohesion concern rather than a testability violation.
3. Duplicated `adaptFileName` logic across `localAdaptPath` and `deriveAdaptedFigure`: possible Duplicated Code, name does not reveal derivation from the template object.
4. Adapt metadata (projectId, lineId, template, adaptVars) travels as repeated parameter shapes: possible Data Clumps.

## Scope Note

Report limited to the four files and the v3.1 T-FT-05 adapter change. Node failover code inside task.js was reviewed only for standards impact, not behavior beyond this diff.

## Resolution

Both documented hard violations are fixed. Master path containment now resolves against `FIGURE_MASTER_ROOT` and fail-closes on escape: [task.js:604](/D:/00.AIagent/codespace/AI辅助生信分析流程工作台/BioanalysDesktop/server/task.js#L604). Embedded canonical error output now goes through `shellQuote`: [task.js:788](/D:/00.AIagent/codespace/AI辅助生信分析流程工作台/BioanalysDesktop/server/task.js#L788). `figure_adapters.js` rejects unsafe `canonical_output` with a fail-closed allowlist: [figure_adapters.js:34](/D:/00.AIagent/codespace/AI辅助生信分析流程工作台/BioanalysDesktop/server/figure_adapters.js#L34).
