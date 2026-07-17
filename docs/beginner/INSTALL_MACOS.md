# macOS 설치하기

이 문서는 macOS 사용자를 위한 안내입니다. 먼저 내 Mac이 Apple Silicon인지 Intel인지 확인해야 합니다.

## 1. 내 Mac 종류 확인

1. 화면 왼쪽 위의 Apple 메뉴 ****를 누릅니다.
2. **이 Mac에 관하여**를 누릅니다.
3. 다음 항목을 확인합니다.

| 표시 내용 | 받을 파일 |
|---|---|
| 칩 이름이 Apple M으로 시작함 | 이름에 `arm64.dmg`가 있는 파일 |
| 프로세서: Intel | 이름에 `x64.dmg`가 있는 파일 |

잘못된 종류를 받으면 앱이 열리지 않거나 Rosetta 안내가 나올 수 있습니다.

## 2. 공식 DMG 받기

1. [PixelPet Studio 최신 릴리스](https://github.com/obundh/korean-pixel-pet-studio/releases/latest)를 엽니다.
2. 페이지 아래의 **Assets**를 펼칩니다.
3. 내 Mac 종류에 맞는 `PixelPet-Studio-...-arm64.dmg` 또는 `PixelPet-Studio-...-x64.dmg`를 받습니다.

ZIP 파일도 제공될 수 있지만, 처음 설치할 때는 DMG가 더 쉽습니다.

## 3. Applications 폴더에 넣기

1. 받은 DMG를 두 번 클릭합니다.
2. 열린 창의 PixelPet Studio 아이콘을 **Applications** 폴더로 드래그합니다.
3. 복사가 끝나면 Finder 왼쪽의 **응용 프로그램**을 엽니다.
4. PixelPet Studio를 찾습니다.

DMG 안에서 계속 실행하지 말고 응용 프로그램 폴더로 복사한 앱을 사용하세요.

## 4. 서명되지 않은 앱 열기

현재 공개 빌드는 Apple Developer ID로 서명되지 않아 처음 두 번 클릭했을 때 차단될 수 있습니다.

1. **응용 프로그램**에서 PixelPet Studio를 찾습니다.
2. 앱을 Control-클릭하거나 마우스 오른쪽 버튼으로 누릅니다.
3. 메뉴에서 **열기**를 선택합니다.
4. 다시 표시된 창에서 **열기**를 누릅니다.

macOS 버전에 따라 **시스템 설정 → 개인정보 보호 및 보안** 아래쪽에 **확인 없이 열기**가 나타날 수도 있습니다. 반드시 공식 Releases에서 받은 앱인지 확인한 뒤 사용하세요.

Gatekeeper 전체를 끄거나 출처를 모르는 명령을 터미널에 입력하지 마세요.

## 5. 첫 실행 확인

정상이라면 검은색 PixelPet Studio 화면과 왼쪽 1~5단계 메뉴가 나타납니다.

1. **생성 가이드** 화면이 표시되는지 확인합니다.
2. 위쪽의 **불러오기**, **저장** 버튼이 보이는지 확인합니다.
3. [처음 시작하기의 3분 샘플](../../START_HERE.md#a-3분-샘플-실행)을 따라갑니다.

## 저장 위치 권장

Finder의 `문서` 폴더에 `PixelPet Studio` 폴더를 만들고 원본, 생성 이미지, 프로젝트를 나누어 보관하세요. `.pixelpet` 파일에는 원본과 배경 제거 결과가 함께 들어가므로 파일 크기가 커질 수 있습니다.

## 삭제하기

1. PixelPet Studio와 실행 중인 데스크톱 펫을 닫습니다.
2. **응용 프로그램**의 PixelPet Studio를 휴지통으로 옮깁니다.

별도로 저장한 `.pixelpet` 프로젝트와 PNG는 자동으로 삭제되지 않습니다.

앱이 차단되거나 화면이 보이지 않으면 [문제해결](TROUBLESHOOTING.md)을 확인하세요.
