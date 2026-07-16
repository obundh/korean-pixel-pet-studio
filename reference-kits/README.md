# PixelPet Original Reference Kit v1

사용자가 제공한 캐릭터의 정체성은 건드리지 않고, PixelPet이 준비한 **오리지널 스타일 규칙**과 **정체성 중립 포즈**만 전달하기 위한 레퍼런스 세트다. 특정 게임, 프랜차이즈, 현존 작가의 화풍을 지칭하거나 모사하지 않는다.

## 포함 범위

- 서로 다른 동물·색·실루엣의 오리지널 예시 펫 5종
- 서로 다른 픽셀 문법의 오리지널 스타일 프리셋 5종
- `idle`, `walk`, `jump`, `sleep`, `reaction` 동작 5종
- 개별 포즈 프레임 28개
- 파일명과 완전한 생성 프롬프트가 있는 이미지 자산 엔트리 43개

| 예시 펫 | 동물 | 대표 실루엣 | 기본 스타일 | 검증 동작 |
|---|---|---|---|---|
| 구름여우 보리 | 여우 | 직립형 + 큰 초승달 꼬리 | Soft Cluster 16 | Walk 8 |
| 민트우파루파 무루 | 우파루파 | 낮고 넓은 몸 + 6개 아가미 | Pastel Dither 48 | Happy Reaction 6 |
| 자두부엉이 나리 | 부엉이 | 둥근 몸 + 짧은 날개 | Bold Outline 32 | Idle 4 |
| 레몬도마뱀 초리 | 도마뱀붙이 | 낮은 사족 + 나선 꼬리 | Paper Cut 48 | Sleep 4 |
| 달토끼 도도 | 토끼 | 직립형 + 비대칭 긴 귀 | Neon Night 32 | Jump 6 |

## 파일 구조

```text
reference-kits/
├── manifest.json                    # 앱이 처음 읽는 self-contained runtime index
├── pets.json                        # 예시 펫의 색·실루엣·보존 규칙
├── styles.json                      # 스타일 프리셋의 수치 규칙과 prompt fragment
├── animations.json                  # 프레임 순서, duration, offset, 접지 정보
├── assets.example-pets.json         # source 5 + 완성 preview 5의 생성 큐
├── assets.style-references.json     # 정체성 중립 스타일 레퍼런스 5개의 생성 큐
├── assets.pose-references.json      # 포즈 레퍼런스 28개의 생성 큐
└── images/
    ├── example-pets/
    ├── styles/
    └── poses/
```

`manifest.json`의 `assetBaseUrl`은 `/reference-kits/`다. 모든 asset entry의 `filename`은 이 경로를 기준으로 한 상대경로다. 예를 들어 `images/styles/soft-cluster-16-reference.png`의 브라우저 URL은 `/reference-kits/images/styles/soft-cluster-16-reference.png`가 된다.

## PNG 생성 순서

1. `assets.style-references.json`의 5개 자산을 생성한다. 이 자산들은 얼굴이나 동물 정체성이 없는 스타일 교정용 도형이다.
2. `assets.example-pets.json`에서 `kind: example-character-source`인 5개 자산을 생성한다.
3. 같은 파일의 `kind: example-pixel-output` 자산을 생성한다. `referenceInputs`에 적힌 순서대로 source와 style reference를 첨부한다.
4. 저장소에 포함된 포즈 PNG는 `node scripts/generate-pose-references.mjs`로 동일 관절·크기에서 결정론적으로 다시 만들 수 있다. 외부 생성형 AI로 변형본이 필요하면 `assets.pose-references.json`의 0번 프레임 프롬프트부터 생성하고, 나머지는 `referenceInputs`가 가리키는 기준 프레임을 첨부한다.
5. 생성된 파일은 asset entry의 `filename`과 정확히 같은 경로에 저장한다. 프롬프트를 수정해 생성했다면 JSON도 함께 갱신해 재현성을 유지한다.

각 `generationPrompt`는 그 이미지 한 장을 만들기 위한 완전한 영문 프롬프트다. `referenceInputs`가 비어 있지 않으면 배열 순서가 프롬프트의 `REFERENCE 1`, `REFERENCE 2` 순서다.

## 실제 사용자 캐릭터 변환 순서

예시 펫 source/preview는 데모와 회귀 검사에만 사용한다. 사용자의 마스코트를 변환할 때 예시 펫 source를 함께 넣으면 정체성이 섞일 수 있으므로 사용하지 않는다.

```text
사용자 캐릭터 이미지 + 선택한 style reference
  → 기준 픽셀 마스터 1장 확정
기준 픽셀 마스터 + 같은 style reference + pose reference 1장
  → 동작 프레임 1장
프레임별 반복
  → 프로그램에서 누끼/알파 정리, 격자 스냅, 앵커 정렬, 팔레트 검사
```

동작 프레임 단계에서는 원본 캐릭터보다 **확정된 기준 픽셀 마스터를 가장 강한 정체성 레퍼런스**로 사용한다. 포즈 가이드는 관절 관계와 무게 중심만 전달하며 회색 도형의 외형이나 색을 복사하면 안 된다.

## 품질 게이트

- 투명 배경의 RGBA PNG이며 모서리 픽셀의 알파가 0인가
- 캐릭터가 하나뿐이고 전신이 캔버스 안에 있는가
- 선택한 `logicalGrid`, `paletteMax`, outline 규칙을 지키는가
- 얼굴, 대표 색, 로고, 의상, 부속물 같은 사용자 정체성 요소가 기준 마스터와 같은가
- 모든 접지 프레임의 발 또는 배가 같은 baseline에 놓였는가
- 프레임 사이에서 픽셀 크기, 외곽선 굵기, 캐릭터 전체 크기가 흔들리지 않는가
- 텍스트, 워터마크, 배경, 바닥선, 생성 모델이 임의로 추가한 소품이 없는가

생성 모델은 정확한 팔레트 수나 알파 경계를 항상 보장하지 않는다. 따라서 이 검사는 프롬프트만으로 끝내지 않고 프로그램 후처리에서 다시 강제해야 한다.

## 저작권 및 브랜드 주의

키트 안의 이름, 펫 설정, 교정 도형, 스타일 규칙, 포즈 구성은 모두 이 프로젝트를 위한 오리지널 예시다. 이미지 자산은 프로젝트가 허락할 수 있는 권리 범위에서 [CC BY 4.0](../ASSET_LICENSE.md), JSON·설명 문서는 루트 [AGPL-3.0-or-later](../LICENSE)를 따른다. 사용자가 업로드하는 기관 마스코트와 로고에는 어느 라이선스도 적용되지 않으며, 사용·AI 업로드·변형·공개 권한은 업로드한 사용자 또는 운영 주체가 확인해야 한다.

## English summary

This kit provides five original example pets, five identity-neutral original pixel styles, and 28 pose frames across idle, walk, jump, sleep, and reaction actions. Resolve every catalog `filename` relative to `/reference-kits/`. Generate assets in dependency order using each entry's exact `generationPrompt` and ordered `referenceInputs`. When converting a real user mascot, attach only the user's identity reference, the selected style reference, the approved canonical pixel master, and one pose reference—never an example pet source.
