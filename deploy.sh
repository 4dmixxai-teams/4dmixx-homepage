#!/usr/bin/env bash
# ============================================================
# 4DMIXX 홈페이지 — GitHub Pages 배포 스크립트
#
# 사용법:
#   1) CNAME 파일을 실제 도메인으로 수정 (예: 4dmixx.co.kr)
#   2) 아래 REPO 값을 확인/수정
#   3) bash deploy.sh
#
# 사전 조건: git 설치, gh CLI 로그인 (gh auth login)
#            gh가 없으면 스크립트가 안내하는 수동 절차를 따르세요.
# ============================================================
set -euo pipefail

ORG="4dmixxai-teams"
REPO="4dmixx-homepage"
BRANCH="main"

echo "== 4DMIXX 홈페이지 배포 =="

# 도메인 확인
DOMAIN=$(cat CNAME | tr -d '[:space:]')
echo "커스텀 도메인: ${DOMAIN}"
read -p "이 도메인이 맞습니까? (y/n) " ok
[[ "$ok" == "y" ]] || { echo "CNAME 파일을 수정한 뒤 다시 실행하세요."; exit 1; }

# git 초기화
if [ ! -d .git ]; then
  git init -b "$BRANCH"
fi
git add -A
git commit -m "deploy: 4DMIXX homepage" || echo "(변경사항 없음 — 계속 진행)"

# 리포지토리 생성 & 푸시
if command -v gh &> /dev/null; then
  if ! gh repo view "${ORG}/${REPO}" &> /dev/null; then
    echo "리포지토리 생성 중: ${ORG}/${REPO}"
    gh repo create "${ORG}/${REPO}" --public --source=. --push
  else
    git remote get-url origin &> /dev/null || git remote add origin "https://github.com/${ORG}/${REPO}.git"
    git push -u origin "$BRANCH"
  fi

  # GitHub Pages 활성화 (GitHub Actions 소스)
  echo "GitHub Pages 활성화 중..."
  gh api -X POST "repos/${ORG}/${REPO}/pages" \
    -f build_type=workflow 2>/dev/null \
    || gh api -X PUT "repos/${ORG}/${REPO}/pages" -f build_type=workflow 2>/dev/null \
    || echo "(Pages가 이미 활성화되어 있거나, 첫 워크플로우 실행 후 자동 활성화됩니다)"

  echo ""
  echo "✅ 푸시 완료! Actions 탭에서 배포 진행 상황을 확인하세요:"
  echo "   https://github.com/${ORG}/${REPO}/actions"
else
  echo ""
  echo "gh CLI가 없습니다. 수동 절차:"
  echo "  1) https://github.com/new 에서 ${ORG}/${REPO} 리포 생성"
  echo "  2) git remote add origin https://github.com/${ORG}/${REPO}.git"
  echo "  3) git push -u origin ${BRANCH}"
  echo "  4) 리포 Settings > Pages > Source: 'GitHub Actions' 선택"
fi

echo ""
echo "== 도메인 DNS 설정 (도메인 구입처에서 1회만) =="
echo "  [루트 도메인용 A 레코드 4개]"
echo "    ${DOMAIN}  A  185.199.108.153"
echo "    ${DOMAIN}  A  185.199.109.153"
echo "    ${DOMAIN}  A  185.199.110.153"
echo "    ${DOMAIN}  A  185.199.111.153"
echo "  [www 서브도메인용 CNAME]"
echo "    www.${DOMAIN}  CNAME  ${ORG}.github.io"
echo ""
echo "DNS 반영 후 리포 Settings > Pages 에서 'Enforce HTTPS' 체크하면 끝!"
