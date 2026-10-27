let groupTree = [];
let selectedNodeId = null;
let selectedNodeIds = new Set();
let selectionAnchorId = null;

 document.addEventListener("DOMContentLoaded", async () => {
  const storage = await chrome.storage.local.get("groupTree");
  groupTree = Array.isArray(storage.groupTree) ? storage.groupTree : getDefaultData();

  const treeView = document.getElementById("treeView");
  renderTree();

  document.getElementById("addRootGroupBtn").addEventListener("click", async () => {
    const newNode = { id: "node_" + Date.now(), name: "新規グループ", emails: [], children: [] };
    groupTree.push(newNode);
    selectedNodeIds = new Set([newNode.id]);
    selectionAnchorId = newNode.id;
    selectedNodeId = newNode.id;
    await saveAndRefresh();
    selectNode(newNode.id);
  });

  document.getElementById("saveChangesBtn").addEventListener("click", async () => {
    if (!selectedNodeId) return;
    const node = findNode(groupTree, selectedNodeId);
    if (!node) return;
    node.name = document.getElementById("groupName").value.trim() || "無題のグループ";
    node.emails = parseMemberEntries(document.getElementById("groupEmails").value);
    await saveAndRefresh();
    showToast("保存しました");
  });

  document.getElementById("addChildGroupBtn").addEventListener("click", async () => {
    if (!selectedNodeId) return;
    const parentNode = findNode(groupTree, selectedNodeId);
    if (!parentNode) return;
    const childNode = { id: "node_" + Date.now(), name: "新規サブグループ", emails: [], children: [] };
    if (!Array.isArray(parentNode.children)) parentNode.children = [];
    parentNode.children.push(childNode);
    selectedNodeIds = new Set([childNode.id]);
    selectionAnchorId = childNode.id;
    selectedNodeId = childNode.id;
    await saveAndRefresh();
    selectNode(childNode.id);
  });

  document.getElementById("deleteGroupBtn").addEventListener("click", async () => {
    if (!selectedNodeId) return;
    if (confirm("このグループおよび配下のサブグループを削除しますか？")) {
      groupTree = deleteNode(groupTree, selectedNodeId);
      selectedNodeId = null;
      selectedNodeIds.clear();
      selectionAnchorId = null;
      await saveAndRefresh();
      hideEditor();
      showToast("削除しました");
    }
  });

  document.getElementById("moveSelectedBtn").addEventListener("click", async () => {
    const targetId = document.getElementById("moveTargetSelect").value || null;
    await moveSelectedGroups(targetId, targetId ? "inside" : "root");
  });

  treeView.addEventListener("click", (event) => {
    const title = event.target.closest(".tree-node-title");
    if (!title || !treeView.contains(title)) return;
    handleSelection(title.dataset.nodeId, event);
  });

  treeView.addEventListener("keydown", (event) => {
    const title = event.target.closest(".tree-node-title");
    if (!title || !treeView.contains(title)) return;
    const visibleNodes = getFlatNodes(groupTree);
    const currentIndex = visibleNodes.findIndex(item => item.node.id === title.dataset.nodeId);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const nextIndex = Math.max(0, Math.min(visibleNodes.length - 1, currentIndex + (event.key === "ArrowDown" ? 1 : -1)));
      const nextId = visibleNodes[nextIndex]?.node.id;
      if (nextId) {
        handleSelection(nextId, { shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey });
        focusNode(nextId);
      }
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleSelection(title.dataset.nodeId, event);
      focusNode(title.dataset.nodeId);
    }
  });

  treeView.addEventListener("dragstart", (event) => {
    const title = event.target.closest(".tree-node-title");
    if (!title) return;
    const id = title.dataset.nodeId;
    if (!selectedNodeIds.has(id)) {
      selectedNodeIds = new Set([id]);
      selectionAnchorId = id;
      selectedNodeId = id;
      updateEditor(id);
      treeView.querySelectorAll(".tree-node-title").forEach(item => {
        const isSelected = item.dataset.nodeId === id;
        item.classList.toggle("selected", isSelected);
        item.setAttribute("aria-selected", isSelected ? "true" : "false");
      });
      document.getElementById("selectionCount").textContent = "選択中: 1件";
      document.getElementById("moveSelectedBtn").disabled = false;
      updateMoveTargets();
    }
    const ids = getSelectedRootIds();
    if (!ids.length) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", JSON.stringify(ids));
    title.classList.add("dragging");
  });

  treeView.addEventListener("dragend", () => {
    treeView.querySelectorAll(".dragging, .drop-before, .drop-after, .drop-inside").forEach(el => {
      el.classList.remove("dragging", "drop-before", "drop-after", "drop-inside");
    });
  });

  treeView.addEventListener("dragover", (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    treeView.querySelectorAll(".drop-before, .drop-after, .drop-inside").forEach(el => {
      el.classList.remove("drop-before", "drop-after", "drop-inside");
    });
    const li = event.target.closest("li[data-node-id]");
    if (!li || !treeView.contains(li)) return;
    const row = li.querySelector(":scope > .tree-node-title");
    const rect = (row || li).getBoundingClientRect();
    const ratio = (event.clientY - rect.top) / Math.max(rect.height, 1);
    li.classList.add(ratio < 0.25 ? "drop-before" : ratio > 0.75 ? "drop-after" : "drop-inside");
  });

  treeView.addEventListener("drop", async (event) => {
    event.preventDefault();
    const li = event.target.closest("li[data-node-id]");
    let ids = [];
    try {
      ids = JSON.parse(event.dataTransfer.getData("text/plain") || "[]");
    } catch (_) {
      ids = [];
    }
    if (!Array.isArray(ids) || !ids.length) return;
    if (!li || !treeView.contains(li)) {
      await moveGroups(ids, null, "root");
      return;
    }
    const row = li.querySelector(":scope > .tree-node-title");
    const rect = (row || li).getBoundingClientRect();
    const ratio = (event.clientY - rect.top) / Math.max(rect.height, 1);
    const placement = ratio < 0.25 ? "before" : ratio > 0.75 ? "after" : "inside";
    await moveGroups(ids, li.dataset.nodeId, placement);
  });

  document.getElementById("exportBtn").addEventListener("click", () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(groupTree, null, 2));
    const downloadAnchor = document.createElement("a");
    const dateStr = new Date().toISOString().slice(0, 10);
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", "calendar_groups_" + dateStr + ".json");
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    showToast("JSONを出力しました");
  });

  const importFileInput = document.getElementById("importFileInput");
  document.getElementById("importBtn").addEventListener("click", () => importFileInput.click());
  importFileInput.addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (loadEvent) => {
      try {
        const importedData = JSON.parse(loadEvent.target.result);
        if (!Array.isArray(importedData)) {
          alert("有効なグループデータ（配列形式）ではありません。");
          return;
        }
        if (confirm("現在のグループ設定に読み込んだJSONデータをマージしますか？")) {
          groupTree = mergeGroupTrees(groupTree, importedData);
          selectedNodeId = null;
          selectedNodeIds.clear();
          selectionAnchorId = null;
          await saveAndRefresh();
          hideEditor();
          showToast("JSONを読み込みました");
        }
      } catch (_) {
        alert("JSONファイルの解析に失敗しました。ファイル形式を確認してください。");
      } finally {
        importFileInput.value = "";
      }
    };
    reader.readAsText(file);
  });
});

