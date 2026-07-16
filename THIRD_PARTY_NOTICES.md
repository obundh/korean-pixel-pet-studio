# Third-party notices

PixelPet Studio는 누구나 소스를 보고 고칠 수 있는 비상업·공익 목적의 공개 프로젝트로 운영합니다. 다만 “비상업 목적”은 라이선스에 추가되는 사용 제한이 아닙니다. 프로젝트 코드와 결합된 데스크톱 앱은 [GNU Affero General Public License v3.0 or later](LICENSE)로 배포되며, AGPL 조건을 지키면 상업적 이용도 가능합니다.

아래 구성 요소에는 각 권리자의 라이선스와 고지가 별도로 적용됩니다. 이 문서는 핵심 런타임 구성 요소를 사람이 읽기 쉽게 요약한 것이며, 설치 파일의 `legal` 폴더에 포함되는 원문 라이선스와 빌드별 구성 목록이 우선합니다.

## IMG.LY background removal

### `@imgly/background-removal` 1.7.0

- Project: <https://github.com/imgly/background-removal-js>
- Package: <https://www.npmjs.com/package/@imgly/background-removal/v/1.7.0>
- License: GNU Affero General Public License v3.0 (AGPL-3.0)
- Purpose: 브라우저·Electron 안에서 실행하는 이미지 segmentation과 알파 배경 제거

### `@imgly/background-removal-data` 1.7.0

- Project: <https://github.com/imgly/background-removal-js>
- Package archive: <https://staticimgly.com/@imgly/background-removal-data/1.7.0/package.tgz>
- License declared by the package: GNU Affero General Public License v3.0 (AGPL-3.0)
- Bundled resources: `isnet_quint8` model, ONNX Runtime Web JavaScript/WASM runtime

두 패키지는 같은 AGPL-3.0 라이선스 전문을 제공합니다. PixelPet Studio는 `@imgly/background-removal`을 앱 코드에 직접 결합하고 데이터 패키지의 실행 자산을 함께 배포하므로, 공개 바이너리에는 해당 빌드의 완전한 Corresponding Source와 라이선스 고지를 함께 제공해야 합니다. 자세한 배포 절차는 [SOURCE_OFFER.md](SOURCE_OFFER.md)를 따릅니다.

원문과 공급자 고지는 다음 파일에서 확인할 수 있습니다.

```text
node_modules/@imgly/background-removal/LICENSE.md
node_modules/@imgly/background-removal/ThirdPartyLicenses.json
@imgly/background-removal-data-1.7.0/package/LICENSE.md
@imgly/background-removal-data-1.7.0/package/ThirdPartyLicenses.json
```

## IS-Net / DIS model

`@imgly/background-removal-data`가 제공하는 `isnet_quint8` 모델의 공급자 고지는 원 프로젝트를 <https://github.com/xuebinqin/DIS>로 연결하고 라이선스를 MIT로 표시합니다. 반면 해당 업스트림 저장소의 `LICENSE.md`는 Apache License 2.0입니다. 또한 이 저장소는 배포된 quantized 가중치가 어느 학습 산출물에서 만들어졌는지 독립적으로 확인할 자료를 아직 확보하지 못했습니다.

따라서 PixelPet Studio는 공급자 고지를 그대로 보존하는 동시에 업스트림 Apache-2.0 고지도 보수적으로 함께 보존합니다. 이 표기는 라이선스 불일치가 해결되었다거나 모델 가중치의 권리 관계를 독립적으로 보증한다는 뜻이 아닙니다. 정확한 파일 해시와 확인해야 할 사항은 [MODEL_PROVENANCE.md](MODEL_PROVENANCE.md)에 기록합니다.

## ONNX Runtime Web

- Installed package: `onnxruntime-web` 1.21.0
- Data-package runtime declaration: `onnxruntime-web` 1.21.0-dev.20250206-d981b153d3
- Project: <https://github.com/microsoft/onnxruntime>
- License: MIT
- Copyright: Microsoft Corporation and contributors

