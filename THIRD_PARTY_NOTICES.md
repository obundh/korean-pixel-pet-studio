# Third-party notices

PixelPet Studio의 자체 소스 코드는 루트 `LICENSE`의 MIT 조건으로 배포됩니다. 설치 파일에는 아래 제3자 구성 요소가 함께 포함될 수 있으며, 각각의 라이선스가 우선 적용됩니다.

## @imgly/background-removal

- Package: `@imgly/background-removal` 1.7.0
- Project: <https://github.com/imgly/background-removal-js>
- License: GNU Affero General Public License v3.0 (AGPL-3.0)
- Purpose: 로컬 이미지 segmentation과 알파 배경 제거

빌드 시 공식 IMG.LY 데이터 패키지에서 IS-Net quantized 모델과 ONNX Runtime Web 자산을 내려받아 데스크톱 앱에 포함합니다. 이 조합을 배포할 경우 AGPL의 소스 제공 및 네트워크 상호작용 관련 조건을 포함한 해당 라이선스 의무를 검토해야 합니다. IMG.LY는 별도의 상용 라이선스 문의 창구를 제공합니다.

패키지가 제공하는 전체 라이선스와 전이 의존성 고지는 설치된 다음 파일에서 확인할 수 있습니다.

```text
node_modules/@imgly/background-removal/LICENSE.md
node_modules/@imgly/background-removal/ThirdPartyLicenses.json
```

## Generated reference assets

`reference-kits/images`의 예시 캐릭터·스타일 이미지는 OpenAI 내장 이미지 생성 도구를 사용해 이 프로젝트를 위해 생성한 오리지널 예시입니다. 28개 포즈 이미지는 저장소의 `scripts/generate-pose-references.mjs`가 결정론적으로 생성합니다. 사용자가 업로드하는 기관 마스코트와 로고의 권리는 이 저장소에 포함되지 않습니다.
