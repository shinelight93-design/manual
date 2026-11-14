const data = window.PORTAL_DATA;
const sourceIndex = window.PORTAL_SEARCH || [];

const state = {
  type: "manual",
  category: "",
  query: "",
  search: "",
  group: "all",
};

const MANUAL_TYPES = ["resident", "seal", "manual"];
const isManual = (type = state.type) => MANUAL_TYPES.includes(type);

const labels = {
  resident: { title: "주민등록 업무매뉴얼", category: "주민등록 업무",
    description: "주민등록 담당자의 일일·월별·분기별 업무 처리 방법 안내" },
  seal: { title: "인감 업무매뉴얼", category: "인감 업무",
    description: "인감 담당자의 일일·주간·월별 업무 처리 방법 안내" },
  manual: { title: "통합민원 업무매뉴얼", category: "업무 매뉴얼",
    description: "시스템 사용 및 업무 처리 방법 안내" },
  permission: { title: "권한신청서식", category: "권한 신청",
    description: "통합민원대 시스템 권한 신청을 위한 방법 및 서식" },
  handbook: { title: "업무편람", category: "업무 편람",
    description: "각 담당부처 및 기관의 실무 편람, 지침, 질의회신집 등" },
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
  return data.documents.filter((item) => (item.set || "manual") === state.type);
}

function sourceFileFor(type) {
  return data.source_files?.[type] || (type === "manual" ? data.source_manual_file : null);
}

function itemCategory(item) {
  if (isManual()) return item.category;
  return item.slug;
}

