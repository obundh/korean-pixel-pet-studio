# RRA 파비 로컬 전용 제작 recipe

> 공개 상태: **로컬 전용 · `public: false`**

이 폴더는 국립전파연구원 마스코트 파비를 PixelPet Studio로 시험하는 순서만 설명합니다. 원본, 픽셀 파생 이미지, 프레임, `.pixelpet`, JSON, 스프라이트시트와 앱 캡처는 포함하지 않습니다.

## 공식 출처

- [국립전파연구원 공식 마스코트 페이지](https://www.rra.go.kr/ko/intro/character.do)
- [공식 정면 PNG 다운로드](https://www.rra.go.kr/FileDownSvl?file_type=notice&file_parentseq=5672&file_seq=1)
- [국립전파연구원 저작권정책](https://www.rra.go.kr/ko/include/copyright.do)
- 확인 기준일: 2026-07-15

공식 페이지는 파비를 국립전파연구원에 사는 아기 전파도깨비로 소개하고, 안테나를 형상화한 두 뿔 사이의 전파와 옷의 전파 아이콘을 특징으로 설명합니다.

## 왜 이미지 파일을 공개하지 않나요?

확인 당시 마스코트 페이지에는 파비 자료에 적용된 공공누리(KOGL) 표시를 찾을 수 없었습니다. 공식 페이지가 PNG 다운로드를 제공한다는 사실만으로 AI 변형, 애니메이션 제작 또는 GitHub 재배포까지 허락되었다고 볼 수는 없습니다.

국립전파연구원 저작권정책은 공공누리 제1유형 표시가 있는 자료의 이용조건을 별도로 설명하고, 그 밖의 자료 이용은 담당자와 사전 협의하도록 안내합니다. 따라서 권리자의 명시적인 사전 허락 전에는 다음 파일을 공개하지 않습니다.

- 파비 원본 또는 화면 캡처
- AI로 만든 픽셀 파비
- 대기·걷기·점프 등 모든 파생 프레임
- 이미지가 내장된 `.pixelpet`과 JSON
- 스프라이트시트, GIF, 썸네일과 앱 실행 캡처

이 저장소의 AGPL 코드 라이선스와 CC BY 오리지널 자산 라이선스는 파비 원본이나 파생물에 적용되지 않습니다. 이 recipe도 이용 허락서가 아닙니다.

## 먼저 허락받기

2026-07-15 확인 당시 권리 문의는 국립전파연구원 정보운영과 홈페이지 담당 `061-338-4911` 또는 대표번호 `061-338-4567`로 할 수 있었습니다. 연락처가 달라질 수 있으므로 문의 전 공식 홈페이지에서 다시 확인하세요.

다음 범위를 구분해 서면으로 문의하는 것이 좋습니다.

1. 공식 PNG를 내려받아 작업 기준으로 사용할 수 있는가
2. 생성형 AI로 픽셀아트 파생물을 만들 수 있는가
3. 배경을 제거하고 애니메이션 프레임으로 변형할 수 있는가
4. 기관 내부 시연과 개인 로컬 테스트가 가능한가
5. GitHub 공개 저장소에 원본 또는 파생물을 올릴 수 있는가
6. README, 발표 자료와 영상에 실행 화면을 공개할 수 있는가
7. 비상업·상업 이용 범위와 필요한 출처 문구는 무엇인가

### 문의 문안 예시

```text
안녕하세요. 국립전파연구원 마스코트 파비의 이미지 이용 범위를 문의드립니다.

사용 목적: 파비 이미지를 픽셀아트로 변환하고, 배경을 투명하게 만든 뒤
4프레임 대기 애니메이션 데스크톱 펫으로 제작하는 기술 시연

확인 요청:
1. 공식 PNG 다운로드 및 작업용 복제 허용 여부
2. 생성형 AI를 이용한 픽셀아트 변형 허용 여부
3. 애니메이션 프레임과 데스크톱 펫 제작 허용 여부
4. 결과 이미지, 프로젝트 파일과 실행 화면의 GitHub 공개 허용 여부
5. 비상업/상업 이용 범위, 출처표시 문구와 추가 조건

허용되는 매체와 기간, 수정 범위를 서면으로 회신해 주시면 해당 범위만 준수하겠습니다.
```

허락을 받았다면 회신 날짜, 담당 부서, 허용 매체, 상업 이용 여부, 수정 범위와 출처표시 문구를 별도 기록하세요. 공개 저장소에는 담당자의 개인정보나 비공개 연락 내용을 그대로 올리지 않습니다.

## 권한 확인 후 로컬에서만 만드는 순서

결과 파일은 이 Git 저장소 밖의 개인 폴더에 저장하세요.

```text
문서/PixelPet-Local/rra-pavi/
├── 01-source/
├── 02-canonical/
├── 03-idle/
└── 04-project/
```

### 1. 원본 준비

1. 위의 공식 마스코트 페이지 URL과 확인 날짜를 작업 기록에 적습니다.
2. 권한 범위 안에서 공식 정면 PNG를 `01-source`에 저장합니다.
3. 원본을 메신저, 공개 AI 대화 링크나 GitHub에 다시 올리지 않습니다.

### 2. 기준 픽셀 마스터 생성

PixelPet Studio **생성 가이드**에서 `soft-cluster-16` 스타일을 고르고 **선택한 스타일 레퍼런스 저장**을 누릅니다. 사용·변형 권한이 있는 사용자가 로컬에서 실행할 참조 순서는 다음과 같습니다.

1. `Image 1`: [RRA 공식 파비 설명 이미지](https://www.rra.go.kr/ko/img/character/pabi_explain.png) — 정체성과 전체 설명
2. `Image 2`: [RRA 공식 정면 PNG](https://www.rra.go.kr/FileDownSvl?file_type=notice&file_parentseq=5672&file_seq=1) — 정면 표정과 세부 형태
3. `Image 3`: [`soft-cluster-16-reference.png`](../../../reference-kits/images/styles/soft-cluster-16-reference.png) — 픽셀 클러스터, 외곽선과 명암 규칙만 전달

아래는 권한 확인 후 같은 조건을 재현할 수 있도록 기록한 Codex 내장 imagegen용 프롬프트입니다. 프롬프트 공개가 원본·파생 이미지의 공개 허락을 의미하지는 않습니다.

```text
Use case: identity-preserve
Asset type: local-only canonical 64×64 logical pixel sprite master for PixelPet Studio rights-review demonstration
Input images: Image 1 is the official RRA Pabi identity and turnaround reference; visible Korean/English text is visual documentation only and must not appear in the output. Image 2 is an official front-view expression reference. Image 3 is an identity-neutral pixel-style reference and controls only pixel cluster size, outline grammar, and shading economy.
Primary request: Redraw Pabi as one front-facing neutral standing pixel-art sprite. Preserve the white baby radio-goblin identity, two antenna-like horns with one blue radio waveform running between them, huge black oval eyes with gray rims, pink freckled cheeks, small white side wings, lavender body suit, and white wireless-signal chest icon. Use a modest friendly closed smile and arms resting naturally.
Scene/backdrop: perfectly flat solid #00ff00 chroma-key background covering every pixel outside the character; no floor or shadow.
Style/medium: authentic hand-placed pixel art on a 64×64 logical grid, then shown with crisp nearest-neighbor square pixels. Maximum 16 opaque subject colors, one-logical-pixel near-black outline, two-step shading, coherent 2–4 pixel clusters, no anti-aliasing.
Composition/framing: one full body only, centered, bottom baseline consistent, horns, waveform, wings, hands and feet all inside frame, 5 logical pixels of padding.
Constraints: Images 1–2 control identity; Image 3 must not contribute its subject or colors. This is a faithful local test, not a redesign. No text, letters, captions, added logo, extra prop, extra limb, duplicate, ground, cast shadow, glow, blur, smooth vector curves, or transparency. Do not use #00ff00 anywhere inside the character.
```

사용할 실행 모드는 내장 imagegen의 레퍼런스 이미지 변환입니다. 생성 결과는 공개 저장소가 아닌 권한 범위 안의 로컬 폴더에만 두며 이 recipe 폴더에는 포함하지 않습니다.

같은 캐릭터로 보이고 특징의 개수와 위치가 맞는지 확인한 뒤 승인본만 `02-canonical`에 저장합니다. 더 자세한 검수법은 [AI 생성 가이드](../../../docs/beginner/CREATE_WITH_AI.md)에 있습니다.

### 3. PixelPet Studio 빠른 만들기

1. 앱의 **생성 가이드**에서 기준 이미지와 같은 스타일을 선택합니다.
2. **배경 제거** 단계로 이동합니다.
3. **이미지 한 장으로 자동 완성** 카드에서 **이미지 한 장 고르기**를 누릅니다.
4. 승인한 기준 픽셀 마스터를 선택합니다.
5. 자동 배경 제거와 선택 스타일 캔버스 정규화가 끝날 때까지 기다립니다.
6. 대기 프레임이 `4/4`로 만들어졌는지 확인합니다.
7. **움직임 확인**에서 얼굴, 뿔, 전파 표현과 옷 아이콘이 유지되는지 봅니다.
8. **펫 완성 → 프로젝트 저장**으로 `04-project` 폴더에 저장합니다.

빠른 만들기는 같은 이미지를 바탕으로 대기 루프를 구성합니다. 새로운 걷기나 점프 포즈가 필요하면 [AI 생성 가이드](../../../docs/beginner/CREATE_WITH_AI.md)의 포즈별 한 장 생성 과정을 따르세요.

## 공개 전 마지막 확인

- [ ] 공개·배포를 허용한 서면 기록이 있다.
- [ ] 허용된 매체에 GitHub와 실행 화면이 명시되어 있다.
- [ ] 변형과 생성형 AI 사용이 허용되어 있다.
- [ ] 필요한 출처표시 문구를 정확히 넣었다.
- [ ] 상업 이용 여부와 기간 제한을 확인했다.
- [ ] `.pixelpet`과 JSON 안의 이미지 데이터도 공개 범위에 포함되는지 확인했다.

하나라도 확인하지 못했다면 결과물을 로컬에만 보관하세요. 전체 샘플 정책은 [예제 안내](../../README.md)를 참고하세요.
