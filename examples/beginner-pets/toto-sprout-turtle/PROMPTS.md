# Toto 생성 프롬프트 기록

아래에는 Toto의 원본, 픽셀 마스터, 실제 대기 포즈 시트를 만들 때 Codex 내장 imagegen에 전달한 프롬프트와 마지막 결정론적 루프 보정을 단계별로 기록했습니다. 재현 시 생성 모델의 변동 때문에 픽셀 배치가 완전히 같지는 않을 수 있습니다.

## 1단계 · 오리지널 마스코트 원본

- 첨부 이미지: 없음
- 출력: [`source.png`](source.png)
- 생성 모드: 내장 imagegen · 새 이미지 생성

```text
Use case: stylized-concept
Asset type: original mascot reference image for a beginner pixel-pet tutorial
Primary request: Create an entirely original mascot named Toto, a curious young sprout turtle.
Scene/backdrop: perfectly flat pale sky-blue background, no floor line, no cast shadow, no texture.
Subject: full-body front three-quarter turtle standing on two short legs; mint-green head and limbs; terracotta-orange rounded shell visible as a thick rim behind the body with three large cream hexagonal plates; one simple two-leaf sprout centered on top of the head; short apricot scarf; round dark eyes and a calm friendly smile. Exactly two arms and two feet, no separate tail.
Style/medium: polished Korean public-service mascot illustration, clean flat 2D shapes, bold forest-green outline, simple two-step cel shading, highly readable silhouette.
Composition/framing: one character only, centered, full body visible, generous even padding, neutral reference pose.
Color palette: mint green, terracotta orange, cream, apricot, forest green.
Constraints: original design only; no resemblance to known characters; no text, letters, logos, badge, watermark, props, scenery, duplicate character, extra limbs, gradients, blur, reflection, or shadow.
```

## 2단계 · 픽셀 기준 마스터

첨부 순서는 다음과 같습니다.

1. `Image 1`: [`source.png`](source.png) — 캐릭터 정체성의 유일한 기준
2. `Image 2`: [`paper-cut-48-reference.png`](../../../reference-kits/images/styles/paper-cut-48-reference.png) — 픽셀 클러스터, 외곽선과 명암 규칙만 전달

- 출력: [`pixel-master-chroma.png`](pixel-master-chroma.png)
- 생성 모드: 내장 imagegen · 두 레퍼런스를 사용한 편집/변환

```text
Use case: identity-preserve
Asset type: canonical 64×64 logical pixel sprite master for PixelPet Studio
Input images: Image 1 is the only character-identity reference, Toto the original sprout turtle. Image 2 is an identity-neutral pixel-style reference and controls only pixel cluster size, outline grammar, and shading economy.
Primary request: Redraw exactly the same Toto character from Image 1 as one front three-quarter neutral standing pixel-art sprite. Preserve mint-green body, centered two-leaf sprout, terracotta shell rim, exactly three large cream shell plates readable from the front, and short apricot scarf.
Scene/backdrop: perfectly flat solid #ff00ff chroma-key background covering every pixel outside the character; no floor or shadow.
Style/medium: authentic hand-placed pixel art on a 64×64 logical grid, then shown with crisp nearest-neighbor square pixels. Maximum 24 opaque subject colors, one-logical-pixel forest-green outline, flat layered color regions, two-step shading, no anti-aliasing or dithering.
Composition/framing: one full body only, centered, bottom baseline consistent, all appendages and sprout inside frame, 6 logical pixels of padding.
Constraints: Image 1 controls identity; Image 2 must not contribute its subject or colors. Exactly two arms and two feet. No redesign, no text, no logo, no extra prop, no extra limb, no tail, no duplicate, no ground, no cast shadow, no glow, no blur, no smooth vector curves, no transparency. Do not use #ff00ff anywhere inside the character.
```

마젠타 `#ff00ff`는 최종 배경이 아니라 PixelPet Studio의 배경 제거를 검증하기 위한 단색 입력입니다.

## 3단계 · 실제 대기 포즈 4장

