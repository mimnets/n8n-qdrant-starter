# Session End Checklist

> 세션 종료 프로세스:
> 1. 사전점검: `bash .claude/scripts/session_end.sh`
> 2. 통과 후: `/send` 실행 (7단계 자동화)
>
> /send가 처리하는 것:
> - CLAUDE.md 양쪽 업데이트
> - README.md 업데이트
> - CEO 문서(WEEKLY/ROADMAP) 업데이트
> - git commit + push
> - Notion 세션 보고서 업로드
> - 핸드오프 메시지 생성
>
> 사전점검이 확인하는 것:
> - 깨진 참조 없는지
> - 임시 파일 없는지
> - 파일 레지스트리 동기화 상태
> - 네이밍 규칙 준수 여부
> - current_task.json 상태
