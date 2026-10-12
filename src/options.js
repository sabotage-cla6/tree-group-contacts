let groupTree = [];
let selectedNodeId = null;

document.addEventListener("DOMContentLoaded", async () => {
  const storage = await chrome.storage.local.get("groupTree");
  groupTree = storage.groupTree || getDefaultData();

  renderTree();

  // ルートグループ追加
  document.getElementById("addRootGroupBtn").addEventListener("click", () => {
    const newNode = { id: "node_" + Date.now(), name: "新規グループ", emails: [], children: [] };
    groupTree.push(newNode);
    saveAndRefresh();
    selectNode(newNode.id);
  });

  // 変更保存
  document.getElementById("saveChangesBtn").addEventListener("click", () => {
    if (!selectedNodeId) return;
    const node = findNode(groupTree, selectedNodeId);
    if (node) {
      node.name = document.getElementById("groupName").value.trim() || "無題のグループ";
      const rawText = document.getElementById("groupEmails").value;
      node.emails = rawText.split(/[\n,]/).map(e => e.trim()).filter(e => e.length > 0);
      saveAndRefresh();
      showToast("保存しました");
    }
  });

  // サブグループ追加
  document.getElementById("addChildGroupBtn").addEventListener("click", () => {
    if (!selectedNodeId) return;
    const parentNode = findNode(groupTree, selectedNodeId);
    if (parentNode) {
      const childNode = { id: "node_" + Date.now(), name: "新規サブグループ", emails: [], children: [] };
      if (!parentNode.children) parentNode.children = [];
      parentNode.children.push(childNode);
      saveAndRefresh();
      selectNode(childNode.id);
    }
  });

  // グループ削除
  document.getElementById("deleteGroupBtn").addEventListener("click", () => {
    if (!selectedNodeId) return;
    if (confirm("このグループおよび配下のサブグループを削除しますか？")) {
      groupTree = deleteNode(groupTree, selectedNodeId);
      selectedNodeId = null;
      saveAndRefresh();
      hideEditor();
      showToast("削除しました");
    }
  });

  // 📥 JSONエクスポート
  document.getElementById("exportBtn").addEventListener("click", () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(groupTree, null, 2));
    const downloadAnchor = document.createElement("a");
    const dateStr = new Date().toISOString().slice(0, 10);
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `calendar_groups_${dateStr}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    showToast("JSONを出力しました");
  });

  // 📤 JSONインポート
  const importFileInput = document.getElementById("importFileInput");
  document.getElementById("importBtn").addEventListener("click", () => {
    importFileInput.click();
  });

  importFileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const importedData = JSON.parse(evt.target.result);
        if (Array.isArray(importedData)) {
          if (confirm("現在のグループ設定を読み込んだJSONデータで上書きしますか？")) {
            groupTree = importedData;
            selectedNodeId = null;
            saveAndRefresh();
            hideEditor();
            showToast("JSONを読み込みました");
          }
        } else {
          alert("有効なグループデータ（配列形式）ではありません。");
        }
      } catch (err) {
        alert("JSONファイルの解析に失敗しました。ファイル形式を確認してください。");
      }
      importFileInput.value = ""; // リセット
    };
    reader.readAsText(file);
  });
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
    { id: "node_4", name: "営業部", emails: ["eve@example.com", "frank@example.com"], children: [] }
  ];
}

async function saveAndRefresh() {
  await chrome.storage.local.set({ groupTree });
  renderTree();
}

function renderTree() {
  const treeView = document.getElementById("treeView");
  treeView.innerHTML = "";
  const ul = document.createElement("ul");
  ul.className = "options-tree";
  groupTree.forEach(node => ul.appendChild(createTreeItem(node)));
  treeView.appendChild(ul);
}

function createTreeItem(node) {
  const li = document.createElement("li");
  const span = document.createElement("span");
  span.className = `tree-node-title ${node.id === selectedNodeId ? "selected" : ""}`;
  span.textContent = node.name;
  span.addEventListener("click", () => selectNode(node.id));

  li.appendChild(span);

  if (node.children && node.children.length > 0) {
    const ul = document.createElement("ul");
    node.children.forEach(child => ul.appendChild(createTreeItem(child)));
    li.appendChild(ul);
  }

  return li;
}

function selectNode(id) {
  selectedNodeId = id;
  renderTree();
  const node = findNode(groupTree, id);
  if (node) {
    document.getElementById("editorContainer").classList.remove("hidden");
    document.getElementById("emptyNotice").classList.add("hidden");
    document.getElementById("groupName").value = node.name;
    document.getElementById("groupEmails").value = (node.emails || []).join("\n");
  }
}

function hideEditor() {
  document.getElementById("editorContainer").classList.add("hidden");
  document.getElementById("emptyNotice").classList.remove("hidden");
}

function findNode(nodes, id) {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children) {
      const found = findNode(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

function deleteNode(nodes, id) {
  return nodes.filter(node => {
    if (node.id === id) return false;
    if (node.children) {
      node.children = deleteNode(node.children, id);
    }
    return true;
  });
}

function showToast(msg) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2000);
}