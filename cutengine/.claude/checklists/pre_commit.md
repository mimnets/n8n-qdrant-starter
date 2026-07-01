# Pre-Commit Checklist

> 커밋 전 반드시 확인. Git hook이 자동 검사하지만, 수동 확인도 습관화.

- [ ] 파일이 허용된 디렉토리에 있는가? (structure_lock.json)
- [ ] 파일명이 네이밍 규칙을 준수하는가? (rules/naming.md)
- [ ] 파일 추가/삭제 시 file_registry.json을 업데이트했는가?
- [ ] import/require 경로가 모두 유효한가?
- [ ] 임시 파일이 남아있지 않은가? (*.tmp, *_backup 등)
- [ ] README.md Roadmap/TODO 업데이트가 필요한가?
- [ ] 하드코딩된 시크릿/API키가 없는가?
