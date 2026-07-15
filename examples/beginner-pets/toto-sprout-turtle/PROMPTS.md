# Toto 생성 프롬프트 기록

아래 두 프롬프트는 Toto의 `source.png`와 `pixel-master-chroma.png`를 만들 때 Codex 내장 imagegen에 전달한 원문입니다. 재현 시 생성 모델의 변동 때문에 픽셀 배치가 완전히 같지는 않을 수 있습니다.

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

## 3단계 · 앱 빠른 만들기

이 단계에는 생성형 AI 프롬프트가 없습니다.

```text
배경 제거
→ 이미지 한 장으로 자동 완성
→ 이미지 한 장 고르기
→ pixel-master-chroma.png
→ 로컬 배경 제거
→ 64×64 정규화
→ idle 4장
→ 프로젝트·스프라이트시트 내보내기
```

실행 모드와 출력 해시는 [`run-log.json`](run-log.json)에 있습니다.
