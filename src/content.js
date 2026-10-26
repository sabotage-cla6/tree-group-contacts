chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "INSERT_GUESTS") {
    insertGuests(request.emails).then(count => {
      sendResponse({ success: count > 0, count: count });
    }).catch(() => sendResponse({ success: false, count: 0 }));
    return true;
  }

  if (request.action === "COPY_GUESTS") {
    const emails = extractGuestsFromPage();
    sendResponse({ emails: emails });
    return true;
  }
});

// Googleカレンダーの簡易作成画面・通常画面・予定の詳細編集画面に対応してゲストを追加する。
async function insertGuests(emails) {
  const uniqueEmails = Array.from(new Set((emails || []).map(extractEmailAddress).filter(isValidEmailOrCalendarId)));
  if (uniqueEmails.length === 0) return 0;

  const guestInput = findGuestInputElement();
  if (!guestInput) return 0;

  // 詳細ダイアログ内で開始した場合、入力後も同じダイアログだけを扱う。
  const editorDialog = guestInput.closest('[role="dialog"]');
  if (editorDialog && (!editorDialog.isConnected || !isVisibleElement(editorDialog))) return 0;

  // Google カレンダーのゲスト欄はカンマ区切りのアドレスをまとめて受け付けるため、
  // 1件ずつ入力・確定せず、選択されたアドレスを一度に入力して確定する。
  const batchValue = uniqueEmails.join("\r\n");
  guestInput.focus();
  setInputValue(guestInput, batchValue);
  guestInput.dispatchEvent(new InputEvent("input", {
    bubbles: true,
    inputType: "insertText",
    data: batchValue
  }));
  guestInput.dispatchEvent(new Event("change", { bubbles: true }));

  await sleep(500);
  if (editorDialog && (!editorDialog.isConnected || !isVisibleElement(editorDialog))) return 0;

  guestInput.dispatchEvent(new KeyboardEvent("keydown", {
    key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true
  }));
  guestInput.dispatchEvent(new KeyboardEvent("keyup", {
    key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true
  }));

  await sleep(500);

  // 入力欄がクリアされたか、入力値が変化した場合はカレンダー側が確定処理を行ったとみなす。
  // 一括入力では入力欄が残る画面もあるため、Enter送信後は一括処理した件数を返す。
  return guestInput.value === "" || guestInput.value !== batchValue ? uniqueEmails.length : 0;
}

function setInputValue(input, value) {
  // React等の制御された入力欄でも変更を検知できるよう、ネイティブsetterを使う。
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
}

function isVisibleElement(el) {
  return Boolean(el && (el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0));
}

// 予定のタイトル欄などに誤入力しないよう、ゲスト欄として識別できる入力欄だけを対象にする。
// トップ画面の簡易作成欄では、提示されたDOMの div[jsname="ZKadSc"] がゲスト入力領域を示す。
function findGuestInputElement(scope = null) {
  const selectors = [
    ['div[jsname="ZKadSc"] input[aria-label="ユーザーを検索"]', 150],
    ['input[aria-label="ゲストを追加"]', 120],
    ['input[aria-label="Add guests"]', 120],
    ['input[placeholder*="ゲストを追加"]', 110],
    ['input[placeholder*="Add guests"]', 110],
    ['div[data-aria-label="ゲストを追加"] input', 105],
    ['input[aria-label="ユーザーを検索"]', 95],
    ['input.Fgl6fe-fmcmS-wGMbrd', 80],
    ['input[jsname="YPqjbf"]', 75]
  ];

  const candidates = new Map();
  const searchRoot = scope || document;
  selectors.forEach(([selector, score]) => {
    searchRoot.querySelectorAll(selector).forEach(el => {
      if (!isVisibleElement(el) || isClearlyNotGuestInput(el)) return;

      // 汎用的なGoogleカレンダーの入力欄は、予定編集領域にある場合だけ候補にする。
      const isTopPageGuestField = Boolean(el.matches('div[jsname="ZKadSc"] input[aria-label="ユーザーを検索"]'));
      const isSpecificGuestField = isTopPageGuestField || /ゲストを追加|add guests/i.test([
        el.getAttribute('aria-label') || '',
        el.getAttribute('placeholder') || '',
        el.parentElement?.getAttribute('data-aria-label') || ''
      ].join(' '));
      const inDialog = Boolean(el.closest('[role="dialog"]'));
      const inEventEditor = Boolean(el.closest('[data-eventid], [role="dialog"], [aria-label*="予定"], [aria-label*="event"]'));
      const isFocused = el === document.activeElement;

      if (!isSpecificGuestField && !inEventEditor && !inDialog && !isFocused) return;

      const nextScore = score + (isFocused ? 200 : 0) + (inDialog ? 20 : 0);
      candidates.set(el, Math.max(candidates.get(el) || 0, nextScore));
    });
  });

  return Array.from(candidates.entries())
    .sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

function isClearlyNotGuestInput(el) {
  const label = [
    el.getAttribute('aria-label'),
    el.getAttribute('placeholder'),
    el.getAttribute('name'),
    el.getAttribute('data-placeholder')
  ].filter(Boolean).join(' ').toLowerCase();

  return /タイトル|title|場所|location|説明|description|検索カレンダー|search calendar/.test(label);
}

// 入力したメールアドレスと一致する候補を探し、候補選択でユーザーを確定する。
function findEmailSuggestion(email) {
  const normalizedEmail = email.toLowerCase();
  const selectors = [
    '[role="option"]',
    '[role="listbox"] [data-email]',
    '[role="listbox"] [data-hovercard-id]',
    '[role="listbox"] li'
  ];
  const candidates = new Set();
  selectors.forEach(selector => {
    document.querySelectorAll(selector).forEach(el => {
      if (isVisibleElement(el)) candidates.add(el);
    });
  });

  for (const candidate of candidates) {
    const candidateEmail = (
      candidate.getAttribute("data-email") ||
      candidate.getAttribute("data-hovercard-id") ||
      ""
    ).toLowerCase();
    const text = (candidate.innerText || candidate.textContent || "").toLowerCase();
    if (candidateEmail === normalizedEmail || text.includes(normalizedEmail)) {
      return candidate.closest('[role="option"]') || candidate;
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

function extractEmailAddress(value) {
  const entry = String(value || "").trim();
  const match = entry.match(/^(?:"((?:\\.|[^"\\])*)"|([^<>"]+?))\s*<([^<>]+)>$/);
  return match ? match[3].trim() : entry;
}

function isValidEmailOrCalendarId(str) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}