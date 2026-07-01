# 코딩 규칙

## 절대 규칙
1. 코드 수정 시 반드시 전체 파일 코드로 답변 (부분 스니펫 금지)
2. 파일 생성/삭제/이동 시 file_registry.json 업데이트 필수
3. import/require 경로 변경 시 의존 파일 전부 확인 및 수정

## 금지사항
- Google/Imagen/SynthID 모델 사용 금지 (모든 파이프라인)
- LLM-ism 표현 사용 금지 (스크립트/카피)
- 하드코딩된 시크릿/API키 금지

## 스타일
- TypeScript: strict mode, ESLint+Prettier
- Python: Black formatter, type hints
- 주석: WHY를 설명 (WHAT은 코드로 충분)