function itemSearchText(item) {
  if (isManual()) return `${item.title} ${item.category} ${item.department} ${item.summary} ${item.content}`;
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

function setRoute(item = "", page = 0) {
  const url = new URL(location.href);
  url.search = "";
  if (state.search) {
    url.searchParams.set("search", state.search);
    if (state.group !== "all") url.searchParams.set("group", state.group);
    history.pushState({}, "", url);
    return;
  }
  url.searchParams.set("type", state.type);
  if (state.category) url.searchParams.set("category", state.category);
  if (state.query) url.searchParams.set("q", state.query);
  if (item) url.searchParams.set("item", item);
  if (page) url.searchParams.set("page", page);
  history.pushState({}, "", url);
}

function renderBreadcrumb(current = "", section = "") {
  const breadcrumb = $("#breadcrumb");
  breadcrumb.replaceChildren();
  const home = document.createElement("button");
  home.type = "button";
  home.textContent = "홈";
  home.addEventListener("click", () => {
    state.category = "";
    state.query = "";
    state.search = "";
    $("#searchInput").value = "";
    showList();
  });
  breadcrumb.appendChild(home);
  const type = document.createElement("span");
  type.textContent = section || labels[state.type].title;
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
  const items = isManual()
    ? [...new Set(itemsForType().map((item) => item.category))].map((name) => ({ key: name, name }))
    : itemsForType().map((item) => ({ key: item.slug, name: item.title, lines: item.label_lines }));
  $("#categoryTitle").textContent = labels[state.type].title;
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
  if (isManual()) return item.summary;
  if (state.type === "permission") return `${item.department} 담당 · ${item.method.split("\n")[0]}`;
  return item.attachments.length ? `등록된 편람 ${item.attachments.length}개` : "등록된 편람이 없습니다.";
}

function metaFor(item) {
  if (isManual()) return [item.category, item.department];
  if (state.type === "permission") return [item.department, `첨부서식 ${item.attachments.length}개`];
  const total = item.attachments.reduce((sum, file) => sum + file.size, 0);
  return [`첨부자료 ${item.attachments.length}개`, total ? formatBytes(total) : "자료 없음"];
}

function methodLines(container, text) {
  text.split(/\r?\n/).filter((line) => line.trim()).forEach((line) => {
    const row = document.createElement("span");
    row.className = /^[①-⑳]/.test(line.trim()) ? "method-line numbered" : "method-line";
    row.textContent = line.trim();
    container.appendChild(row);
  });
  return container;
}

function permissionInfo(item) {
  const info = document.createElement("dl");
  info.className = "permission-info";
  const methodLabel = document.createElement("dt");
  methodLabel.textContent = "신청방법";
  const method = methodLines(document.createElement("dd"), item.method);
  info.append(methodLabel, method);
  if (item.notes.length) {
    const cautionLabel = document.createElement("dt");
    cautionLabel.className = "caution";
    cautionLabel.textContent = "주의사항";
    const caution = document.createElement("dd");
    const list = document.createElement("ul");
    item.notes.forEach((note) => {
      const row = document.createElement("li");
      row.textContent = note;
      list.appendChild(row);
    });
    caution.appendChild(list);
    info.append(cautionLabel, caution);
  }
  return info;
}

function downloadLink(file, text) {
  const link = document.createElement("a");
  link.href = file.url;
  link.download = file.name;
  link.textContent = text;
  return link;
}

function formDownload(item) {
  if (item.attachments.length === 1) {
    const link = downloadLink(item.attachments[0], "서식 내려받기");
    link.className = "download-button";
    link.title = item.attachments[0].name;
    return link;
  }
  const menu = document.createElement("details");
  menu.className = "download-menu";
  const summary = document.createElement("summary");
  summary.textContent = `서식 내려받기 (${item.attachments.length})`;
  const list = document.createElement("div");
  item.attachments.forEach((file) => {
    const link = downloadLink(file, file.name);
    const size = document.createElement("small");
    size.textContent = `${file.type.toUpperCase()} · ${formatBytes(file.size)}`;
    link.appendChild(size);
    list.appendChild(link);
  });
  menu.append(summary, list);
  return menu;
}

function showList(updateRoute = true) {
  const items = filteredItems();
  state.search = "";
  $("#detailView").hidden = true;
  $("#searchView").hidden = true;
  $("#listView").hidden = false;
  $("#listTitle").textContent = state.query ? `“${state.query}” 검색 결과` : labels[state.type].title;
  $("#listDescription").textContent = state.query ? "" : labels[state.type].description;
  $("#resultCount").textContent = items.length;
  renderBreadcrumb();
  renderCategories();
  $$('[data-type]').forEach((button) => button.classList.toggle("active", button.dataset.type === state.type));
  const list = $("#resultList");
  list.replaceChildren();
  if (state.type === "permission" && !state.category && !state.query && data.permission_notice) {
    const notice = document.createElement("p");
    notice.className = "notice permission-notice";
    notice.setAttribute("role", "note");
    const label = document.createElement("span");
    label.textContent = data.permission_notice.label;
    notice.append(label, data.permission_notice.text);
    list.appendChild(notice);
  }
  const sourceFile = sourceFileFor(state.type);
  if (isManual() && !state.category && !state.query && sourceFile) {
    const block = document.createElement("section");
    block.className = "source-block";
    block.appendChild(sectionTitle(`${labels[state.type].title} 원본`));
    renderAttachments(block, [{ ...sourceFile, type: "pdf" }], "");
    list.appendChild(block);
  }
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
    const actions = document.createElement("div");
    actions.className = "card-actions";
    const open = document.createElement("button");
    open.type = "button";
    open.textContent = "자료 보기";
    open.addEventListener("click", () => openItem(item.slug));
    actions.appendChild(open);
    if (state.type === "permission") {
      card.classList.add("permission-card");
      if (item.title_lines?.length > 1) {
        title.replaceChildren();
        item.title_lines.forEach((line, lineIndex) => {
          if (lineIndex) title.appendChild(document.createElement("br"));
          title.appendChild(document.createTextNode(line));
        });
      }
      copy.append(title, meta);
      card.append(copy, permissionInfo(item), actions);
      if (item.attachments.length) actions.appendChild(formDownload(item));
    } else {
      copy.append(title, summary, meta);
      card.append(copy, actions);
    }
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
  const title = document.createElement("h2");
  title.textContent = item.title;
  title.tabIndex = -1;
  const summary = document.createElement("p");
  summary.textContent = description;
  summary.hidden = !description;
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
  header.append(title, summary, metadata);
  const body = document.createElement("div");
  body.className = "detail-body";
  article.append(header, body);
  return { article, body, title };
}

function sectionTitle(title, variant = "") {
  const heading = document.createElement("div");
  heading.className = variant ? `section-title ${variant}` : "section-title";
  const copy = document.createElement("div");
  const strong = document.createElement("h3");
  strong.textContent = title;
  copy.append(strong);
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
      view.className = "view-toggle";
      view.dataset.url = file.url;
      view.textContent = "바로보기";
      view.setAttribute("aria-expanded", "false");
      view.addEventListener("click", () => togglePdf(container, file));
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

function syncViewButtons(container) {
  const openUrl = container.querySelector(".pdf-viewer")?.dataset.url;
  container.querySelectorAll(".view-toggle").forEach((button) => {
    const open = button.dataset.url === openUrl;
    button.textContent = open ? "닫기" : "바로보기";
    button.classList.toggle("active", open);
    button.setAttribute("aria-expanded", String(open));
  });
}

function togglePdf(container, file) {
  const viewer = container.querySelector(".pdf-viewer");
  if (viewer && viewer.dataset.url === file.url) {
    viewer.remove();
    syncViewButtons(container);
    return;
  }
  showPdf(container, file);
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
  viewer.dataset.url = file.url;
  syncViewButtons(container);
  viewer.scrollIntoView({ behavior: "smooth", block: "start" });
}

function pageLabel(start, end) {
  return start === end ? `${start}쪽` : `${start}~${end}쪽`;
}

function renderManual(item, page = 0) {
  const { body } = detailShell(item, item.summary, [["업무분류", item.category], [item.department_label || "담당부서", item.department]]);
  if (!item.source_file || item.source_pages.length !== 2) return;
  const [start, end] = item.source_pages;
  const target = page >= start && page <= end ? page : start;
  const viewer = document.createElement("section");
  viewer.className = "pdf-viewer";
  const toolbar = document.createElement("div");
  toolbar.className = "pdf-toolbar";
  const name = document.createElement("strong");
  name.textContent = `${labels[state.type].title} · ${pageLabel(start, end)}`;
  const open = document.createElement("a");
  open.href = item.source_file;
  open.target = "_blank";
  open.rel = "noopener";
  open.textContent = "새 창에서 크게 보기";
  toolbar.append(name, open);
  if (page && target === page) {
    const note = document.createElement("p");
    note.className = "pdf-note";
    note.textContent = `검색하신 내용이 있는 원본 ${page}쪽을 표시합니다.`;
    viewer.append(toolbar, note);
  } else {
    viewer.appendChild(toolbar);
  }
  const frame = document.createElement("iframe");
  frame.title = `${item.title} 업무매뉴얼 ${pageLabel(start, end)}`;
  frame.src = `${item.source_file}#page=${target - start + 1}&view=FitH`;
  viewer.appendChild(frame);
  body.appendChild(viewer);
}

function renderPermission(item) {
  const { body } = detailShell(item, "", [["담당부서", item.department]]);
  body.appendChild(sectionTitle("신청방법", "plain"));
  const process = document.createElement("div");
  process.className = "process-box";
  methodLines(process, item.method);
  body.appendChild(process);
  if (item.notes.length) {
    const notes = document.createElement("div");
    notes.className = "notes";
    const title = document.createElement("strong");
    title.className = "caution";
    title.textContent = "주의사항";
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
  if (item.attachments_enabled === false) return;
  body.appendChild(sectionTitle("권한신청 서식"));
  renderAttachments(body, item.attachments, "등록된 권한신청 서식이 없습니다.");
}

function renderHandbook(item) {
  const total = item.attachments.reduce((sum, file) => sum + file.size, 0);
  const { body } = detailShell(item, "업무 처리 시 참고할 편람 원문을 조회하거나 내려받을 수 있습니다.", [["첨부자료", `${item.attachments.length}개`], ["전체용량", total ? formatBytes(total) : "-"]]);
  body.appendChild(sectionTitle("편람 원문"));
  renderAttachments(body, item.attachments, "등록된 편람 자료가 없습니다.");
  const firstPdf = item.attachments.find((file) => file.type === "pdf");
  if (firstPdf) showPdf(body, firstPdf);
}

function openItem(slug, updateRoute = true, page = 0) {
  const item = itemsForType().find((entry) => entry.slug === slug);
  if (!item) return showList(updateRoute);
  state.search = "";
  state.category = itemCategory(item);
  $("#listView").hidden = true;
  $("#searchView").hidden = true;
  $("#detailView").hidden = false;
  $$('[data-type]').forEach((button) => button.classList.toggle("active", button.dataset.type === state.type));
  renderCategories();
  renderBreadcrumb(item.title);
  if (isManual()) renderManual(item, page);
  else if (state.type === "permission") renderPermission(item);
  else renderHandbook(item);
  if (updateRoute) setRoute(item.slug, page);
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
    if (site.lines?.length > 1) {
      site.lines.forEach((line, lineIndex) => {
        if (lineIndex) name.appendChild(document.createElement("br"));
        name.appendChild(document.createTextNode(line));
      });
      link.title = site.name;
      name.className = "multiline";
    } else {
      name.textContent = site.name;
    }
    const host = document.createElement("small");
    host.textContent = new URL(site.url).host;
    copy.append(name, host);
    link.append(number, copy);
    list.appendChild(link);
  });
}

const SEARCH_GROUPS = [
  { key: "manual", label: "업무매뉴얼" },
  { key: "source", label: "매뉴얼 원문" },
  { key: "permission", label: "권한신청서식" },
  { key: "handbook", label: "업무편람" },
];
const GROUP_PREVIEW = 5;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildMatcher(query) {
  // PDF에서 꺼낸 글자는 단어 중간에 띄어쓰기가 끼는 경우가 있어, 글자 사이 공백을 허용한다.
  const tokens = query.trim().split(/\s+/).filter(Boolean).slice(0, 6);
  const patterns = tokens.map((token) => [...token].map(escapeRegExp).join("\\s*"));
  return {
    tokens,
    test: (text) => patterns.every((pattern) => new RegExp(pattern, "i").test(text)),
    ranges(text) {
      const ranges = [];
      patterns.forEach((pattern) => {
        for (const match of text.matchAll(new RegExp(pattern, "gi"))) {
          if (match[0]) ranges.push([match.index, match.index + match[0].length]);
        }
      });
      ranges.sort((a, b) => a[0] - b[0]);
      return ranges.reduce((merged, range) => {
        const last = merged[merged.length - 1];
        if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
        else merged.push([...range]);
        return merged;
      }, []);
    },
  };
}

function highlighted(tag, text, matcher, className = "") {
  const element = document.createElement(tag);
  if (className) element.className = className;
  let cursor = 0;
  matcher.ranges(text).forEach(([start, end]) => {
    if (start > cursor) element.appendChild(document.createTextNode(text.slice(cursor, start)));
    const mark = document.createElement("mark");
    mark.textContent = text.slice(start, end);
    element.appendChild(mark);
    cursor = end;
  });
  if (cursor < text.length) element.appendChild(document.createTextNode(text.slice(cursor)));
  return element;
}

function snippet(text, matcher, length = 150) {
  const clean = text.replace(/\s+/g, " ").trim();
  const first = matcher.ranges(clean)[0];
  if (!first || clean.length <= length) return clean.slice(0, length) + (clean.length > length ? "…" : "");
  const start = Math.max(0, first[0] - 45);
  const end = Math.min(clean.length, start + length);
  return `${start ? "…" : ""}${clean.slice(start, end)}${end < clean.length ? "…" : ""}`;
}

function collectResults(query) {
  const matcher = buildMatcher(query);
  const results = { manual: [], source: [], permission: [], handbook: [] };
  data.documents.forEach((item) => {
    const text = `${item.title} ${item.category} ${item.department} ${item.summary} ${item.content}`;
    if (!matcher.test(text)) return;
    const main = matcher.test(item.summary) ? item.summary : snippet(item.content, matcher);
    const type = item.set || "manual";
    results.manual.push({
      title: item.title, meta: [item.department], body: main,
      path: [labels[type].title, item.category], open: () => { state.type = type; openItem(item.slug); },
    });
  });
  sourceIndex.forEach((page) => {
    if (!matcher.test(page.t)) return;
    const type = page.m || "manual";
    results.source.push({
      title: `${page.c} · 원본 ${page.p}쪽`, meta: [`${labels[type].title} 원문`], body: snippet(page.t, matcher),
      path: [labels[type].title, page.c, `${page.p}쪽`], open: () => { state.type = type; openItem(page.s, true, page.p); },
    });
  });
  data.permissions.forEach((item) => {
    const files = item.attachments.map((file) => file.name).join(" ");
    const text = `${item.title} ${item.department} ${item.method} ${item.notes.join(" ")} ${files}`;
    if (!matcher.test(text)) return;
    const body = [item.method, ...item.notes, files].find((value) => value && matcher.test(value)) || item.method;
    results.permission.push({
      title: item.title, meta: [item.department], body: snippet(body, matcher),
      path: ["권한신청서식", item.title], open: () => { state.type = "permission"; openItem(item.slug); },
    });
  });
  data.handbooks.forEach((item) => {
    const files = item.attachments.filter((file) => matcher.test(file.name)).map((file) => file.name);
    if (!matcher.test(item.title) && !files.length) return;
    results.handbook.push({
      title: item.title, meta: [`첨부자료 ${item.attachments.length}개`],
      body: files.length ? files.join(", ") : "등록된 편람 자료를 확인하세요.",
      path: ["업무편람", item.title], open: () => { state.type = "handbook"; openItem(item.slug); },
    });
  });
  return { matcher, results };
}

function renderHit(hit, matcher) {
  const row = document.createElement("li");
  row.className = "hit";
  const meta = document.createElement("p");
  meta.className = "hit-meta";
  meta.textContent = hit.meta.filter(Boolean).join(" · ");
  const title = document.createElement("button");
  title.type = "button";
  title.className = "hit-title";
  title.appendChild(highlighted("span", hit.title, matcher));
  title.addEventListener("click", hit.open);
  const body = highlighted("p", hit.body, matcher, "hit-body");
  const path = document.createElement("p");
  path.className = "hit-path";
  path.textContent = hit.path.join(" > ");
  row.append(meta, title, body, path);
  return row;
}

function showSearch(query, group = "all", updateRoute = true) {
  state.search = query;
  state.group = SEARCH_GROUPS.some((item) => item.key === group) ? group : "all";
  state.category = "";
  $("#searchInput").value = query;
  $("#listView").hidden = true;
  $("#detailView").hidden = true;
  const view = $("#searchView");
  view.hidden = false;
  view.replaceChildren();
  $$('[data-type]').forEach((button) => button.classList.remove("active"));
  renderBreadcrumb("", "통합검색");
  const { matcher, results } = collectResults(query);
  const total = SEARCH_GROUPS.reduce((sum, item) => sum + results[item.key].length, 0);

  const summary = document.createElement("div");
  summary.className = "search-summary";
  const keyword = document.createElement("em");
  keyword.textContent = `“${query}”`;
  const count = document.createElement("strong");
  count.textContent = total.toLocaleString("ko-KR");
  summary.append(keyword, " 에 대한 전체 총 ", count, " 건의 결과를 찾았습니다.");
  view.appendChild(summary);

  const pills = document.createElement("nav");
  pills.className = "search-pills";
  pills.setAttribute("aria-label", "검색 결과 구분");
  [{ key: "all", label: "통합검색" }, ...SEARCH_GROUPS].forEach((item) => {
    const pill = document.createElement("button");
    pill.type = "button";
    pill.textContent = item.key === "all" ? item.label : `${item.label} ${results[item.key].length}`;
    pill.classList.toggle("active", state.group === item.key);
    pill.setAttribute("aria-pressed", String(state.group === item.key));
    pill.addEventListener("click", () => showSearch(query, item.key));
    pills.appendChild(pill);
  });
  view.appendChild(pills);

  const groups = SEARCH_GROUPS.filter((item) => state.group === "all" || state.group === item.key);
  const shown = groups.filter((item) => results[item.key].length);
  if (!shown.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "검색 결과가 없습니다. 띄어쓰기를 줄이거나 더 짧은 단어로 다시 검색해 보세요.";
    view.appendChild(empty);
  }
  shown.forEach((item) => {
    const section = document.createElement("section");
    section.className = "search-group";
    const heading = document.createElement("h3");
    heading.textContent = item.label;
    const small = document.createElement("small");
    small.textContent = `(검색결과 ${results[item.key].length})`;
    heading.appendChild(small);
    const list = document.createElement("ol");
    const hits = state.group === "all" ? results[item.key].slice(0, GROUP_PREVIEW) : results[item.key];
    hits.forEach((hit) => list.appendChild(renderHit(hit, matcher)));
    section.append(heading, list);
    if (state.group === "all" && results[item.key].length > GROUP_PREVIEW) {
      const more = document.createElement("button");
      more.type = "button";
      more.className = "search-more";
      more.textContent = `${item.label} 결과 ${results[item.key].length}건 모두 보기`;
      more.addEventListener("click", () => showSearch(query, item.key));
      section.appendChild(more);
    }
    view.appendChild(section);
  });
  if (updateRoute) setRoute();
  window.scrollTo({ top: 0, behavior: "smooth" });
  $("#content").focus({ preventScroll: true });
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
  state.query = "";
  const search = params.get("search") || params.get("q");
  if (search) {
    renderCategories();
    return showSearch(search, params.get("group") || "all", false);
  }
  $("#searchInput").value = "";
  renderCategories();
  const item = params.get("item");
  if (item) openItem(item, false, Number(params.get("page")) || 0);
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
    showSearch(query);
  });
  $$('[data-popular]').forEach((button) => button.addEventListener("click", () => showSearch(button.dataset.popular)));
  $("#menuButton").addEventListener("click", () => {
    const panel = $("#categoryPanel");
    panel.classList.toggle("open");
    $("#menuButton").setAttribute("aria-expanded", String(panel.classList.contains("open")));
  });
  window.addEventListener("popstate", loadRoute);
  document.addEventListener("click", (event) => {
    $$(".download-menu[open]").forEach((menu) => { if (!menu.contains(event.target)) menu.open = false; });
  });
  window.addEventListener("keydown", (event) => { if (event.key === "Escape") closeMenu(); });
}

function alignSearchTitle() {
  // '통합검색' 글자를 아래 '업무매뉴얼' 탭 칸의 가운데에 맞춘다(넓은 화면에서만).
  const form = $("#searchForm");
  const tab = $(".tabs .width > :first-child");
  if (!form || !tab || window.innerWidth <= 760) {
    form?.style.removeProperty("--title-column");
    form?.style.removeProperty("--title-start");
    form?.style.removeProperty("--title-width");
    return;
  }
  const box = form.getBoundingClientRect();
  const cell = tab.getBoundingClientRect();
  const start = Math.max(0, cell.left - box.left);
  form.style.setProperty("--title-start", `${start}px`);
  form.style.setProperty("--title-width", `${cell.width}px`);
  form.style.setProperty("--title-column", `${start + cell.width}px`);
}

function main() {
  $("#exportDate").textContent = formatDate(`${data.exported_on}T00:00:00`);
  renderRelatedLinks();
  bindEvents();
  loadRoute();
  alignSearchTitle();
  window.addEventListener("resize", alignSearchTitle);
  document.fonts?.ready.then(alignSearchTitle);
}

main();
