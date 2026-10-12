document.addEventListener("DOMContentLoaded", async () => {
  const treeContainer = document.getElementById("treeContainer");
  const addGuestsBtn = document.getElementById("addGuestsBtn");
  const copyGuestsBtn = document.getElementById("copyGuestsBtn");
  const openOptionsBtn = document.getElementById("openOptionsBtn");
  const statusMessage = document.getElementById("statusMessage");

  const storage = await chrome.storage.local.get("groupTree");
  const groupTree = storage.groupTree || getDefaultData();

  renderTree(groupTree, treeContainer);

  openOptionsBtn.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  addGuestsBtn.addEventListener("click", async () => {
    const selectedEmails = getSelectedEmails();
    if (selectedEmails.length === 0) {
      showStatus("グループまたはメンバーを選択してください", "error");
      return;
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url.includes("calendar.google.com")) {
      showStatus("Googleカレンダーのページで実行してください", "error");
      return;
    }

    chrome.tabs.sendMessage(tab.id, { action: "INSERT_GUESTS", emails: selectedEmails }, (response) => {
      if (chrome.runtime.lastError || !response || !response.success) {
        showStatus("カレンダーの編集ダイアログが開かれているか確認してください", "error");
      } else {
        showStatus(`${response.count} 件のゲストを設定しました`, "success");
        setTimeout(() => window.close(), 1200);
      }
    });
  });

  copyGuestsBtn.addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url.includes("calendar.google.com")) {
      showStatus("Googleカレンダーのページで実行してください", "error");
      return;
    }

    chrome.tabs.sendMessage(tab.id, { action: "COPY_GUESTS" }, async (response) => {
      if (chrome.runtime.lastError || !response || !response.emails) {
        showStatus("ゲストアドレスの取得に失敗しました", "error");
        return;
      }

      if (response.emails.length === 0) {
        showStatus("設定済みのゲストが見つかりませんでした", "error");
        return;
      }

      const textToCopy = response.emails.join(", ");
      try {
        await navigator.clipboard.writeText(textToCopy);
        showStatus(`${response.emails.length} 件のアドレスをコピーしました`, "success");
      } catch (err) {
        showStatus("クリップボードへのコピーに失敗しました", "error");
      }
    });
  });

  function showStatus(msg, type) {
    statusMessage.textContent = msg;
    statusMessage.className = `status-message ${type}`;
  }
});

function getDefaultData() {
  return [
    {
      id: "node_1",
      name: "開発部",
      emails: [],
      children: [
        { id: "node_2", name: "フロントエンドチーム", emails: ["alice@example.com", "bob@example.com"], children: [] },
        { id: "node_3", name: "バックエンドチーム", emails: ["charlie@example.com", "dave@example.com"], children: [] }
      ]
    },
    {
      id: "node_4",
      name: "営業部",
      emails: ["eve@example.com", "frank@example.com"],
      children: []
    }
  ];
}

function renderTree(nodes, container) {
  container.innerHTML = "";
  const ul = document.createElement("ul");
  ul.className = "tree-root";
  nodes.forEach(node => ul.appendChild(createTreeNodeElement(node)));
  container.appendChild(ul);

  // チェックボックスの連動処理
  container.addEventListener("change", (e) => {
    if (e.target.type === "checkbox") {
      const li = e.target.closest("li");
      const isChecked = e.target.checked;
      li.querySelectorAll("input[type='checkbox']").forEach(cb => cb.checked = isChecked);
    }
  });

  // 折りたたみトグルのクリック処理
  container.addEventListener("click", (e) => {
    if (e.target.classList.contains("toggle-btn")) {
      const parentLi = e.target.closest("li");
      const childUl = parentLi.querySelector("ul");
      if (childUl) {
        childUl.classList.toggle("collapsed");
        e.target.textContent = childUl.classList.contains("collapsed") ? "▶" : "▼";
      }
    }
  });
}

function createTreeNodeElement(node) {
  const li = document.createElement("li");
  const row = document.createElement("div");
  row.className = "tree-row";

  const hasChildren = node.children && node.children.length > 0;

  if (hasChildren) {
    const toggleBtn = document.createElement("span");
    toggleBtn.className = "toggle-btn";
    toggleBtn.textContent = "▼";
    row.appendChild(toggleBtn);
  } else {
    const spacer = document.createElement("span");
    spacer.className = "toggle-spacer";
    row.appendChild(spacer);
  }

  const label = document.createElement("label");
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.dataset.emails = JSON.stringify(collectEmails(node));

  label.appendChild(checkbox);
  label.appendChild(document.createTextNode(` ${node.name}`));
  row.appendChild(label);
  li.appendChild(row);

  if (hasChildren) {
    const ul = document.createElement("ul");
    node.children.forEach(child => ul.appendChild(createTreeNodeElement(child)));
    li.appendChild(ul);
  }

  return li;
}

function collectEmails(node) {
  let emails = [...(node.emails || [])];
  if (node.children) {
    node.children.forEach(child => {
      emails.push(...collectEmails(child));
    });
  }
  return [...new Set(emails)];
}

function getSelectedEmails() {
  const selected = new Set();
  document.querySelectorAll("#treeContainer input[type='checkbox']:checked").forEach(cb => {
    if (cb.dataset.emails) {
      JSON.parse(cb.dataset.emails).forEach(email => selected.add(email));
    }
  });
  return Array.from(selected);
}