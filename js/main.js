// ============================================================
// 4DMIXX — 문의 폼 제출 처리
//
// 현재는 실제 이메일 전송 기능이 연결되어 있지 않습니다.
// 배포 시 아래 방법 중 하나를 선택해 연결해 주세요.
//
//  방법 1) Formspree (https://formspree.io) 무료 플랜 사용
//    - Formspree에서 폼을 만들고 발급받은 endpoint를
//      FORM_ENDPOINT 값에 붙여넣기만 하면 바로 동작합니다.
//
//  방법 2) 자체 백엔드(API) 연결
//    - FORM_ENDPOINT를 자체 서버 API 주소로 변경하세요.
//
// 별도 설정 전까지는 mailto 링크로 자동 대체됩니다.
// ============================================================

const FORM_ENDPOINT = ""; // 예: "https://formspree.io/f/xxxxxxx"

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("quote-form");
  if (!form) return;

  const statusEl = document.getElementById("form-status");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = new FormData(form);

    if (!FORM_ENDPOINT) {
      // FORM_ENDPOINT 미설정 시: 메일 클라이언트로 대체 전송
      const subject = encodeURIComponent(`[견적문의] ${data.get("name")}`);
      const body = encodeURIComponent(
        `이름/회사명: ${data.get("name")}\n` +
        `연락처: ${data.get("phone")}\n` +
        `이메일: ${data.get("email")}\n` +
        `문의 유형: ${data.get("process")}\n\n` +
        `문의 내용:\n${data.get("message")}`
      );
      window.location.href = `mailto:contact@4dmixx.com?subject=${subject}&body=${body}`;
      showStatus("메일 앱으로 연결합니다. 내용을 확인하고 전송해 주세요.", "ok");
      return;
    }

    try {
      const res = await fetch(FORM_ENDPOINT, {
        method: "POST",
        headers: { Accept: "application/json" },
        body: data,
      });
      if (res.ok) {
        form.reset();
        showStatus("문의가 접수되었습니다. 빠르게 연락드리겠습니다.", "ok");
      } else {
        showStatus("전송에 실패했습니다. 이메일로 다시 시도해 주세요.", "err");
      }
    } catch (err) {
      showStatus("전송 중 오류가 발생했습니다. 이메일로 문의해 주세요.", "err");
    }
  });

  function showStatus(msg, type) {
    statusEl.textContent = msg;
    statusEl.className = `form-status show ${type}`;
  }
});
