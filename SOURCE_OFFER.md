# Corresponding Source 제공 정책

PixelPet Studio 설치 파일과 포터블 실행 파일은 AGPL-3.0 구성 요소를 포함한 결합 저작물입니다. 바이너리를 인터넷에서 배포할 때에는 같은 다운로드 위치에서 추가 비용 없이 해당 바이너리의 완전한 Corresponding Source를 받을 수 있게 해야 합니다.

이 문서는 릴리스 운영 정책입니다. 각 설치 파일 안에는 빌드 시 자동 생성된 `SOURCE_OFFER.txt`와 `BUILD_PROVENANCE.json`이 별도로 들어가며, 그 파일이 정확한 버전과 커밋을 가리켜야 합니다.

## 공개 릴리스 필수 조건

릴리스 담당자는 바이너리를 공개하기 전에 다음 항목을 모두 확인합니다.

1. 바이너리를 만든 Git commit이 공개 저장소에 push되어 있다.
2. 변경되지 않는 tag가 그 commit을 가리킨다.
3. GitHub Release의 바이너리 바로 옆에 정확한 소스 archive 링크가 있다.
4. 소스에는 앱 코드, 잠금 파일, 패치, 인터페이스 정의, 빌드·설치 스크립트와 수정에 필요한 설정이 포함된다.
5. 빌드가 내려받는 IMG.LY 데이터 패키지의 정확한 버전, URL, 파일 해시와 라이선스가 기록되어 있다.
6. 배포된 모델·WASM 자산을 같은 상태로 다시 얻을 수 있도록 정확한 패키지 archive 또는 동등한 무상 다운로드 경로를 유지한다.
7. 루트 `LICENSE`, `THIRD_PARTY_NOTICES.md`, 모델 provenance 및 제3자 원문 라이선스가 바이너리와 소스 양쪽에 포함된다.
8. 앱의 법적 고지 화면에서 라이선스, 무보증 안내와 소스 위치를 쉽게 열 수 있다.

하나라도 충족하지 못하면 해당 바이너리를 공개하지 않습니다.

## 공식 소스 위치

- Repository: <https://github.com/obundh/korean-pixel-pet-studio>
- Release list: <https://github.com/obundh/korean-pixel-pet-studio/releases>
- License: <https://github.com/obundh/korean-pixel-pet-studio/blob/main/LICENSE>

릴리스별 정확한 소스 URL은 다음 형식을 사용합니다.

```text
https://github.com/obundh/korean-pixel-pet-studio/archive/<FULL_GIT_COMMIT>.zip
```

`<FULL_GIT_COMMIT>`은 설치 파일 안의 `BUILD_PROVENANCE.json`에 기록된 40자리 commit으로 치환합니다. `main`처럼 이동할 수 있는 branch URL만 제공해서는 안 됩니다.

## 보관 기간

프로젝트는 해당 바이너리를 배포하는 동안 소스 archive를 계속 제공하며, 서면 제공 방식을 선택한 릴리스가 있다면 AGPL 제6조가 요구하는 기간보다 짧게 보관하지 않습니다. 공개 다운로드 방식은 바이너리와 소스에 동등한 접근을 제공하는 AGPL 제6조(d)를 기본으로 합니다.

## 수정판과 포크

수정한 바이너리를 재배포하는 사람은 자신의 정확한 Corresponding Source를 제공해야 합니다. 원본 저장소 링크만으로 수정판의 소스 제공 의무를 대신할 수 없습니다. 원격 네트워크를 통해 수정판과 상호작용하게 하는 경우에는 AGPL 제13조에 따라 그 수정판의 소스를 받을 수 있는 눈에 띄는 링크도 제공해야 합니다.

## 비상업 목적에 대한 설명

관리자는 이 프로젝트를 판매하지 않고 다른 사람의 학습과 제작을 돕기 위해 공개합니다. 그러나 이는 AGPL 권리에 “비상업 전용” 조건을 추가하지 않습니다. 누구든 AGPL과 제3자 라이선스 조건을 지키는 범위에서 프로젝트를 사용·수정·재배포할 수 있습니다.
