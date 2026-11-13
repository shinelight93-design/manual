const data = window.PORTAL_DATA;

const state = {
  type: "manual",
  category: "",
  query: "",
};

const labels = {
  manual: { title: "업무매뉴얼", eyebrow: "MANUAL ARCHIVE", category: "업무 매뉴얼" },
  permission: { title: "권한신청서식", eyebrow: "PERMISSION FORMS", category: "권한 신청" },
  handbook: { title: "업무편람", eyebrow: "WORK HANDBOOK", category: "업무 편람" },
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

function formatBytes(value) {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))}KB`;
  return `${(value / 1024 / 1024).toFixed(1)}MB`;
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2200);
}

function itemsForType() {
  if (state.type === "permission") return data.permissions;
  if (state.type === "handbook") return data.handbooks;
  return data.documents;
}

function itemCategory(item) {
  if (state.type === "manual") return item.category;
  return item.slug;
}

function itemSearchText(item) {
  if (state.type === "manual") return `${item.title} ${item.category} ${item.department} ${item.summary} ${item.content}`;
  if (state.type === "permission") {
    return `${item.title} ${item.department} ${item.method} ${item.notes.join(" ")} ${item.attachments.map((file) => file.name).join(" ")}`;
  }
  return `${item.title} ${item.attachments.map((file) => file.name).join(" ")}`;
}

function filteredItems() {
  const query = state.query.trim().toLocaleLowerCase("ko-KR");
  return itemsForType().filter((item) => {
    if (state.category && itemCategory(item) !== state.category) return false;
    return !query || itemSearchText(item).toLocaleLowerCase("ko-KR").includes(query);
  });
}

function setRoute(item = "") {
  const url = new URL(location.href);
  url.search = "";
  url.searchParams.set("type", state.type);
  if (state.category) url.searchParams.set("category", state.category);
  if (state.query) url.searchParams.set("q", state.query);
  if (item) url.searchParams.set("item", item);
  history.pushState({}, "", url);
}

function renderBreadcrumb(current = "") {
  const breadcrumb = $("#breadcrumb");
  breadcrumb.replaceChildren();
  const home = document.createElement("button");
  home.type = "button";
  home.textContent = "홈";
  home.addEventListener("click", () => {
    state.category = "";
    state.query = "";
    $("#searchInput").value = "";
    showList();
  });
  breadcrumb.appendChild(home);
  const type = document.createElement("span");
  type.textContent = labels[state.type].title;
  breadcrumb.appendChild(type);
  if (current) {
    const detail = document.createElement("span");
    detail.textContent = current;
    breadcrumb.appendChild(detail);
  }
}

function renderCategories() {
  const list = $("#categoryList");
  list.replaceChildren();
  const items = state.type === "manual"
    ? [...new Set(data.documents.map((item) => item.category))].map((name) => ({ key: name, name }))
    : itemsForType().map((item) => ({ key: item.slug, name: item.title, lines: item.label_lines }));
  $("#categoryEyebrow").textContent = labels[state.type].category;
  $("#activeCount").textContent = itemsForType().length;
  $("#allButton").classList.toggle("active", !state.category);
  items.forEach((item, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.classList.toggle("active", item.key === state.category);
    const number = document.createElement("i");
    number.textContent = String(index + 1).padStart(2, "0");
    const name = document.createElement("span");
    if (item.lines?.length > 1) {
      item.lines.forEach((line, lineIndex) => {
        if (lineIndex) name.appendChild(document.createElement("br"));
        name.appendChild(document.createTextNode(line));
      });
      name.className = "multiline";
      button.title = item.name;
    } else {
      name.textContent = item.name;
    }
    button.append(number, name);
    button.addEventListener("click", () => {
      state.category = item.key;
      state.query = "";
      $("#searchInput").value = "";
      closeMenu();
      const matches = filteredItems();
      if (matches.length === 1) {
        renderCategories();
        openItem(matches[0].slug);
      } else {
        showList();
      }
    });
    list.appendChild(button);
  });
}

function summaryFor(item) {
  if (state.type === "manual") return item.summary;
  if (state.type === "permission") return `${item.department} 담당 · ${item.method.split("\n")[0]}`;
  return item.attachments.length ? `등록된 편람 ${item.attachments.length}개` : "등록된 편람이 없습니다.";
}

function metaFor(item) {
  if (state.type === "manual") return [item.category, item.department];
  if (state.type === "permission") return [item.department, `첨부서식 ${item.attachments.length}개`];
  const total = item.attachments.reduce((sum, file) => sum + file.size, 0);
  return [`첨부자료 ${item.attachments.length}개`, total ? formatBytes(total) : "자료 없음"];
}

function showList(updateRoute = true) {
  const items = filteredItems();
  $("#detailView").hidden = true;
  $("#listView").hidden = false;
  $("#listEyebrow").textContent = labels[state.type].eyebrow;
  $("#listTitle").textContent = state.query ? `“${state.query}” 검색 결과` : labels[state.type].title;
  $("#resultCount").textContent = items.length;
  renderBreadcrumb();
  renderCategories();
  $$('[data-type]').forEach((button) => button.classList.toggle("active", button.dataset.type === state.type));
  const list = $("#resultList");
  list.replaceChildren();
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "조건에 맞는 자료가 없습니다. 검색어 또는 분류를 다시 확인해 주세요.";
    list.appendChild(empty);
  }
  items.forEach((item) => {
    const card = document.createElement("article");
    card.className = "result-card";
    const copy = document.createElement("div");
    const kind = document.createElement("span");
    kind.className = "kind";
    kind.textContent = labels[state.type].title;
    const title = document.createElement("h3");
    title.textContent = item.title;
    const summary = document.createElement("p");
    summary.textContent = summaryFor(item);
    const meta = document.createElement("div");
    meta.className = "meta";
    metaFor(item).forEach((value) => {
      const span = document.createElement("span");
      span.textContent = value;
      meta.appendChild(span);
    });
    copy.append(kind, title, summary, meta);
    const open = document.createElement("button");
    open.type = "button";
    open.textContent = "자료 보기";
    open.addEventListener("click", () => openItem(item.slug));
    card.append(copy, open);
    list.appendChild(card);
  });
  if (updateRoute) setRoute();
  $("#content").focus({ preventScroll: true });
}

function detailShell(item, description, meta) {
  const article = $("#detailView");
  article.replaceChildren();
  const header = document.createElement("header");
  header.className = "detail-header";
  const kind = document.createElement("span");
  kind.className = "kind";
  kind.textContent = labels[state.type].eyebrow;
  const title = document.createElement("h2");
  title.textContent = item.title;
  title.tabIndex = -1;
  const summary = document.createElement("p");
  summary.textContent = description;
  const metadata = document.createElement("div");
  metadata.className = "detail-meta";
  meta.forEach(([label, value]) => {
    const span = document.createElement("span");
    span.append(`${label} `);
    const strong = document.createElement("b");
    strong.textContent = value;
    span.appendChild(strong);
    metadata.appendChild(span);
  });
  header.append(kind, title, summary, metadata);
  const body = document.createElement("div");
  body.className = "detail-body";
  article.append(header, body);
  return { article, body, title };
}

function sectionTitle(eyebrow, title) {
  const heading = document.createElement("div");
  heading.className = "section-title";
  const copy = document.createElement("div");
  const label = document.createElement("span");
  label.textContent = eyebrow;
  const strong = document.createElement("h3");
  strong.textContent = title;
  copy.append(label, strong);
  heading.appendChild(copy);
  return heading;
}

function renderAttachments(container, attachments, emptyMessage) {
  const list = document.createElement("div");
  list.className = "attachment-list";
  if (!attachments.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = emptyMessage;
    list.appendChild(empty);
  }
  attachments.forEach((file) => {
    const row = document.createElement("div");
    row.className = "attachment";
    const type = document.createElement("b");
    type.textContent = file.type.toUpperCase();
    const copy = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = file.name;
    const meta = document.createElement("small");
    meta.textContent = `${formatBytes(file.size)} · ${formatDate(file.date)}`;
    copy.append(name, meta);
    const actions = document.createElement("div");
    actions.className = "actions";
    if (file.type === "pdf") {
      const view = document.createElement("button");
      view.type = "button";
      view.textContent = "바로보기";
      view.addEventListener("click", () => showPdf(container, file));
      actions.appendChild(view);
    }
    const download = document.createElement("a");
    download.className = "download";
    download.href = file.url;
    download.download = file.name;
    download.textContent = "내려받기";
    actions.appendChild(download);
    row.append(type, copy, actions);
    list.appendChild(row);
  });
  container.appendChild(list);
}

function showPdf(container, file) {
  let viewer = container.querySelector(".pdf-viewer");
  if (!viewer) {
    viewer = document.createElement("section");
    viewer.className = "pdf-viewer";
    const toolbar = document.createElement("div");
    toolbar.className = "pdf-toolbar";
    const title = document.createElement("strong");
    const open = document.createElement("a");
    open.target = "_blank";
    open.rel = "noopener";
    open.textContent = "새 창에서 크게 보기";
    toolbar.append(title, open);
    const frame = document.createElement("iframe");
    frame.title = "PDF 원문";
    viewer.append(toolbar, frame);
    container.appendChild(viewer);
  }
  viewer.querySelector("strong").textContent = file.name;
  viewer.querySelector("a").href = file.url;
  viewer.querySelector("iframe").src = `${file.url}#view=FitH`;
  viewer.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderManual(item) {
  const { body } = detailShell(item, item.summary, [["업무분류", item.category], ["담당부서", item.department]]);
  if (data.source_manual && item.source_pages.length === 2) {
    const [start, end] = item.source_pages;
    body.appendChild(sectionTitle("ORIGINAL PDF", `원문 업무매뉴얼 ${start === end ? `${start}쪽` : `${start}~${end}쪽`}`));
    const file = { name: "통합민원 업무매뉴얼.pdf", url: `${data.source_manual}#page=${start}&view=FitH` };
    const viewer = document.createElement("section");
    viewer.className = "pdf-viewer";
    const toolbar = document.createElement("div");
    toolbar.className = "pdf-toolbar";
    const name = document.createElement("strong");
    name.textContent = file.name;
    const open = document.createElement("a");
    open.href = file.url;
    open.target = "_blank";
    open.rel = "noopener";
    open.textContent = "새 창에서 크게 보기";
    toolbar.append(name, open);
    const frame = document.createElement("iframe");
    frame.title = `${item.title} 원문`;
    frame.loading = "lazy";
    frame.src = file.url;
    viewer.append(toolbar, frame);
    body.appendChild(viewer);
  }
  body.appendChild(sectionTitle("WORK GUIDE", "업무 처리 요약"));
  const copy = document.createElement("div");
  copy.className = "manual-copy";
  item.content.split(/\r?\n/).filter(Boolean).forEach((line) => {
    let element;
    if (/^[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫ]+\./.test(line)) element = document.createElement("h3");
    else if (/^(▣|\d+\.)/.test(line)) element = document.createElement("h4");
    else element = document.createElement("p");
    element.textContent = line;
    copy.appendChild(element);
  });
  body.appendChild(copy);
}

