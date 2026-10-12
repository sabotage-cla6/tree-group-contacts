chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "INSERT_GUESTS") {
    insertGuests(request.emails).then(count => {
      sendResponse({ success: count > 0, count: count });
    });
    return true;
  }

  if (request.action === "COPY_GUESTS") {
    const emails = extractGuestsFromPage();
    sendResponse({ emails: emails });
    return true;
  }
});

// カレンダーにゲストを一括挿入（トップページの簡易モーダル＆詳細編集画面の両方に対応）
async function insertGuests(emails) {
  const guestInput = findGuestInputElement();
  if (!guestInput) return 0;

  let insertedCount = 0;

  for (const email of emails) {
    guestInput.focus();
    guestInput.value = email;

    // Google UIのデータバインディングを認識させるためのイベント発火
    guestInput.dispatchEvent(new Event("input", { bubbles: true }));
    guestInput.dispatchEvent(new Event("change", { bubbles: true }));

    await sleep(200);

    // Enterキーを押下して決定
    const enterEvent = new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true
    });
    guestInput.dispatchEvent(enterEvent);

    await sleep(300);
    insertedCount++;
  }

  return insertedCount;
}

// カレンダー上のゲスト入力欄を検出（トップページの「ユーザーを検索」・詳細画面の「ゲストを追加」に対応）
function findGuestInputElement() {
  const selectors = [
    // --- 1. トップページ簡易ダイアログ用の入力欄 ---
    'input[aria-label="ユーザーを検索"]',
    'input.Fgl6fe-fmcmS-wGMbrd',
    'input[jsname="YPqjbf"]',
    'div[role="dialog"] input[aria-label="ユーザーを検索"]',
    
    // --- 2. 詳細編集画面および既存の各種ゲスト入力欄 ---
    'input[aria-label="ゲストを追加"]',
    'input[placeholder*="ゲストを追加"]',
    'input[aria-label="Add guests"]',
    'input[placeholder*="Add guests"]',
    'div[data-aria-label="ゲストを追加"] input',
    'div[role="dialog"] input[aria-label="ゲストを追加"]',
    'div[role="dialog"] input[aria-label="Add guests"]',
    'input[type="email"]'
  ];

  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el && (el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0)) {
      return el;
    }
  }
  return null;
}

// 画面上に設定されているゲストアドレスの抽出
function extractGuestsFromPage() {
  const emails = new Set();

  // 1. トップページの簡易ダイアログ「選択中のユーザー」コンテナ（ご提示いただいたDOM構成）
  const topPageContainers = document.querySelectorAll(
    'div[aria-label="選択中のユーザー"], div.PnGFPb, div[jsname="ur2O4b"]'
  );

  topPageContainers.forEach(container => {
    const items = container.querySelectorAll('[data-email], [data-hovercard-id]');
    items.forEach(el => {
      const email = el.getAttribute("data-email") || el.getAttribute("data-hovercard-id");
      if (email && isValidEmailOrCalendarId(email)) {
        emails.add(email);
      }
    });
  });

  // 2. 詳細編集画面および既存の確定済みゲストリストコンテナ
  const detailContainers = document.querySelectorAll(
    'div[aria-label="ゲスト"], div[aria-label="Guests"], div[role="list"][aria-label*="ゲスト"], div[role="list"][aria-label*="Guests"]'
  );

  detailContainers.forEach(container => {
    const items = container.querySelectorAll('[data-email], [data-hovercard-id], [data-chip-value]');
    items.forEach(el => {
      const email = el.getAttribute("data-email") || el.getAttribute("data-hovercard-id") || el.getAttribute("data-chip-value");
      if (email && isValidEmailOrCalendarId(email)) {
        emails.add(email);
      }
    });
  });

  // 3. 上記で取得できない場合のフォールバック（サジェスト候補枠のみを弾いて取得）
  if (emails.size === 0) {
    const allEmailNodes = document.querySelectorAll('[data-email], [data-hovercard-id]');
    allEmailNodes.forEach(el => {
      // 「選択中のユーザー」以外の未決定のサジェスト候補リスト（listbox/option）はスキップ
      const isSuggestionCandidate = el.closest('[role="listbox"]') && !el.closest('[aria-label="選択中のユーザー"]');
      if (isSuggestionCandidate) return;

      const email = el.getAttribute("data-email") || el.getAttribute("data-hovercard-id");
      if (email && isValidEmailOrCalendarId(email)) {
        emails.add(email);
      }
    });
  }

  return Array.from(emails);
}

function isValidEmailOrCalendarId(str) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}