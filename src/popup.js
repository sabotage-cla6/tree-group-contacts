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

  container.addEventListener("change", (event) => {
    const target = event.target;
    if (target.matches(".group-checkbox")) {
      const li = target.closest("li");
      li.querySelectorAll(".group-checkbox, .email-checkbox").forEach(checkbox => {
        checkbox.checked = target.checked;
        checkbox.indeterminate = false;
      });
      syncAncestorGroups(li.parentElement?.closest("li") || null);
    } else if (target.matches(".email-checkbox")) {
      syncAncestorGroups(target.closest("li"));
    }
  });

  container.addEventListener("click", (event) => {
    if (event.target.classList.contains("toggle-btn")) {
      const childUl = event.target.closest("li").querySelector(":scope > ul");
      if (childUl) {
        childUl.classList.toggle("collapsed");
        event.target.textContent = childUl.classList.contains("collapsed") ? "▶" : "▼";
      }
    }
  });
}

function syncAncestorGroups(startLi) {
  let li = startLi;
  while (li) {
    const groupCheckbox = li.querySelector(":scope > .tree-row .group-checkbox");
    if (groupCheckbox) {
      const emailCheckboxes = Array.from(li.querySelectorAll(".email-checkbox"));
      const checkedCount = emailCheckboxes.filter(checkbox => checkbox.checked).length;
      groupCheckbox.checked = emailCheckboxes.length > 0 && checkedCount === emailCheckboxes.length;
      groupCheckbox.indeterminate = checkedCount > 0 && checkedCount < emailCheckboxes.length;
    }
    li = li.parentElement?.closest("li") || null;
  }
}

function createTreeNodeElement(node) {
  const li = document.createElement("li");
  const row = document.createElement("div");
  row.className = "tree-row";

  const emails = Array.isArray(node.emails) ? node.emails : [];
  const children = Array.isArray(node.children) ? node.children : [];
  const hasTreeChildren = emails.length > 0 || children.length > 0;

  if (hasTreeChildren) {
    const toggleBtn = document.createElement("span");
    toggleBtn.className = "toggle-btn";
    toggleBtn.textContent = "▼";
    row.appendChild(toggleBtn);
  } else {
    const spacer = document.createElement("span");
    spacer.className = "toggle-spacer";
    row.appendChild(spacer);
  }

  const groupLabel = document.createElement("label");
  const groupCheckbox = document.createElement("input");
  groupCheckbox.type = "checkbox";
  groupCheckbox.className = "group-checkbox";
  groupLabel.appendChild(groupCheckbox);
  const groupIcon = document.createElement("span");
  groupIcon.className = "group-icon";
  groupIcon.setAttribute("aria-hidden", "true");
  groupIcon.textContent = "📁";
  groupLabel.appendChild(groupIcon);
  groupLabel.appendChild(document.createTextNode(` ${node.name}`));
  row.appendChild(groupLabel);
  li.appendChild(row);

  // グループに直接登録されたメールアドレスも、ツリー配下の子要素として表示する。
  if (hasTreeChildren) {
    const ul = document.createElement("ul");
    emails.forEach(email => ul.appendChild(createEmailTreeNode(email)));
    children.forEach(child => ul.appendChild(createTreeNodeElement(child)));
    li.appendChild(ul);
  }

  return li;
}

function createEmailTreeNode(email) {
  const li = document.createElement("li");
  li.className = "email-tree-node";

  const row = document.createElement("div");
  row.className = "tree-row email-row";

  const spacer = document.createElement("span");
  spacer.className = "toggle-spacer";
  row.appendChild(spacer);

  const emailLabel = document.createElement("label");
  const emailCheckbox = document.createElement("input");
  emailCheckbox.type = "checkbox";
  emailCheckbox.className = "email-checkbox";
  emailCheckbox.dataset.email = email;
  emailLabel.appendChild(emailCheckbox);
  emailLabel.appendChild(document.createTextNode(` ${email}`));
  row.appendChild(emailLabel);

  li.appendChild(row);
  return li;
}

function getSelectedEmails() {
  const selected = new Set();
  document.querySelectorAll("#treeContainer .email-checkbox:checked").forEach(checkbox => {
    if (checkbox.dataset.email) selected.add(checkbox.dataset.email);
  });
  return Array.from(selected);
}
