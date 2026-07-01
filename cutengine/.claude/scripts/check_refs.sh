#!/bin/bash
# 파일 레지스트리의 참조 무결성 검사
ERRORS=0

if [ ! -f ".claude/file_registry.json" ]; then
    echo "❌ file_registry.json not found"
    exit 1
fi

if ! command -v jq &> /dev/null; then
    echo "⚠️  jq not installed. Install with: brew install jq (mac) / apt install jq (linux)"
    exit 1
fi

echo "Checking file registry integrity..."

# 등록된 파일이 실제로 존재하는지
while IFS= read -r filepath; do
    if [ ! -f "$filepath" ]; then
        echo "❌ MISSING FILE: $filepath"
        ERRORS=$((ERRORS+1))
    fi
done < <(jq -r '.files | keys[]' .claude/file_registry.json)

# 실제 존재하는 소스 파일이 레지스트리에 등록되어 있는지
find . -maxdepth 5 -type f \
    \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.py" \) \
    ! -path './.git/*' ! -path './node_modules/*' ! -path './dist/*' ! -path './.claude/*' \
    | sed 's|^\./||' | while IFS= read -r file; do
    if ! jq -e ".files[\"$file\"]" .claude/file_registry.json > /dev/null 2>&1; then
        echo "⚠️  UNREGISTERED: $file (exists but not in registry)"
    fi
done

if [ $ERRORS -eq 0 ]; then
    echo "✅ All references intact."
else
    echo "❌ $ERRORS error(s) found."
    exit 1
fi
