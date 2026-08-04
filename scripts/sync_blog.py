#!/usr/bin/env python3
"""
네이버 블로그(4dmixx) → 홈페이지 작업사례 자동 동기화

- RSS에서 최신 글 목록을 읽고
- 각 글의 대표 이미지(og:image)를 받아 최적화 저장
- assets/blog/posts.json 생성 → portfolio.html이 렌더링

GitHub Actions에서 매일 실행 (blog-sync.yml)
"""
import io
import json
import re
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

from PIL import Image

BLOG_ID = "4dmixx"
RSS_URL = f"https://rss.blog.naver.com/{BLOG_ID}.xml"
MAX_POSTS = 96
FETCH_POSTS = 200  # 필터 후 12개를 채우기 위해 넉넉히 조회
INCLUDE_KW = ["디오라마", "모형", "시제품", "전시"]
EXCLUDE_KW = ["이슈"]
OUT_DIR = Path(__file__).parent.parent / "assets" / "blog"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36"}


def fetch(url: str, referer: str | None = None) -> bytes:
    headers = dict(UA)
    if referer:
        headers["Referer"] = referer
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read()


SYNC_LOG = []

def og_image(post_url: str) -> str | None:
    """PostView 정적 페이지에서 og:image 추출 (iframe/JS 불필요)"""
    try:
        m = re.search(r"blog\.naver\.com/([^/]+)/(\d+)", post_url)
        if m:
            url = f"https://blog.naver.com/PostView.naver?blogId={m.group(1)}&logNo={m.group(2)}"
        else:
            url = post_url.replace("blog.naver.com", "m.blog.naver.com")
        html = fetch(url).decode("utf-8", "ignore")
        mm = re.search(r'og:image"[^>]*content="([^"]+)"', html) or \
             re.search(r'content="([^"]+)"[^>]*og:image', html) or \
             re.search(r'(https://postfiles\.pstatic\.net/[^"\s<>]+)', html) or \
             re.search(r'(https://blogfiles\.pstatic\.net/[^"\s<>]+)', html)
        if not mm:
            SYNC_LOG.append(f"no-og {post_url} (html {len(html)}b)")
            return None
        img = mm.group(1).replace("&amp;", "&")
        # postfiles 서버만 고해상도 파라미터 지원 — blogthumb는 원본 그대로
        if "postfiles.pstatic.net" in img:
            img = re.sub(r"\?type=w\d+", "?type=w773", img)
        return img
    except Exception as e:
        SYNC_LOG.append(f"err {post_url}: {type(e).__name__} {e}")
        return None


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    rss = fetch(RSS_URL)
    root = ET.fromstring(rss)
    all_items = root.findall(".//item")[:FETCH_POSTS]
    items = []
    for it in all_items:
        t = (it.findtext("title") or "")
        if any(k in t for k in EXCLUDE_KW):
            continue
        if not any(k in t for k in INCLUDE_KW):
            continue
        items.append(it)
        if len(items) >= MAX_POSTS:
            break
    print(f"RSS {len(all_items)}개 중 필터 통과 {len(items)}개")

    posts = []
    for i, item in enumerate(items):
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        pub = (item.findtext("pubDate") or "").strip()
        desc = re.sub(r"<[^>]+>", "", item.findtext("description") or "").strip()[:120]

        # 날짜 정리: "Tue, 04 Aug 2026 ..." → "2026.08.04"
        m = re.search(r"(\d{1,2}) (\w{3}) (\d{4})", pub)
        months = {"Jan":"01","Feb":"02","Mar":"03","Apr":"04","May":"05","Jun":"06",
                  "Jul":"07","Aug":"08","Sep":"09","Oct":"10","Nov":"11","Dec":"12"}
        date = f"{m.group(3)}.{months.get(m.group(2),'01')}.{int(m.group(1)):02d}" if m else ""

        img_rel = None
        img_url = og_image(link)
        if img_url:
            try:
                raw = fetch(img_url, referer=link)
                im = Image.open(io.BytesIO(raw)).convert("RGB")
                im.thumbnail((720, 720))
                img_rel = f"assets/blog/b{i:02d}.jpg"
                im.save(OUT_DIR / f"b{i:02d}.jpg", "JPEG", quality=80)
            except Exception as e:
                SYNC_LOG.append(f"img-dl {img_url[:80]}: {type(e).__name__} {e}")
                print("  이미지 저장 실패:", e)

        posts.append({"title": title, "link": link, "date": date,
                      "desc": desc, "img": img_rel})
        print(f"  [{i}] {title[:40]}")

    (OUT_DIR / "posts.json").write_text(
        json.dumps(posts, ensure_ascii=False, indent=1), encoding="utf-8")
    (OUT_DIR / "_sync_log.txt").write_text("\n".join(SYNC_LOG) or "all-ok", encoding="utf-8")
    print("posts.json 저장 완료")


if __name__ == "__main__":
    main()
