# Windows 설치하기

이 문서는 Windows 10 또는 Windows 11 64비트 사용자를 위한 안내입니다. 설치에 명령 프롬프트나 개발 도구가 필요하지 않습니다.

## 1. 공식 설치 파일 받기

1. 웹 브라우저에서 [PixelPet Studio 최신 릴리스](https://github.com/obundh/korean-pixel-pet-studio/releases/latest)를 엽니다.
2. 페이지 아래쪽의 **Assets**를 펼칩니다.
3. 다음 중 하나를 받습니다.

| 파일 | 차이 | 추천 |
|---|---|---|
| `PixelPet-Studio-Setup-...-x64.exe` | 설치 폴더와 시작 메뉴 바로가기를 만듭니다. | 계속 사용할 때 |
| `PixelPet-Studio-Portable-...-x64.exe` | 설치하지 않고 파일을 바로 실행합니다. | 먼저 시험할 때 |

`blockmap`, `latest.yml`, 소스 코드 ZIP은 일반 사용자가 실행하는 파일이 아닙니다.

## 2-A. Setup 버전 설치

1. 다운로드한 `PixelPet-Studio-Setup-...-x64.exe`를 두 번 클릭합니다.
2. Windows가 보호했다는 파란 창이 나오면 아래의 [SmartScreen 확인](#windows-smartscreen이-나오면)을 먼저 읽습니다.
3. 설치 위치를 확인하고 **설치**를 누릅니다.
4. 설치가 끝나면 **PixelPet Studio 실행**을 선택합니다.

정상이라면 PixelPet Studio의 검은색 작업 화면과 왼쪽 1~5단계 메뉴가 나타납니다.

## 2-B. Portable 버전 실행

1. 다운로드한 `PixelPet-Studio-Portable-...-x64.exe`를 찾습니다.
2. 필요하면 `문서/PixelPet Studio` 같은 보관 폴더로 옮깁니다.
3. 파일을 두 번 클릭합니다.

Portable 파일을 삭제하면 앱도 사라지지만, 별도로 저장한 `.pixelpet` 프로젝트 파일은 남습니다.

## Windows SmartScreen이 나오면

현재 공개 빌드는 Microsoft 코드 서명 인증서로 서명되지 않아 “Windows의 PC 보호”가 보일 수 있습니다.

1. 파일을 이 저장소의 공식 Releases에서 받았는지 주소를 다시 확인합니다.
2. 경고 창에서 **추가 정보**를 누릅니다.
3. 표시된 앱 이름이 PixelPet Studio인지 확인합니다.
4. 출처를 확인한 경우에만 **실행**을 누릅니다.

출처가 다른 파일이거나 이름이 이상하면 실행하지 말고 삭제하세요. Windows Defender나 SmartScreen 전체를 끄지 마세요.

## 3. 첫 실행 확인

앱이 열리면 다음 순서로 간단히 확인합니다.

1. 위쪽에 프로젝트 이름 입력란이 보이는지 확인합니다.
2. 왼쪽에 **생성 가이드**, **프레임 가져오기**, **배경 제거**, **움직임 확인**, **펫 완성**이 보이는지 확인합니다.
3. [처음 시작하기의 3분 샘플](../../START_HERE.md#a-3분-샘플-실행)을 따라갑니다.

## 저장 위치 권장

`문서/PixelPet Studio` 폴더를 만들고 다음처럼 정리하면 찾기 쉽습니다.

```text
문서/PixelPet Studio/
├── 원본-이미지/
├── 생성-프레임/
└── 프로젝트/
```

`.pixelpet` 파일은 **프로젝트** 폴더에 저장하세요.

## 삭제하기

- Setup 버전: Windows **설정 → 앱 → 설치된 앱 → PixelPet Studio → 제거**
- Portable 버전: 실행 파일을 닫은 뒤 해당 EXE 파일 삭제

프로젝트와 내보낸 PNG는 자동으로 삭제되지 않습니다.

설치가 안 되거나 창이 열리지 않으면 [문제해결](TROUBLESHOOTING.md)을 확인하세요.