- 첨부 이미지: [`pixel-master-chroma.png`](pixel-master-chroma.png)
- 1차 출력: 내장 imagegen 4포즈 시트
- 최종 출력: [`ai-idle-sheet-chroma.png`](ai-idle-sheet-chroma.png)
- 제작 모드: 내장 imagegen · 캐릭터 정체성 유지 편집 + 아래에 기록한 최소 루프 보정

```text
Use case: identity-preserve
Asset type: four-frame pixel-art idle animation source sheet for a desktop pet
Input image: edit target and strict character identity reference — the mint sprout turtle shown in the supplied image
Primary request: Create a genuine four-frame idle animation of exactly this same character, arranged in one horizontal row of four equal cells, chronological left to right: (1) neutral standing pose with raised left flipper near cheek, (2) gentle inhale with chest lifting and the two sprout leaves tilting slightly upward, (3) relaxed transition with a tiny left-flipper wave while both feet stay planted, (4) gentle exhale with eyelids slightly lowered and sprout leaves relaxing. Animate local body parts; do not scale, skew, or squash the entire character.
Style/medium: crisp deliberate pixel art matching the reference exactly, consistent pixel grid and dark green outline thickness
Composition/framing: one character centered in each equal quarter; identical feet baseline, shell center, overall scale, camera, and generous padding in every cell; full body visible; no panel dividers
Scene/backdrop: perfectly flat uniform solid #ff00ff chroma-key background across the entire sheet
Constraints: preserve the exact mint body, green two-leaf sprout, friendly face, orange scarf, cream segmented shell with orange rim, asymmetric raised flipper, feet and proportions. Keep both feet planted and shell stable. Four frames must be visibly distinct but subtle and form a seamless loop. No whole-body geometric stretching. No motion marks, added objects, text, labels, shadows, gradients, floor, border, watermark, or extra characters. Do not use #ff00ff in the character.
```

1차 결과의 세 번째 칸에 불필요한 동작선이 생겨 다음 최소 수정만 적용했습니다.

```text
Use case: precise-object-edit
Asset type: corrected four-frame pixel-art animation source sheet
Primary request: Remove only the two small dark pink motion marks to the left of the third turtle's raised flipper. Replace those marks with the exact same flat #ff00ff background as the surrounding area.
Constraints: keep all four turtle frames pixel-for-pixel unchanged otherwise, including character identity, positions, colors, outlines, expressions, proportions, spacing, image dimensions, and chroma background. Do not add anything. No text, marks, shadows, panels, or watermark.
```

### 실제 재생 후 적용한 마지막 루프 보정

처음 결과는 개별 프레임으로 볼 때는 자연스러웠지만, 앱에서 `1 → 2 → 3 → 4 → 1`로 반복해 보니 4번에서 1번으로 돌아갈 때 몸 중심이 `0.9512px` 이동하고 알파 실루엣의 `9.95%`가 바뀌어 약한 스냅이 보였습니다. 생성 모델에 시트 전체 편집을 다시 요청하면 1~3번까지 달라졌기 때문에, 최종 입력 시트에는 다음과 같은 작고 결정론적인 수정만 적용했습니다.

1. 시트는 `2172×724`, 칸 하나는 `543×724`입니다.
2. 1번 칸의 픽셀을 4번 칸에 그대로 복사해 마지막 자세가 시작 자세로 정확히 돌아오게 했습니다.
3. 4번 칸에서만 왼쪽 눈의 흰 반짝임 일부를 주변의 진한 눈 색으로 바꿨습니다.
4. 1~3번 칸, 이미지 크기, 마젠타 배경은 바꾸지 않았습니다.

이 보정은 새로운 포즈를 생성하거나 몸을 변형한 것이 아니라 루프의 정착 프레임을 만든 것입니다. 앱 처리 후 4번과 1번은 알파 실루엣과 중심이 같고 RGB 픽셀 3개만 달라, 눈 반짝임이 아주 작게 가라앉은 뒤 끊김 없이 첫 프레임으로 이어집니다. 이 단계는 imagegen 프롬프트가 아니라 입력 시트에 적용한 로컬 픽셀 수정이며, 앱이 수행한 분할·투명화·정렬과 구분해 기록합니다.

## 4단계 · 앱에서 시트 처리

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