ONNX Runtime은 자체 MIT 라이선스 외에도 빌드에 포함된 여러 제3자 구성 요소의 고지를 제공합니다. 배포 패키지는 사용한 버전에 해당하는 `LICENSE`와 `ThirdPartyNotices.txt` 전문을 보존해야 합니다.

## Electron and Chromium

- Electron 43.1.1: MIT
- Project: <https://github.com/electron/electron>
- Chromium and bundled Chromium components: 여러 오픈소스 라이선스

Electron 실행 파일과 함께 제공되는 `LICENSE` 및 `LICENSES.chromium.html`을 제거하지 않습니다. 설치 파일의 `legal` 폴더에서 두 원문을 확인할 수 있어야 합니다.

## React

- `react` 19.2.7: MIT
- `react-dom` 19.2.7: MIT
- `scheduler` 0.27.0: MIT
- Project: <https://github.com/facebook/react>
- Copyright: Meta Platforms, Inc. and affiliates

## Lucide

- `lucide-react` 0.525.0: ISC
- Project: <https://github.com/lucide-icons/lucide>
- Copyright: Lucide Icons and contributors

Lucide의 일부 아이콘은 Feather Icons에서 파생되었으며 해당 아이콘에는 Feather의 MIT 라이선스와 Cole Bemis의 저작권 고지가 함께 적용됩니다. 배포 패키지에는 `lucide-react/LICENSE` 전문을 포함해야 합니다.

## Other runtime packages

IMG.LY와 ONNX Runtime의 런타임 의존성에는 다음 패키지 등이 포함됩니다.

| Package | Version | License |
|---|---:|---|
| `lodash-es` | 4.18.1 | MIT |
| `ndarray` | 1.0.19 | MIT |
| `iota-array` | 1.0.0 | MIT |
| `is-buffer` | 1.1.6 | MIT |
| `zod` | 3.25.76 | MIT |
| `flatbuffers` | 25.9.23 | Apache-2.0 |
| `guid-typescript` | 1.0.9 | ISC |
| `long` | 5.3.2 | Apache-2.0 |
| `onnxruntime-common` | 1.21.0 | MIT |
| `platform` | 1.3.6 | MIT |
| `protobufjs` and its `@protobufjs/*` helpers | 7.6.5 | BSD-3-Clause |

실제 빌드의 잠금 파일과 설치된 패키지가 이 표보다 우선합니다. 버전을 올릴 때에는 자동 생성된 빌드별 라이선스 목록도 함께 갱신해야 합니다.

`guid-typescript` npm 패키지는 별도의 라이선스 파일을 포함하지 않고 package metadata에 ISC와 author `nicolas`만 선언합니다. 배포 legal 묶음에는 이 공급자 metadata, 표준 ISC 전문과 metadata에서 복원한 attribution을 함께 기록합니다.

## Project-created visual assets

프로젝트가 자체 제작한 예시 캐릭터, 스타일·포즈 레퍼런스, 앱 아이콘과 공개 샘플 이미지에는 코드 라이선스와 별도로 [ASSET_LICENSE.md](ASSET_LICENSE.md)가 적용됩니다. AI 생성 이미지의 저작권 성립 여부는 관할 법률과 제작 과정에 따라 달라질 수 있으므로, 프로젝트가 보유하거나 허락할 수 있는 권리 범위에서만 라이선스를 부여합니다.

사용자가 업로드한 이미지, 기관 마스코트, 로고, 상표 및 제3자 자료에는 이 저장소의 AGPL 또는 자산 라이선스가 적용되지 않습니다. 특히 RRA 파비 원본과 파생 이미지는 권리자의 명시적 허락 전에는 공개 배포 대상이 아닙니다.

## No warranty

이 고지는 법률 자문이 아닙니다. 재배포자는 자신의 배포 방식, 관할 지역, 수정 사항과 실제 포함 파일을 기준으로 각 라이선스 조건을 다시 확인해야 합니다.
