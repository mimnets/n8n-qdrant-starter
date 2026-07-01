# Git 규칙

## 커밋
- 작업 단위별 커밋 (한 커밋에 여러 기능 혼합 금지)
- 커밋 메시지 형식: type(scope): description
  - feat, fix, docs, refactor, chore, test
  - 예: feat(voicecore): add batch processing endpoint
- 코드 변경 시 관련 README/문서도 함께 커밋

## 브랜치
- main: 안정 버전만
- dev: 개발 통합
- feature/*: 기능 개발

## 세션 종료 시
- 반드시 모든 변경사항 commit + push
- session_end.sh 실행하여 누락 확인
