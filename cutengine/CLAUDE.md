# ⛔ MANDATORY — DO NOT SKIP

## Session Start Protocol
1. Run: `bash .claude/scripts/preflight.sh`
2. Read output COMPLETELY before any work
3. Check `.claude/current_task.json` for ongoing work
4. If continuing previous work: review `git log --oneline -5`

## Absolute Rules (violation = broken build)
- **NEVER create files outside directories listed in `.claude/structure_lock.json`**
- **NEVER delete/move files without updating `.claude/file_registry.json`**
- **ALWAYS provide FULL file code when modifying (no partial snippets)**
- **ALWAYS run `bash .claude/scripts/session_end.sh` then `/send` before ending session**
- **ALWAYS commit + push before ending session**
- **NEVER use Google/Imagen/SynthID models in any pipeline**

## File Governance
- Naming: snake_case only (see `.claude/rules/naming.md`)
- New files: add to `.claude/file_registry.json` with depends_on
- Delete files: check depended_by first, update registry
- Reference check: `bash .claude/scripts/check_refs.sh`

## Decision Protocol
- Before suggesting alternatives to established decisions: check `.claude/logs/decision_log.md`
- If a decision has a "재검토 시점" that has not passed: DO NOT re-discuss
- New decisions must be logged with reason, alternatives considered, and review date

## Error Protocol
- Log ALL mistakes to `.claude/logs/mistake_log.md`
- Log session summary to `.claude/logs/session_log.md`
- Update `.claude/current_task.json` with next_steps

---

