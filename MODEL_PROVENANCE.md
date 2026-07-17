# Background-removal model provenance

이 문서는 PixelPet Studio가 배경 제거에 사용하는 모델 파일의 공급 경로와 현재 확인 한계를 기록합니다.

## Bundled model

- Runtime name: `isnet_quint8`
- Supplier package: `@imgly/background-removal-data` 1.7.0
- Package archive: <https://staticimgly.com/@imgly/background-removal-data/1.7.0/package.tgz>
- Runtime manifest path: `/models/isnet_quint8`
- Reconstructed model size: 44,348,940 bytes
- Reconstructed model SHA-256: `d1ca3535c21b53d08fa3b640e5949389f82e764f6376a0502d44982c35cae482`
- Hash verification date: 2026-07-16

위 해시는 `resources.json`에 적힌 순서대로 모델 chunk 11개를 이어 붙인 배포 파일 기준입니다. 릴리스 빌드가 다른 해시를 만들면 이 기록을 그대로 재사용하지 말고 새 package version, URL과 해시를 기록해야 합니다.

## License records

IMG.LY가 package에 포함한 `ThirdPartyLicenses.json`은 다음과 같이 선언합니다.

```json
{
  "ISNET": {
    "source": "https://github.com/xuebinqin/DIS",
    "type": "model",
    "license": "MIT"
  }
}
```

그러나 연결된 DIS 저장소의 2026-07-16 `main` HEAD는 `b6764e20381f6f42a70f83fa3324181529ed1403`이며, 그 저장소의 `LICENSE.md`는 Apache License 2.0 전문입니다.

## Current handling and unresolved point

PixelPet Studio는 다음과 같이 보수적으로 처리합니다.

1. IMG.LY package의 AGPL-3.0 라이선스와 공급자 제3자 고지를 그대로 보존합니다.
2. DIS 업스트림의 Apache-2.0 라이선스 고지도 함께 보존합니다.
3. 모델 파일과 package archive의 버전·URL·해시를 빌드 provenance에 기록합니다.
4. IMG.LY 또는 모델 권리자로부터 정확한 quantized 가중치의 생성 경로와 라이선스를 확인할 수 있다면 이 문서를 갱신합니다.

현재 공개 자료만으로는 배포된 quantized 가중치가 어떤 checkpoint에서 파생되었는지, 공급자 고지의 MIT와 업스트림 Apache-2.0 표기가 왜 다른지 독립적으로 확정하지 못했습니다. 따라서 이 문서는 권리 정리가 완료되었다는 보증이 아닙니다. 외부 조직에 재배포하거나 위험도가 높은 배포를 하기 전에는 공급자에게 서면 확인을 받는 것이 안전합니다.