function renderPermission(item) {
  const { body } = detailShell(item, "통합민원대 시스템 권한 신청 절차와 내려받을 수 있는 신청서식입니다.", [["담당부서", item.department]]);
  body.appendChild(sectionTitle("APPLICATION PROCESS", "신청방법"));
  const process = document.createElement("div");
  process.className = "process-box";
  process.textContent = item.method;
  body.appendChild(process);
  if (item.notes.length) {
    const notes = document.createElement("div");
    notes.className = "notes";
    const title = document.createElement("strong");
    title.textContent = "확인사항";
    const list = document.createElement("ul");
    item.notes.forEach((note) => {
      const row = document.createElement("li");
      row.textContent = note;
      list.appendChild(row);
    });
    notes.append(title, list);
    body.appendChild(notes);
  }
  if (item.url) {
    const link = document.createElement("a");
    link.className = "primary-link";
    link.href = item.url;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "관련 사이트 바로가기 ↗";
    body.appendChild(link);
  }
  body.appendChild(sectionTitle("DOWNLOAD FORMS", "권한신청 서식"));
  renderAttachments(body, item.attachments, "등록된 권한신청 서식이 없습니다.");
}

function renderHandbook(item) {
  const total = item.attachments.reduce((sum, file) => sum + file.size, 0);
  const { body } = detailShell(item, "업무 처리 시 참고할 편람 원문을 조회하거나 내려받을 수 있습니다.", [["첨부자료", `${item.attachments.length}개`], ["전체용량", total ? formatBytes(total) : "-"]]);
  body.appendChild(sectionTitle("HANDBOOK FILES", "편람 원문"));
  renderAttachments(body, item.attachments, "등록된 편람 자료가 없습니다.");
  const firstPdf = item.attachments.find((file) => file.type === "pdf");
  if (firstPdf) showPdf(body, firstPdf);
}

