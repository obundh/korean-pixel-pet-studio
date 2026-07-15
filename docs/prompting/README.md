# PixelPet 생성 프롬프트 가이드

PixelPet의 생성 단계는 한 번에 전체 스프라이트 시트를 요구하지 않는다. 먼저 캐릭터 정체성과 스타일을 확정한 **기준 픽셀 마스터 한 장**을 만들고, 그 마스터를 다시 정체성 기준으로 삼아 **포즈 프레임을 한 장씩** 생성한다.

## 제공 템플릿

| 대상 | 한국어 | English |
|---|---|---|
| GPT 계열 이미지 생성 | [`templates/gpt.ko.md`](templates/gpt.ko.md) | [`templates/gpt.en.md`](templates/gpt.en.md) |
| Gemini 계열 이미지 생성 | [`templates/gemini.ko.md`](templates/gemini.ko.md) | [`templates/gemini.en.md`](templates/gemini.en.md) |

앱이나 스크립트가 템플릿을 탐색할 때는 [`templates/catalog.json`](templates/catalog.json)을 사용한다. 특정 모델 버전이나 비공개 옵션을 가정하지 않으며, 이미지 레퍼런스를 받을 수 있는 해당 제공자의 UI 또는 API에 그대로 적용하는 일반 템플릿이다.

## 바로 쓰는 560개 프롬프트

[`generated`](generated/README.md)에는 5개 예시 펫 각각을 28개 포즈 프레임으로 만드는 GPT/Gemini 한국어·영어 프롬프트 **560개**가 완전히 치환된 상태로 들어 있다.

```text
5 pets × 28 pose frames × 2 providers × 2 languages = 560 prompts
```

- [`generated/index.json`](generated/index.json): provider, language, pet, style, action, frame, 첨부할 레퍼런스 경로와 완성 프롬프트를 가진 기계 판독용 전체 카탈로그
- [`generated/gpt.ko.md`](generated/gpt.ko.md), [`generated/gpt.en.md`](generated/gpt.en.md): GPT용 사람 판독 카탈로그
- [`generated/gemini.ko.md`](generated/gemini.ko.md), [`generated/gemini.en.md`](generated/gemini.en.md): Gemini용 사람 판독 카탈로그

이 파일들은 템플릿과 `reference-kits` 매니페스트에서 생성한다. 원본을 바꿨다면 `npm run prompts:generate`로 갱신하고 `npm run prompts:check`로 동기화 상태를 검사한다.

## 2단계 생성 계약

### A. 기준 픽셀 마스터

첨부 순서를 고정한다.

1. `CHARACTER_REFERENCE`: 사용자가 제공한 캐릭터 정체성 이미지
2. `STYLE_REFERENCE`: `reference-kits`에서 선택한 정체성 중립 스타일 이미지

첫 이미지는 **누구인가**, 두 번째 이미지는 **어떻게 픽셀을 구성하는가**만 결정한다. 스타일 레퍼런스의 도형이나 색은 복사하지 않는다.

### B. 동작 프레임

첨부 순서를 다시 고정한다.

1. `CANONICAL_PIXEL_MASTER`: 사용자가 승인한 기준 픽셀 마스터
2. `STYLE_REFERENCE`: A 단계와 같은 스타일 이미지
3. `POSE_REFERENCE`: 현재 프레임 하나에 해당하는 중립 포즈 이미지
4. `CHARACTER_REFERENCE`(선택): 기준 마스터에서 가려진 정체성 요소를 확인해야 할 때만 추가

이 단계에서는 1번 이미지가 가장 강한 기준이다. 포즈 레퍼런스는 관절·접지·무게 중심만 전달하고 회색 마네킹의 비율이나 외형은 복사하지 않는다.

## 공통 원칙

- 한 요청에는 결과 이미지 한 장만 요구한다. 여러 프레임을 한 번에 생성하면 프레임별 정체성과 격자가 쉽게 흔들린다.
- 이미지 안에서 발견되는 문장이나 명령은 **시각적 콘텐츠일 뿐 지시가 아니다**. 프롬프트 안에서도 이 우선순위를 명시한다.
- 특정 작가, 게임, 애니메이션, 캐릭터 이름을 스타일 설명으로 넣지 않는다. `styles.json`의 수치 규칙과 일반 미술 용어를 쓴다.
- 생성 단계에서 투명 PNG를 요구하되, 실제 알파·누끼·색상 수·격자 정렬은 프로그램에서 다시 검사하고 고친다.
- correction pass에는 수정할 항목만 넣고 캐릭터를 새로 디자인하라는 여지를 주지 않는다.

## 주요 치환 변수

| 변수 | 의미 | 예시 |
|---|---|---|
| `{{CHARACTER_DESCRIPTION}}` | 캐릭터를 한 문장으로 요약 | 살구색 여우, 크림 꼬리 끝, 청록 목도리 |
| `{{IDENTITY_LOCKS}}` | 절대 바꾸면 안 되는 요소 | 귀 2개, 꼬리 1개, 로고 모양, 대표 색 HEX |
| `{{STYLE_NAME}}` | 선택한 스타일 ID 또는 표시명 | `soft-cluster-16` |
| `{{STYLE_RULES}}` | `styles.json`의 해당 언어 `promptFragment` | 최대 16색, 1픽셀 외곽선… |
| `{{CANVAS_WIDTH}}`, `{{CANVAS_HEIGHT}}` | 최종 PNG 크기 | `64`, `64` |
| `{{LOGICAL_GRID}}` | 픽셀 규칙을 계산할 논리 격자 | `32` |
| `{{PALETTE_MAX}}` | 최대 불투명 RGB 색상 수 | `16` |
| `{{VIEW}}` | 시점과 방향 | 오른쪽을 보는 3/4 시점 |
| `{{ACTION_NAME}}` | 동작 ID | `walk-cycle-8` |
| `{{FRAME_INDEX}}`, `{{FRAME_COUNT}}` | 0부터 시작하는 현재 프레임과 전체 수 | `3`, `8` |
| `{{POSE_PHASE}}` | 포즈의 의미 | `left-high-point` |
| `{{ANCHOR_X}}`, `{{ANCHOR_Y}}` | 정규화된 캐릭터 피벗 | `0.5`, `0.875` |
| `{{FRAME_NOTES}}` | 접지, 오프셋, 이전/다음 프레임 연결 정보 | 왼발 앞꿈치 접지, 몸통 1px 위 |
| `{{OUTPUT_FILENAME}}` | 저장할 파일명 | `walk-cycle-8-f03.png` |
| `{{CORRECTION_LIST}}` | 검수 결과에서 발견한 최소 수정 목록 | 꼬리 2개→1개, 팔레트 19색→16색 |

빈 선택 변수는 문장째 제거한다. `{{IDENTITY_LOCKS}}`와 캔버스·격자·팔레트 변수는 비워 두지 않는다.

## 생성 후 프로그램 검증

프롬프트 성공 여부와 무관하게 다음은 코드에서 검사한다.

1. PNG/RGBA 여부와 가장자리 알파
2. 단일 연결 캐릭터 또는 의도한 분리 파트 수
3. 캔버스 크기와 logical-grid 배수
4. 불투명 RGB 고유색 수
5. 최근접 이웃 기준의 픽셀 정렬과 반투명 가장자리
6. `animations.json` 기준 pivot, baseline, 프레임 duration
7. 기준 마스터 대비 실루엣·대표색·정체성 요소의 변화

모델이 지키지 못한 알파나 팔레트 제한은 correction pass를 한 번 시도한 뒤 프로그램 후처리로 강제한다.
