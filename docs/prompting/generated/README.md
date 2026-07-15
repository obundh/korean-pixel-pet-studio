# 완전 치환 프롬프트 카탈로그

이 디렉터리에는 **560개**의 실행 가능한 동작 프레임 프롬프트가 있습니다.

`5 pets × 28 pose frames × 2 providers × 2 languages = 560`

모든 프롬프트는 [상위 템플릿](../templates/catalog.json), [펫·스타일·애니메이션 매니페스트](../../../reference-kits/manifest.json), 이미지 asset catalog를 단일 소스로 생성합니다. 미치환 변수 토큰은 남아 있지 않으며, 각 엔트리에는 제공자·언어·펫·스타일·동작·프레임 정보와 레퍼런스 이미지 4장의 첨부 순서가 들어 있습니다.

## 산출물

| 제공자 | 언어 | 프롬프트 | Markdown |
|---|---|---:|---|
| GPT | 한국어 | 140 | [`gpt.ko.md`](gpt.ko.md) |
| GPT | English | 140 | [`gpt.en.md`](gpt.en.md) |
| Gemini | 한국어 | 140 | [`gemini.ko.md`](gemini.ko.md) |
| Gemini | English | 140 | [`gemini.en.md`](gemini.en.md) |

- [`index.json`](index.json): 560개 프롬프트 전문과 모든 구조화 메타데이터를 담은 기계 판독용 카탈로그
- 제공자·언어별 Markdown: 이미지 첨부 순서와 복사 가능한 프롬프트를 함께 담은 사람용 카탈로그

## 프레임 구성

| 동작 | 펫당 프레임 | 5개 펫 합계 |
|---|---:|---:|
| 숨쉬기 대기 / Breathing Idle | 4 | 20 |
| 8프레임 걷기 / Eight-Frame Walk | 8 | 40 |
| 6프레임 점프 / Six-Frame Jump Arc | 6 | 30 |
| 잠자기 반복 / Sleeping Loop | 4 | 20 |
| 기쁜 반응 / Happy Reaction | 6 | 30 |

각 제공자·언어 조합은 위 28개 포즈를 5개 예시 펫에 모두 적용한 140개 프롬프트를 갖습니다.

## 재생성 및 검증

```bash
npm run prompts:generate
npm run prompts:check
```

`prompts:check`는 현재 파일이 템플릿과 매니페스트에서 다시 계산한 결과와 바이트 단위로 같은지 검사합니다. 프롬프트 템플릿이나 레퍼런스 키트를 바꿨다면 `prompts:generate`를 실행하고 생성된 변경도 함께 커밋하세요.
