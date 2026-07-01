#!/bin/bash
# ============================================================================
# SESSION PRE-CHECK — /send 실행 전 사전점검
# ============================================================================
# 이 스크립트는 /send 실행 전에 돌리는 "준비 상태 확인"입니다.
# 실제 세션 마무리(커밋, 푸시, 노션, 핸드오프)는 /send 스킬이 담당합니다.
#
# 사용법: bash .claude/scripts/session_end.sh
# 통과 후: /send 실행
# ============================================================================

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║           SESSION PRE-CHECK (before /send)                  ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

ERRORS=0
WARNINGS=0

# ─── 1. 깨진 참조 체크 ────────────────────────────────────────────────
echo "── 1. 참조 무결성 ──"
if [ -f ".claude/file_registry.json" ] && command -v jq &> /dev/null; then
    BROKEN=0
    while IFS= read -r filepath; do
        if [ ! -f "$filepath" ]; then
            echo "   ❌ MISSING: $filepath"
            BROKEN=$((BROKEN+1))
        fi
    done < <(jq -r '.files | keys[]' .claude/file_registry.json 2>/dev/null)
    if [ $BROKEN -eq 0 ]; then
        echo "   ✅ 모든 등록 파일 존재 확인"
    else
        echo "   ❌ ${BROKEN}개 파일 누락 — file_registry.json 업데이트 필요"
        ERRORS=$((ERRORS+BROKEN))
    fi
else
    echo "   ⚠️  jq 미설치 또는 file_registry.json 없음 — 건너뜀"
fi
echo ""

# ─── 2. 임시/금지 파일 잔존 체크 ──────────────────────────────────────
echo "── 2. 임시 파일 체크 ──"
TEMP_FILES=$(find . -maxdepth 4 -type f \
    \( -name "*.tmp" -o -name "*_backup*" -o -name "copy_of_*" \
       -o -name "temp_*" -o -name "*_old*" -o -name "untitled*" \
       -o -name "*_v[0-9]*" -o -name "test_scratch*" \) \
    ! -path './.git/*' ! -path './node_modules/*' ! -path './dist/*' \
    2>/dev/null)
if [ -n "$TEMP_FILES" ]; then
    echo "   ⚠️  임시 파일 발견 — 삭제 또는 정리 필요:"
    echo "$TEMP_FILES" | sed 's/^/      /'
    WARNINGS=$((WARNINGS+1))
else
    echo "   ✅ 임시 파일 없음"
fi
echo ""

# ─── 3. file_registry 동기화 체크 ─────────────────────────────────────
echo "── 3. 파일 레지스트리 동기화 ──"
if [ -f ".claude/file_registry.json" ] && command -v jq &> /dev/null; then
    UNREGISTERED=0
    while IFS= read -r file; do
        if ! jq -e ".files[\"$file\"]" .claude/file_registry.json > /dev/null 2>&1; then
            echo "   ⚠️  미등록: $file"
            UNREGISTERED=$((UNREGISTERED+1))
        fi
    done < <(find . -maxdepth 5 -type f \
        \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" -o -name "*.py" \) \
        ! -path './.git/*' ! -path './node_modules/*' ! -path './dist/*' ! -path './.claude/*' \
        | sed 's|^\./||')
    if [ $UNREGISTERED -eq 0 ]; then
        echo "   ✅ 모든 소스 파일 등록됨"
    else
        echo "   ⚠️  ${UNREGISTERED}개 미등록 파일 — file_registry.json 업데이트 권장"
        WARNINGS=$((WARNINGS+1))
    fi
else
    echo "   ⚠️  건너뜀"
fi
echo ""

# ─── 4. 네이밍 규칙 위반 체크 ─────────────────────────────────────────
echo "── 4. 네이밍 규칙 ──"
NAMING_VIOLATIONS=0
UPPER_ALLOWED="README|CLAUDE|LICENSE|CHANGELOG|Dockerfile|Makefile|Procfile|Gemfile|Taskfile|SKILL|CODEOWNERS|WEEKLY|ROADMAP|REFACTORING|TODO|CONTRIBUTING|SECURITY|AUTHORS"
while IFS= read -r file; do
    basename=$(basename "$file")
    if [[ "$basename" =~ ^($UPPER_ALLOWED) ]]; then continue; fi
    if [[ ! "$basename" =~ ^[a-z0-9][a-z0-9_.-]*$ ]]; then
        echo "   ⚠️  위반: $file"
        NAMING_VIOLATIONS=$((NAMING_VIOLATIONS+1))
    fi
done < <(git diff --name-only HEAD 2>/dev/null; git ls-files --others --exclude-standard 2>/dev/null)
if [ $NAMING_VIOLATIONS -eq 0 ]; then
    echo "   ✅ 네이밍 규칙 준수"
else
    echo "   ⚠️  ${NAMING_VIOLATIONS}개 위반 — 커밋 시 차단될 수 있음"
    WARNINGS=$((WARNINGS+1))
fi
echo ""

# ─── 5. 실수 기록 리마인더 ────────────────────────────────────────────
echo "── 5. 세션 중 실수/노하우 ──"
echo "   이번 세션에서 실수나 새 노하우가 있었다면:"
echo "   → .claude/logs/mistake_log.md 에 기록하세요"
echo "   → .claude/logs/decision_log.md 에 결정사항 기록하세요"
echo ""

# ─── 6. current_task.json 리마인더 ────────────────────────────────────
echo "── 6. 작업 상태 ──"
if [ -f ".claude/current_task.json" ]; then
    TASK=$(cat .claude/current_task.json 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('task',''))" 2>/dev/null || echo "")
    if [ -z "$TASK" ]; then
        echo "   ⚠️  current_task.json의 task가 비어있음 — /send 전에 업데이트"
        WARNINGS=$((WARNINGS+1))
    else
        echo "   📋 현재 작업: $TASK"
    fi
else
    echo "   ⚠️  current_task.json 없음"
    WARNINGS=$((WARNINGS+1))
fi
echo ""

# ─── 결과 요약 ────────────────────────────────────────────────────────
echo "════════════════════════════════════════════════════════════════"
if [ $ERRORS -gt 0 ]; then
    echo "❌ ${ERRORS}개 오류 — 반드시 수정 후 /send 실행"
    echo "════════════════════════════════════════════════════════════════"
    exit 1
elif [ $WARNINGS -gt 0 ]; then
    echo "⚠️  ${WARNINGS}개 경고 — 확인 후 /send 실행 가능"
    echo "════════════════════════════════════════════════════════════════"
    exit 0
else
    echo "✅ 모든 점검 통과 — /send 실행 가능"
    echo "════════════════════════════════════════════════════════════════"
    exit 0
fi
