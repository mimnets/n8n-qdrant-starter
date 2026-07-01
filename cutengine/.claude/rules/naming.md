# 파일/폴더 네이밍 규칙

## 파일명
- snake_case 사용 (예: voice_config.ts, render_pipeline.py)
- 영문 소문자 + 숫자 + 언더스코어만 허용
- 확장자 앞 버전 번호 금지 (voice_config_v2.ts ❌ → git으로 관리)
- 백업/복사본 접미사 금지 (_backup, _old, _copy, _temp ❌)

## 폴더명
- kebab-case 또는 snake_case (예: voice-core/, render_forge/)
- 영문 소문자 + 숫자 + 하이픈/언더스코어만 허용

## 금지 패턴
- *.tmp, *_backup*, copy_of_*, *_old*, *_v[0-9]*, temp_*, test_scratch*, untitled*