function parseMemberEntries(text) {
  return text.split(/\r?\n/).map(value => {
    const entry = value.trim();
    if (!entry) return "";
    const parsed = parseMemberEntry(entry);
    return parsed.name ? formatNamedMember(parsed.name, parsed.email) : parsed.email;
  }).filter(Boolean);
}

function parseMemberEntry(value) {
  const entry = String(value || "").trim();
  const match = entry.match(/^(?:"((?:\\.|[^"\\])*)"|([^<>"]+?))\s*<([^<>]+)>$/);
  if (match) {
    const name = match[1] !== undefined ? unescapeQuotedName(match[1]).trim() : match[2].trim();
    return { name, email: match[3].trim() };
  }
  return { name: "", email: entry };
}

function unescapeQuotedName(name) {
  return name.replace(/\\(["\\])/g, "$1");
}

function formatNamedMember(name, email) {
  const escapedName = String(name).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escapedName}"<${email}>`;
}

function getDefaultData() {
  return [
    { id: "node_1", name: "開発部", emails: [], children: [
      { id: "node_2", name: "フロントエンドチーム", emails: ["alice@example.com", "bob@example.com"], children: [] },
      { id: "node_3", name: "バックエンドチーム", emails: ["charlie@example.com", "dave@example.com"], children: [] }
    ]},
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
  ul.setAttribute("role", "tree");
  groupTree.forEach(node => ul.appendChild(createTreeItem(node)));
  treeView.appendChild(ul);
  updateMoveTargets();
  document.getElementById("selectionCount").textContent = "選択中: " + selectedNodeIds.size + "件";
  document.getElementById("moveSelectedBtn").disabled = selectedNodeIds.size === 0;
}

function createTreeItem(node) {
  const li = document.createElement("li");
  li.dataset.nodeId = node.id;
  li.setAttribute("role", "none");
  const title = document.createElement("div");
  title.className = "tree-node-title" + (selectedNodeIds.has(node.id) ? " selected" : "");
  title.textContent = "📁 " + node.name;
  title.dataset.nodeId = node.id;
  title.setAttribute("role", "treeitem");
  title.setAttribute("aria-selected", selectedNodeIds.has(node.id) ? "true" : "false");
  title.tabIndex = 0;
  title.draggable = true;
  li.appendChild(title);
  const children = Array.isArray(node.children) ? node.children : [];
  if (children.length) {
    const ul = document.createElement("ul");
    ul.setAttribute("role", "group");
    children.forEach(child => ul.appendChild(createTreeItem(child)));
    li.appendChild(ul);
  }
  return li;
}

function handleSelection(id, event) {
  const flat = getFlatNodes(groupTree);
  if (!flat.some(item => item.node.id === id)) return;
  if (event.shiftKey && selectionAnchorId) {
    const start = flat.findIndex(item => item.node.id === selectionAnchorId);
    const end = flat.findIndex(item => item.node.id === id);
    if (start >= 0 && end >= 0) {
      selectedNodeIds = new Set(flat.slice(Math.min(start, end), Math.max(start, end) + 1).map(item => item.node.id));
    }
  } else if (event.ctrlKey || event.metaKey) {
    if (selectedNodeIds.has(id)) selectedNodeIds.delete(id);
    else selectedNodeIds.add(id);
    selectionAnchorId = id;
  } else {
    selectedNodeIds = new Set([id]);
    selectionAnchorId = id;
  }
  selectedNodeId = id;
  updateEditor(id);
  renderTree();
  focusNode(id);
}

function selectNode(id) {
  selectedNodeId = id;
  selectedNodeIds = new Set([id]);
  selectionAnchorId = id;
  updateEditor(id);
  renderTree();
  focusNode(id);
}

function updateEditor(id) {
  const node = findNode(groupTree, id);
  if (!node) return;
  document.getElementById("editorContainer").classList.remove("hidden");
  document.getElementById("emptyNotice").classList.add("hidden");
  document.getElementById("groupName").value = node.name || "";
  document.getElementById("groupEmails").value = (node.emails || []).join("\n");
}

function hideEditor() {
  document.getElementById("editorContainer").classList.add("hidden");
  document.getElementById("emptyNotice").classList.remove("hidden");
}

function focusNode(id) {
  const title = Array.from(document.querySelectorAll(".tree-node-title")).find(el => el.dataset.nodeId === id);
  if (title) title.focus();
}

function getFlatNodes(nodes, parentId = null, result = []) {
  nodes.forEach(node => {
    result.push({ node, parentId });
    if (Array.isArray(node.children)) getFlatNodes(node.children, node.id, result);
  });
  return result;
}

function getSelectedRootIds() {
  const flat = getFlatNodes(groupTree);
  const selected = selectedNodeIds;
  const byId = new Map(flat.map(item => [item.node.id, item]));
  return flat.filter(item => {
    if (!selected.has(item.node.id)) return false;
    let parentId = item.parentId;
    while (parentId) {
      if (selected.has(parentId)) return false;
      parentId = byId.get(parentId)?.parentId || null;
    }
    return true;
  }).map(item => item.node.id);
}

function updateMoveTargets() {
  const select = document.getElementById("moveTargetSelect");
  const previous = select.value;
  select.innerHTML = "";
  const rootOption = document.createElement("option");
  rootOption.value = "";
  rootOption.textContent = "ルート階層（サブグループから外す）";
  select.appendChild(rootOption);

  const movingIds = getSelectedRootIds();
  const forbidden = new Set();
  movingIds.forEach(id => {
    const node = findNode(groupTree, id);
    if (node) collectSubtreeIds(node, forbidden);
  });
  getFlatNodes(groupTree).forEach(item => {
    if (forbidden.has(item.node.id)) return;
    const option = document.createElement("option");
    option.value = item.node.id;
    option.textContent = "　".repeat(getDepth(groupTree, item.node.id)) + item.node.name;
    select.appendChild(option);
  });
  if (Array.from(select.options).some(option => option.value === previous)) select.value = previous;
}

function getDepth(nodes, id, depth = 0) {
  for (const node of nodes) {
    if (node.id === id) return depth;
    const found = getDepth(Array.isArray(node.children) ? node.children : [], id, depth + 1);
    if (found >= 0) return found;
  }
  return -1;
}

function collectSubtreeIds(node, result) {
  result.add(node.id);
  (Array.isArray(node.children) ? node.children : []).forEach(child => collectSubtreeIds(child, result));
}

async function moveSelectedGroups(targetId, placement) {
  const ids = getSelectedRootIds();
  await moveGroups(ids, targetId, placement);
}

async function moveGroups(ids, targetId, placement) {
  const movingIds = new Set(ids.filter(id => findNode(groupTree, id)));
  if (!movingIds.size) return;
  const movingRoots = getFlatNodes(groupTree).filter(item => movingIds.has(item.node.id)).map(item => item.node.id);
  const normalizedIds = new Set(movingRoots.filter(id => {
    const flat = getFlatNodes(groupTree);
    const item = flat.find(entry => entry.node.id === id);
    let parentId = item?.parentId || null;
    while (parentId) {
      if (movingIds.has(parentId)) return false;
      parentId = flat.find(entry => entry.node.id === parentId)?.parentId || null;
    }
    return true;
  }));
  if (!normalizedIds.size) return;

  if (targetId) {
    const forbidden = new Set();
    normalizedIds.forEach(id => {
      const node = findNode(groupTree, id);
      if (node) collectSubtreeIds(node, forbidden);
    });
    if (forbidden.has(targetId)) {
      showToast("自分自身や配下のグループには移動できません");
      return;
    }
  }

  const collected = [];
  groupTree = removeNodes(groupTree, normalizedIds, collected);
  const orderedNodes = collected;
  if (!orderedNodes.length) return;

  if (placement === "root" || !targetId) {
    groupTree.push(...orderedNodes);
  } else if (placement === "inside") {
    const target = findNode(groupTree, targetId);
    if (!target) {
      groupTree.push(...orderedNodes);
    } else {
      if (!Array.isArray(target.children)) target.children = [];
      target.children.push(...orderedNodes);
    }
  } else {
    const siblings = findNodeArray(groupTree, targetId);
    if (!siblings) {
      groupTree.push(...orderedNodes);
    } else {
      const index = siblings.findIndex(node => node.id === targetId);
      siblings.splice(index + (placement === "after" ? 1 : 0), 0, ...orderedNodes);
    }
  }

  selectedNodeIds = new Set(orderedNodes.map(node => node.id));
  if (!selectedNodeId || !findNode(groupTree, selectedNodeId)) selectedNodeId = orderedNodes[0].id;
  selectionAnchorId = orderedNodes[0].id;
  await chrome.storage.local.set({ groupTree });
  renderTree();
  showToast(orderedNodes.length + "件のグループを移動しました");
}

function removeNodes(nodes, ids, collected) {
  return nodes.filter(node => {
    if (ids.has(node.id)) {
      collected.push(node);
      return false;
    }
    if (Array.isArray(node.children)) node.children = removeNodes(node.children, ids, collected);
    return true;
  });
}

function findNodeArray(nodes, id) {
  for (const node of nodes) {
    if (node.id === id) return nodes;
    const found = findNodeArray(Array.isArray(node.children) ? node.children : [], id);
    if (found) return found;
  }
  return null;
}

function findNode(nodes, id) {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (Array.isArray(node.children)) {
      const found = findNode(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

function deleteNode(nodes, id) {
  return nodes.filter(node => {
    if (node.id === id) return false;
    if (Array.isArray(node.children)) node.children = deleteNode(node.children, id);
    return true;
  });
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2000);
}

/**
 * 既存の設定を保持したまま、インポートしたグループを再帰的にマージする。
 * 同じIDのグループは統合し、名前はインポート側を優先する。
 * メールアドレスは重複を避け、インポート側に表示名があればそれを反映する。
 */
function mergeGroupTrees(existingNodes, importedNodes) {
  const cloneNode = (node) => ({
    ...node,
    emails: Array.isArray(node.emails) ? [...node.emails] : [],
    children: Array.isArray(node.children) ? node.children.map(cloneNode) : []
  });
  const merged = (Array.isArray(existingNodes) ? existingNodes : []).map(cloneNode);

  for (const imported of (Array.isArray(importedNodes) ? importedNodes : [])) {
    if (!imported || typeof imported !== "object") continue;
    const index = imported.id
      ? merged.findIndex(existing => existing.id === imported.id)
      : -1;

    if (index < 0) {
      merged.push(cloneNode(imported));
      continue;
    }

    const existing = merged[index];
    if (typeof imported.name === "string" && imported.name.trim()) {
      existing.name = imported.name;
    }

    const emailIndex = new Map();
    existing.emails.forEach((entry, i) => {
      const email = parseMemberEntry(entry).email.trim().toLowerCase();
      if (email) emailIndex.set(email, i);
    });
    for (const entry of (Array.isArray(imported.emails) ? imported.emails : [])) {
      const parsed = parseMemberEntry(entry);
      const key = parsed.email.trim().toLowerCase();
      if (!key) continue;
      if (emailIndex.has(key)) {
        const currentIndex = emailIndex.get(key);
        const current = parseMemberEntry(existing.emails[currentIndex]);
        if (parsed.name) existing.emails[currentIndex] = entry;
        else if (!current.email) existing.emails[currentIndex] = entry;
      } else {
        emailIndex.set(key, existing.emails.length);
        existing.emails.push(entry);
      }
    }

    existing.children = mergeGroupTrees(existing.children, imported.children);
  }

  return merged;
}
