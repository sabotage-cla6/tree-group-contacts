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
  const uniqueEmails = Array.from(new Set((emails || []).filter(isValidEmailOrCalendarId)));
  let insertedCount = 0;
  const initialGuestInput = findGuestInputElement();
  if (!initialGuestInput) return 0;

  // 詳細ダイアログ内で開始した場合、処理中も同じダイアログ内だけを操作する。
  // ダイアログが閉じられたらトップ画面の別入力欄へ続けて入力しない。
  const editorDialog = initialGuestInput.closest('[role="dialog"]');

  for (const email of uniqueEmails) {
    if (editorDialog && (!editorDialog.isConnected || !isVisibleElement(editorDialog))) break;
    // ゲスト追加後に入力欄が差し替わる場合があるため、同じ編集画面の中で探し直す。
    const guestInput = findGuestInputElement(editorDialog || document);
    if (!guestInput) break;

    guestInput.focus();
    setInputValue(guestInput, email);
    guestInput.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: email
    }));
    guestInput.dispatchEvent(new Event("change", { bubbles: true }));

    // 簡易画面では候補を選択して「選択中のユーザー」に確定させる必要がある。
    await sleep(500);
    const suggestion = findEmailSuggestion(email);
    if (suggestion) {
      suggestion.click();
      await sleep(350);
      insertedCount++;
      continue;
    }

    // 候補が表示されない画面では、Enterでメールアドレスを確定する。
    guestInput.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true
    }));
    guestInput.dispatchEvent(new KeyboardEvent("keyup", {
      key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true
    }));
    await sleep(350);

    // 入力値がクリアされた場合は、Googleカレンダーがゲストとして受け付けたとみなす。
    if (guestInput.value === "" || guestInput.value !== email) {
      insertedCount++;
    }
  }

  return insertedCount;
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
// 「ユーザーを検索」はカレンダートップ画面にも存在し得るため、詳細ダイアログ内に限定する。
function findGuestInputElement(scope = null) {
  const selectors = [
    ['input[aria-label="ゲストを追加"]', 120],
    ['input[aria-label="Add guests"]', 120],
    ['input[placeholder*="ゲストを追加"]', 110],
    ['input[placeholder*="Add guests"]', 110],
    ['div[data-aria-label="ゲストを追加"] input', 105]
  ];

  const candidates = new Map();
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"]')).filter(isVisibleElement);
  const scopes = scope ? [scope] : (dialogs.length ? dialogs : [document]);

  scopes.forEach(scope => {
    selectors.forEach(([selector, score]) => {
      scope.querySelectorAll(selector).forEach(el => {
        if (!isVisibleElement(el) || isClearlyNotGuestInput(el)) return;
        const nextScore = score + (el === document.activeElement ? 200 : 0)
          + (el.closest('[role="dialog"]') ? 20 : 0);
        candidates.set(el, Math.max(candidates.get(el) || 0, nextScore));
      });
    });
  });

  // Google カレンダーの一部画面ではゲスト欄が「ユーザーを検索」と表示される。
  // ただし、詳細ダイアログ内にある場合に限り候補にする。
  scopes.filter(item => item.matches?.('[role="dialog"]')).forEach(dialog => {
    dialog.querySelectorAll('input[aria-label="ユーザーを検索"]').forEach(el => {
      if (!isVisibleElement(el) || isClearlyNotGuestInput(el)) return;
      const score = 100 + (el === document.activeElement ? 200 : 0);
      candidates.set(el, Math.max(candidates.get(el) || 0, score));
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

function isValidEmailOrCalendarId(str) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}