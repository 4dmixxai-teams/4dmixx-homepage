# 4DMIXX 홈페이지

3D프린팅·프로토타입·사출·CNC·레이저커팅 제작소 **4DMIXX** 공식 홈페이지.
정적 사이트 + 브라우저 기반 3D 자동견적 프로그램(STL/OBJ) 포함.

## 구조

```
├── index.html          # 메인 (3D 자동견적 포함)
├── services.html       # 서비스 상세
├── portfolio.html      # 작업사례
├── contact.html        # 견적 문의
├── css/
│   ├── style.css       # 공통 스타일
│   └── quote.css       # 견적 프로그램 스타일
├── js/
│   ├── main.js         # 문의 폼 처리
│   └── quote.js        # 3D 뷰어 + 견적 계산 (★ 상단 PRICING에서 단가 수정)
├── CNAME               # 커스텀 도메인 (★ 실제 도메인으로 수정)
├── deploy.sh           # 원클릭 배포 스크립트
└── .github/workflows/deploy.yml  # 푸시 시 자동 배포
```

## 배포 (GitHub Pages, 무료)

### 자동 (권장)
```bash
# 1. CNAME 파일을 실제 도메인으로 수정
echo "4dmixx.co.kr" > CNAME

# 2. 실행
bash deploy.sh
```

### 수동
```bash
git init -b main
git add -A
git commit -m "deploy: 4DMIXX homepage"
git remote add origin https://github.com/4dmixxai-teams/4dmixx-homepage.git
git push -u origin main
```
→ 리포 **Settings > Pages > Source**에서 `GitHub Actions` 선택.
이후에는 main에 푸시할 때마다 자동 배포됩니다.

### DNS 설정 (도메인 구입처에서 1회)
| 유형 | 호스트 | 값 |
|---|---|---|
| A | @ | 185.199.108.153 |
| A | @ | 185.199.109.153 |
| A | @ | 185.199.110.153 |
| A | @ | 185.199.111.153 |
| CNAME | www | 4dmixxai-teams.github.io |

DNS 반영(수분~수시간) 후 **Settings > Pages**에서 `Enforce HTTPS` 체크.

## 배포 전 체크리스트

- [ ] `CNAME` — 실제 도메인으로 수정
- [ ] `js/quote.js` — 상단 `PRICING` 객체를 실제 단가로 수정
- [ ] `contact.html` — 전화번호, 상세주소 입력
- [ ] `js/main.js` — Formspree 연동 시 `FORM_ENDPOINT` 입력 (미설정 시 메일 앱으로 대체 동작)
