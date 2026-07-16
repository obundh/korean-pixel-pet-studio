# Haeori 생성 프롬프트 기록

아래에는 Haeori의 원본, 픽셀 마스터와 실제 대기 포즈 시트를 만들 때 Codex 내장 imagegen에 전달한 프롬프트를 단계별로 기록했습니다. 재현 시 생성 모델의 변동 때문에 픽셀 배치가 완전히 같지는 않을 수 있습니다.

## 1단계 · 오리지널 마스코트 원본

- 첨부 이미지: 없음
- 출력: [`source.png`](source.png)
- 생성 모드: 내장 imagegen · 새 이미지 생성

```text
Use case: stylized-concept
Asset type: original mascot reference image for a beginner pixel-pet tutorial
Primary request: Create an entirely original mascot named Haeori, a cheerful small sea otter.
Scene/backdrop: perfectly flat warm ivory background, no floor line, no cast shadow, no texture.
Subject: full-body front-facing sea otter standing upright; warm tangerine-brown fur; cream oval muzzle and belly; small round ears; one thick tapered tail visible behind the right side; short turquoise neckerchief with two square ends; tiny golden sun-shaped hair clip above one ear. Friendly dot-like dark eyes and a modest closed smile. Exactly two arms and two feet.
Style/medium: polished Korean public-service mascot illustration, clean flat 2D shapes, bold dark cocoa outline, simple two-step cel shading, highly readable silhouette.
Composition/framing: one character only, centered, full body visible, generous even padding, neutral reference pose.
Color palette: tangerine, cream, turquoise, golden yellow, dark cocoa.
Constraints: original design only; no resemblance to known characters; no text, letters, logos, badge, watermark, props, scenery, duplicate character, extra limbs, gradients, blur, reflection, or shadow.
```

## 2단계 · 픽셀 기준 마스터

첨부 순서는 다음과 같습니다.

1. `Image 1`: [`source.png`](source.png) — 캐릭터 정체성의 유일한 기준
2. `Image 2`: [`soft-cluster-16-reference.png`](../../../reference-kits/images/styles/soft-cluster-16-reference.png) — 픽셀 클러스터, 외곽선과 명암 규칙만 전달

- 출력: [`pixel-master-chroma.png`](pixel-master-chroma.png)
- 생성 모드: 내장 imagegen · 두 레퍼런스를 사용한 편집/변환

```text
Use case: identity-preserve
Asset type: canonical 64×64 logical pixel sprite master for PixelPet Studio
Input images: Image 1 is the only character-identity reference, Haeori the original sun otter. Image 2 is an identity-neutral pixel-style reference and controls only pixel cluster size, outline grammar, and shading economy.
Primary request: Redraw exactly the same Haeori character from Image 1 as one front-facing neutral standing pixel-art sprite. Preserve the tangerine otter body, cream muzzle and belly, turquoise neckerchief, one thick tail, and golden sun hair clip.
Scene/backdrop: perfectly flat solid #ff00ff chroma-key background covering every pixel outside the character; no floor or shadow.
Style/medium: authentic hand-placed pixel art on a 64×64 logical grid, then shown with crisp nearest-neighbor square pixels. Maximum 16 opaque subject colors, one-logical-pixel dark cocoa outline, two-step shading, coherent 2–4 pixel clusters, no anti-aliasing.
Composition/framing: one full body only, centered, bottom baseline consistent, all appendages inside frame, 6 logical pixels of padding.
Constraints: Image 1 controls identity; Image 2 must not contribute its subject or colors. No redesign, no text, no logo, no extra prop, no extra limb, no duplicate, no ground, no cast shadow, no glow, no blur, no smooth vector curves, no transparency. Do not use #ff00ff anywhere inside the character.
```

마젠타 `#ff00ff`는 최종 배경이 아닙니다. 캐릭터 색과 쉽게 구분되는 배경을 앱의 로컬 모델이 제거하도록 의도적으로 사용했습니다.

## 3단계 · 실제 대기 포즈 4장

- 첨부 이미지: [`pixel-master-chroma.png`](pixel-master-chroma.png)
- 출력: [`ai-idle-sheet-chroma.png`](ai-idle-sheet-chroma.png)
- 생성 모드: 내장 imagegen · 캐릭터 정체성 유지 편집

```text
Use case: identity-preserve
Asset type: four-frame pixel-art idle animation source sheet for a desktop pet
Input image: edit target and strict character identity reference — the orange sun otter shown in the supplied image
Primary request: Create a genuine four-frame idle breathing animation of exactly this same character, arranged in one horizontal row of four equal cells, chronological left to right: (1) neutral standing pose, (2) gentle inhale with chest and scarf tips rising slightly, (3) relaxed neutral transition, (4) gentle exhale with eyelids slightly lowered and tail tip easing down. Animate local body parts; do not scale or squash the entire character.
Style/medium: crisp deliberate pixel art matching the reference exactly, consistent pixel grid and outline thickness
Composition/framing: one character centered in each equal quarter; identical feet baseline, body center, scale, camera, and generous padding in every cell; full body visible; no panel dividers
Scene/backdrop: perfectly flat uniform solid #ff00ff chroma-key background across the entire sheet
Constraints: preserve the exact orange/cream colors, face, sun hair clip, turquoise scarf, body proportions, tail shape and pixel style. Keep the feet planted. Four frames must be visibly distinct but subtle and form a seamless loop. No whole-body geometric stretching. No added objects. No text, labels, shadows, gradients, floor, border, watermark, or extra characters. Do not use #ff00ff in the character.
```

## 4단계 · 앱에서 시트 처리

이 단계에는 생성형 AI 프롬프트가 없습니다. PixelPet Studio에서 다음 UI 작업만 실행했습니다.

```text
프레임 가져오기
→ 가로 포즈 시트 가져오기
→ ai-idle-sheet-chroma.png
→ 왼쪽부터 idle 01~04로 4등분
→ 현재 동작 4장 일괄 처리
→ flat chroma 직접 제거
→ 공통 알파 경계와 발 기준선으로 64×64 정렬
→ 4 FPS 실제 프레임 재생 확인
→ 프로젝트·스프라이트시트 내보내기
```

실행 모드, 시각 품질 검사와 출력 해시는 [`run-log.json`](run-log.json)에 있습니다.
