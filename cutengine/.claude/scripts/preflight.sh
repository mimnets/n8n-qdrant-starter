#!/bin/bash
# ============================================================================
# SESSION PREFLIGHT — 모든 Claude Code 세션 시작 시 반드시 실행
# ============================================================================
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║              SESSION PREFLIGHT CHECK                        ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

echo "═══ 1. CURRENT TASK ═══"
if [ -f ".claude/current_task.json" ]; then
    cat .claude/current_task.json
else
    echo "⚠️  No active task. Set one before starting work."
fi
echo ""

echo "═══ 2. RECENT COMMITS (last 5) ═══"
git log --oneline -5 2>/dev/null || echo "No git history"
echo ""

echo "═══ 3. UNCOMMITTED CHANGES ═══"
git status --short 2>/dev/null || echo "Clean"
echo ""

echo "═══ 4. RECENT MISTAKES (avoid repeating!) ═══"
if [ -f ".claude/logs/mistake_log.md" ]; then
    tail -30 .claude/logs/mistake_log.md
else
    echo "No mistakes logged yet."
fi
echo ""

echo "═══ 5. RECENT DECISIONS ═══"
if [ -f ".claude/logs/decision_log.md" ]; then
    tail -30 .claude/logs/decision_log.md
else
    echo "No decisions logged yet."
fi
echo ""

echo "═══ 6. PROJECT STRUCTURE ═══"
if command -v tree &> /dev/null; then
    tree -L 2 -I 'node_modules|.git|dist|build|__pycache__|venv|.venv' --dirsfirst
else
    find . -maxdepth 2 -type d \
        ! -path './.git*' ! -path './node_modules*' ! -path './dist*' \
        | sort | head -40
fi
echo ""

echo "═══ 7. BROKEN REFERENCES CHECK ═══"
if [ -f ".claude/file_registry.json" ] && command -v jq &> /dev/null; then
    BROKEN=0
    while IFS= read -r filepath; do
        if [ ! -f "$filepath" ]; then
            echo "❌ MISSING: $filepath (registered in file_registry but not found)"
            BROKEN=$((BROKEN+1))
        fi
    done < <(jq -r '.files | keys[]' .claude/file_registry.json 2>/dev/null)
    if [ $BROKEN -eq 0 ]; then
        echo "✅ All registered files exist."
    else
        echo "⚠️  $BROKEN broken reference(s) found. Update file_registry.json."
    fi
else
    echo "⚠️  jq not installed or file_registry.json missing. Skipping."
fi
echo ""

echo "════════════════════════════════════════════════════════════════"
echo "✅ Preflight complete. Read CLAUDE.md rules before starting."
echo "════════════════════════════════════════════════════════════════"