function openItem(slug, updateRoute = true) {
  const item = itemsForType().find((entry) => entry.slug === slug);
  if (!item) return showList(updateRoute);
  $("#listView").hidden = true;
  $("#detailView").hidden = false;
  renderBreadcrumb(item.title);
  if (state.type === "manual") renderManual(item);
  else if (state.type === "permission") renderPermission(item);
  else renderHandbook(item);
  if (updateRoute) setRoute(item.slug);
  $("#detailView h2").focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderRelatedLinks() {
  const list = $("#relatedLinks");
  data.related_sites.forEach((site, index) => {
    const link = document.createElement("a");
    link.href = site.url;
    link.target = "_blank";
    link.rel = "noopener";
    const number = document.createElement("span");
    number.textContent = String(index + 1).padStart(2, "0");
    const copy = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = site.name;
    const host = document.createElement("small");
    host.textContent = new URL(site.url).host;
    copy.append(name, host);
    link.append(number, copy);
    list.appendChild(link);
  });
}

function closeMenu() {
  $("#categoryPanel").classList.remove("open");
  $("#menuButton").setAttribute("aria-expanded", "false");
}

function loadRoute() {
  const params = new URLSearchParams(location.search);
  const type = params.get("type");
  state.type = labels[type] ? type : "manual";
  state.category = params.get("category") || "";
  state.query = params.get("q") || "";
  $("#searchInput").value = state.query;
  renderCategories();
  const item = params.get("item");
  if (item) openItem(item, false);
  else showList(false);
}

function bindEvents() {
  $$('[data-type]').forEach((button) => button.addEventListener("click", () => {
    state.type = button.dataset.type;
    state.category = "";
    state.query = "";
    $("#searchInput").value = "";
    showList();
  }));
  $("#allButton").addEventListener("click", () => {
    state.category = "";
    state.query = "";
    $("#searchInput").value = "";
    showList();
    closeMenu();
  });
  $("#searchForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const query = $("#searchInput").value.trim();
    if (!query) return showToast("검색어를 입력하세요.");
    state.query = query;
    state.category = "";
    showList();
  });
  $$('[data-popular]').forEach((button) => button.addEventListener("click", () => {
    state.type = "manual";
    state.category = "";
    state.query = button.dataset.popular;
    $("#searchInput").value = state.query;
    showList();
  }));
  $("#menuButton").addEventListener("click", () => {
    const panel = $("#categoryPanel");
    panel.classList.toggle("open");
    $("#menuButton").setAttribute("aria-expanded", String(panel.classList.contains("open")));
  });
  window.addEventListener("popstate", loadRoute);
  window.addEventListener("keydown", (event) => { if (event.key === "Escape") closeMenu(); });
}

function main() {
  $("#manualCount").textContent = data.documents.length;
  $("#permissionCount").textContent = data.permissions.reduce((sum, item) => sum + item.attachments.length, 0);
  $("#handbookCount").textContent = data.handbooks.reduce((sum, item) => sum + item.attachments.length, 0);
  $("#exportDate").textContent = formatDate(`${data.exported_on}T00:00:00`);
  renderRelatedLinks();
  bindEvents();
  loadRoute();
}

main();
