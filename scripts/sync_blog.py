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
MAX_POSTS = 12
OUT_DIR = Path(__file__).parent.parent / "assets" / "blog"
UA = {"User-Agent": "Mozilla/5.0 (compatible; 4dmixx-homepage-sync)"}


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read()


def og_image(post_url: str) -> str | None:
    """글 페이지에서 대표 이미지(og:image) 추출"""
    try:
        html = fetch(post_url).decode("utf-8", "ignore")
        m = re.search(r'property="og:image"\s+content="([^"]+)"', html)
        if not m:
            m = re.search(r'content="([^"]+)"\s+property="og:image"', html)
        return m.group(1).replace("&amp;", "&") if m else None
    except Exception as e:
        print("  og:image 실패:", e)
        return None


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    rss = fetch(RSS_URL)
    root = ET.fromstring(rss)
    items = root.findall(".//item")[:MAX_POSTS]
    print(f"RSS 글 {len(items)}개")

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
                raw = fetch(img_url)
                im = Image.open(io.BytesIO(raw)).convert("RGB")
                im.thumbnail((720, 720))
                img_rel = f"assets/blog/b{i:02d}.jpg"
                im.save(OUT_DIR / f"b{i:02d}.jpg", "JPEG", quality=80)
            except Exception as e:
                print("  이미지 저장 실패:", e)

        posts.append({"title": title, "link": link, "date": date,
                      "desc": desc, "img": img_rel})
        print(f"  [{i}] {title[:40]}")

    (OUT_DIR / "posts.json").write_text(
        json.dumps(posts, ensure_ascii=False, indent=1), encoding="utf-8")
    print("posts.json 저장 완료")


if __name__ == "__main__":
    main()
