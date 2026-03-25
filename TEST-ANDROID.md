# 안드로이드에서 테스트하기

## 1. PC에서 서버 실행

**같은 Wi‑Fi**에 PC와 안드로이드가 연결되어 있어야 합니다.

### 방법 A: Node.js가 있는 경우
```bash
cd vampire-survivor-mini-m
npx serve -l 3000
```

### 방법 B: Python이 있는 경우
```bash
cd vampire-survivor-mini-m
python -m http.server 3000
```

### 방법 C: VS Code 사용 시
- **Live Server** 확장 설치 후, `index.html`에서 우클릭 → "Open with Live Server"

---

## 2. PC IP 주소 확인

- **Windows (CMD):** `ipconfig` → "IPv4 주소" 확인 (예: 192.168.0.10)
- **Windows (PowerShell):** `Get-NetIPAddress -AddressFamily IPv4` 에서 로컬 주소 확인

---

## 3. 안드로이드에서 접속

1. 안드로이드 기기를 **PC와 같은 Wi‑Fi**에 연결
2. **Chrome** 실행
3. 주소창에 입력: `http://<PC의_IP>:3000`  
   예: `http://192.168.0.10:3000`
4. **시작하기** 버튼을 눌러 게임 실행 (첫 터치 시 소리 활성화)

---

## 4. PC에서만 안드로이드 화면으로 테스트 (에뮬레이션)

1. PC Chrome에서 `http://localhost:3000` (또는 사용 중인 주소) 로 접속
2. **F12** → 상단 **디바이스 툴바** 아이콘 클릭 (또는 `Ctrl+Shift+M`)
3. 기기 목록에서 "Pixel 5" 등 안드로이드 기기 선택
4. 새로고침 후 터치/조이스틱 동작 확인

---

## 문제 해결

| 현상 | 확인 사항 |
|------|-----------|
| 접속 안 됨 | PC 방화벽에서 **3000 포트** 허용, PC와 폰이 같은 Wi‑Fi인지 확인 |
| 소리 안 남 | 반드시 **시작하기** 버튼을 터치한 뒤에만 소리 재생 (브라우저 정책) |
| 화면 잘림 | 주소창 숨김: Chrome 메뉴 → "홈 화면에 추가" 후 앱처럼 실행 |
