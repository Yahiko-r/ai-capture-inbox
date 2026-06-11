const state = {
  view: "inbox",
  data: null,
  busy: false
};

const tauriInvoke = window.__TAURI__?.core?.invoke ?? null;
const remindedTaskIds = new Set();
const REMINDER_CHECK_INTERVAL_MS = 30_000;

const views = {
  inbox: {
    title: "Inbox",
    subtitle: "Pending captures"
  },
  review: {
    title: "Review",
    subtitle: "AI suggestions"
  },
  tasks: {
    title: "Tasks",
    subtitle: "Open work"
  },
  knowledge: {
    title: "Knowledge",
    subtitle: "Saved notes"
  }
};

const els = {
  providerLabel: document.querySelector("#providerLabel"),
  statusLine: document.querySelector("#statusLine"),
  contentList: document.querySelector("#contentList"),
  viewTitle: document.querySelector("#viewTitle"),
  viewSubtitle: document.querySelector("#viewSubtitle"),
  processAllButton: document.querySelector("#processAllButton"),
  refreshButton: document.querySelector("#refreshButton"),
  statInbox: document.querySelector("#statInbox"),
  statReview: document.querySelector("#statReview"),
  statTasks: document.querySelector("#statTasks"),
  statKnowledge: document.querySelector("#statKnowledge"),
  textCaptureForm: document.querySelector("#textCaptureForm"),
  textCaptureInput: document.querySelector("#textCaptureInput"),
  urlCaptureForm: document.querySelector("#urlCaptureForm"),
  urlCaptureInput: document.querySelector("#urlCaptureInput"),
  fileCaptureForm: document.querySelector("#fileCaptureForm"),
  fileCaptureInput: document.querySelector("#fileCaptureInput")
};

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view));
});

document.querySelectorAll(".tab").forEach((button) => {
  button.addEventListener("click", () => setCaptureMode(button.dataset.captureMode));
});

els.refreshButton.addEventListener("click", () => refresh());
els.processAllButton.addEventListener("click", () => processPending());
els.textCaptureForm.addEventListener("submit", submitTextCapture);
els.urlCaptureForm.addEventListener("submit", submitUrlCapture);
els.fileCaptureForm.addEventListener("submit", submitFileCapture);

await refresh();
startReminderLoop();

function setView(view) {
  state.view = view;
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  render();
}

function setCaptureMode(mode) {
  document.querySelectorAll(".tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.captureMode === mode);
  });
  document.querySelectorAll(".capture-form").forEach((form) => form.classList.remove("active"));
  document.querySelector(`#${mode}CaptureForm`).classList.add("active");
}

async function refresh() {
  setBusy(true, "Refreshing");
  try {
    state.data = await api("/api/state");
    render();
    setStatus("Ready");
    void checkDueReminders();
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusy(false);
  }
}

async function submitTextCapture(event) {
  event.preventDefault();
  const text = els.textCaptureInput.value.trim();
  if (!text) return;
  await action("Saving", async () => {
    await api("/api/captures/text", { method: "POST", body: { text } });
    els.textCaptureInput.value = "";
    await refresh();
  });
}

async function submitUrlCapture(event) {
  event.preventDefault();
  const url = els.urlCaptureInput.value.trim();
  if (!url) return;
  await action("Saving URL", async () => {
    await api("/api/captures/url", { method: "POST", body: { url } });
    els.urlCaptureInput.value = "";
    await refresh();
  });
}

async function submitFileCapture(event) {
  event.preventDefault();
  const file = els.fileCaptureInput.files?.[0];
  if (!file) return;
  await action("Saving file", async () => {
    if (tauriInvoke) {
      const dataBase64 = await readFileBase64(file);
      await invokeCommand("create_file_capture", {
        fileName: file.name,
        mimeType: file.type || null,
        dataBase64
      });
    } else {
      const formData = new FormData();
      formData.append("file", file);
      await fetchJson("/api/captures/file", { method: "POST", body: formData });
    }
    els.fileCaptureInput.value = "";
    await refresh();
  });
}

async function processPending(id = null) {
  await action("Processing", async () => {
    await api("/api/process", { method: "POST", body: id ? { id } : {} });
    await refresh();
    setView("review");
  });
}

async function acceptReview(id) {
  await action("Accepting", async () => {
    await api("/api/review/accept", { method: "POST", body: { id } });
    await refresh();
  });
}

async function dismissReview(id) {
  await action("Dismissing", async () => {
    await api("/api/review/dismiss", { method: "POST", body: { id } });
    await refresh();
  });
}

async function addTask(form) {
  const input = form.querySelector('[name="title"]');
  const dueInput = form.querySelector('[name="dueAt"]');
  const reminderInput = form.querySelector('[name="reminderAt"]');
  const title = input.value.trim();
  if (!title) return;
  await action("Adding task", async () => {
    await api("/api/tasks", {
      method: "POST",
      body: {
        title,
        dueAt: dateInputToIso(dueInput.value),
        reminderAt: dateTimeInputToIso(reminderInput.value)
      }
    });
    input.value = "";
    dueInput.value = "";
    reminderInput.value = "";
    await refresh();
  });
}

async function updateTaskSchedule(id, form) {
  const dueInput = form.querySelector('[name="dueAt"]');
  const reminderInput = form.querySelector('[name="reminderAt"]');
  await action("Saving schedule", async () => {
    await api("/api/tasks/schedule", {
      method: "POST",
      body: {
        id,
        dueAt: dateInputToIso(dueInput.value),
        reminderAt: dateTimeInputToIso(reminderInput.value)
      }
    });
    remindedTaskIds.delete(id);
    await refresh();
  });
}

async function completeTask(id) {
  await action("Completing", async () => {
    await api("/api/tasks/done", { method: "POST", body: { id } });
    await refresh();
  });
}

async function action(label, fn) {
  setBusy(true, label);
  try {
    await fn();
    setStatus("Ready");
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusy(false);
  }
}

async function api(path, options = {}) {
  if (tauriInvoke) {
    return apiViaTauri(path, options);
  }

  const init = {
    method: options.method ?? "GET",
    headers: { "content-type": "application/json" }
  };
  if (options.body) init.body = JSON.stringify(options.body);
  return fetchJson(path, init);
}

async function apiViaTauri(path, options = {}) {
  const body = options.body ?? {};
  const routes = {
    "GET /api/state": () => invokeCommand("get_state"),
    "POST /api/captures/text": () => invokeCommand("create_text_capture", { text: body.text }),
    "POST /api/captures/url": () => invokeCommand("create_url_capture", { url: body.url }),
    "POST /api/process": () => invokeCommand("process_captures", { id: body.id ?? null }),
    "POST /api/review/accept": () => invokeCommand("accept_review", { id: body.id }),
    "POST /api/review/dismiss": () => invokeCommand("dismiss_review", { id: body.id }),
    "POST /api/tasks": () => invokeCommand("create_task", {
      title: body.title,
      notes: body.notes ?? null,
      dueAt: body.dueAt ?? null,
      reminderAt: body.reminderAt ?? null
    }),
    "POST /api/tasks/schedule": () => invokeCommand("update_task_schedule", {
      id: body.id,
      dueAt: body.dueAt ?? null,
      reminderAt: body.reminderAt ?? null
    }),
    "POST /api/tasks/reminded": () => invokeCommand("mark_task_reminded", { id: body.id }),
    "POST /api/tasks/done": () => invokeCommand("complete_task", { id: body.id })
  };
  const key = `${options.method ?? "GET"} ${path}`;
  const route = routes[key];
  if (!route) throw new Error(`Unsupported Tauri route: ${key}`);
  return route();
}

async function invokeCommand(command, args = {}) {
  try {
    return await tauriInvoke(command, args);
  } catch (error) {
    throw new Error(typeof error === "string" ? error : error?.message ?? String(error));
  }
}

async function readFileBase64(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
    reader.addEventListener("error", () => reject(reader.error ?? new Error("Failed to read file.")));
    reader.readAsDataURL(file);
  });
  return dataUrl.split(",")[1] ?? "";
}

async function fetchJson(path, init = {}) {
  const response = await fetch(path, init);
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data;
}

function render() {
  if (!state.data) return;
  const view = views[state.view];
  els.viewTitle.textContent = view.title;
  els.viewSubtitle.textContent = view.subtitle;
  els.processAllButton.hidden = state.view !== "inbox";
  els.providerLabel.textContent = providerLabel();
  els.statInbox.textContent = state.data.stats.inbox;
  els.statReview.textContent = state.data.stats.review;
  els.statTasks.textContent = state.data.stats.tasksOpen;
  els.statKnowledge.textContent = state.data.stats.knowledge;

  const renderers = {
    inbox: renderInbox,
    review: renderReview,
    tasks: renderTasks,
    knowledge: renderKnowledge
  };

  renderers[state.view]();
}

function renderInbox() {
  const captures = state.data.captures.filter((capture) => ["pending", "failed"].includes(capture.status));
  renderItems(captures, renderCaptureItem);
}

function renderReview() {
  const captures = state.data.captures.filter((capture) => capture.reviewStatus === "pending");
  renderItems(captures, renderReviewItem);
}

function renderTasks() {
  const container = document.createDocumentFragment();
  const form = html(`
    <form class="task-form item">
      <input name="title" type="text" placeholder="New task">
      <input name="dueAt" type="date" aria-label="Due date">
      <input name="reminderAt" type="datetime-local" aria-label="Reminder time">
      <button class="primary-button" type="submit">Add</button>
    </form>
  `);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void addTask(form);
  });
  container.append(form);

  const tasks = state.data.tasks.filter((task) => task.status !== "done");
  if (tasks.length === 0) {
    container.append(emptyNode());
  } else {
    tasks.forEach((task) => container.append(renderTaskItem(task)));
  }
  replaceContent(container);
}

function renderKnowledge() {
  renderItems(state.data.knowledgeCards, renderKnowledgeItem);
}

function renderItems(items, renderer) {
  if (!items.length) {
    replaceContent(emptyNode());
    return;
  }
  const fragment = document.createDocumentFragment();
  items.forEach((item) => fragment.append(renderer(item)));
  replaceContent(fragment);
}

function renderCaptureItem(capture) {
  const node = html(`
    <article class="item">
      <div class="item-header">
        <div class="item-title">
          <h3>${escapeHtml(capture.title)}</h3>
          <div class="meta">
            <span class="badge">${escapeHtml(capture.sourceType)}</span>
            <span class="badge ${escapeHtml(capture.status)}">${escapeHtml(capture.status)}</span>
          </div>
        </div>
      </div>
      <div class="item-body">
        ${capture.extractionError ? `<p>${escapeHtml(capture.extractionError)}</p>` : ""}
        ${capture.ocrText ? `<p>${escapeHtml(trim(capture.ocrText, 260))}</p>` : ""}
        ${capture.normalizedText ? `<p>${escapeHtml(trim(capture.normalizedText, 220))}</p>` : ""}
      </div>
      <div class="item-actions">
        <button class="primary-button" type="button">Process</button>
      </div>
    </article>
  `);
  node.querySelector(".primary-button").addEventListener("click", () => processPending(capture.id));
  return node;
}

function renderReviewItem(capture) {
  const result = capture.aiResult;
  const tasks = result?.suggested_tasks ?? [];
  const points = result?.knowledge_points ?? [];
  const node = html(`
    <article class="item">
      <div class="item-header">
        <div class="item-title">
          <h3>${escapeHtml(result?.title ?? capture.title)}</h3>
          <div class="meta">
            <span class="badge ${escapeHtml(result?.category ?? "")}">${escapeHtml(result?.category ?? "review")}</span>
            <span class="badge">${escapeHtml(capture.sourceType)}</span>
            ${result?.confidence ? `<span class="badge">${Math.round(result.confidence * 100)}%</span>` : ""}
          </div>
        </div>
      </div>
      <div class="item-body">
        ${result?.summary ? `<p>${escapeHtml(result.summary)}</p>` : ""}
        ${result?.why_saved ? `<p>${escapeHtml(result.why_saved)}</p>` : ""}
        ${renderTags(result?.tags ?? [])}
      </div>
      ${renderSuggestedTasks(tasks)}
      ${renderKnowledgePoints(points)}
      <div class="item-actions">
        <button class="primary-button" type="button" data-action="accept">Accept</button>
        <button class="danger-button" type="button" data-action="dismiss">Dismiss</button>
      </div>
    </article>
  `);
  node.querySelector('[data-action="accept"]').addEventListener("click", () => acceptReview(capture.id));
  node.querySelector('[data-action="dismiss"]').addEventListener("click", () => dismissReview(capture.id));
  return node;
}

function renderTaskItem(task) {
  const node = html(`
    <article class="item task-row">
      <div>
        <h3>${escapeHtml(task.title)}</h3>
        ${task.notes ? `<p>${escapeHtml(task.notes)}</p>` : ""}
        <div class="meta">
          <span class="badge ${escapeHtml(task.priority)}">${escapeHtml(task.priority)}</span>
          <span class="badge">${escapeHtml(task.source)}</span>
          ${renderTaskTimeBadges(task)}
        </div>
        <form class="task-schedule-form">
          <label>
            <span>Due</span>
            <input name="dueAt" type="date" value="${escapeHtml(isoToDateInput(task.dueAt))}">
          </label>
          <label>
            <span>Remind</span>
            <input name="reminderAt" type="datetime-local" value="${escapeHtml(isoToDateTimeInput(task.reminderAt))}">
          </label>
          <button class="secondary-button" type="submit">Save date</button>
        </form>
      </div>
      <button class="secondary-button" type="button" data-action="done">Done</button>
    </article>
  `);
  node.querySelector(".task-schedule-form").addEventListener("submit", (event) => {
    event.preventDefault();
    void updateTaskSchedule(task.id, event.currentTarget);
  });
  node.querySelector('[data-action="done"]').addEventListener("click", () => completeTask(task.id));
  return node;
}

function renderKnowledgeItem(card) {
  return html(`
    <article class="item">
      <div class="item-title">
        <h3>${escapeHtml(card.title)}</h3>
        <div class="meta">${renderTags(card.tags)}</div>
      </div>
      <div class="item-body">
        <p>${escapeHtml(card.content)}</p>
      </div>
    </article>
  `);
}

function renderSuggestedTasks(tasks) {
  if (!tasks.length) return "";
  return `
    <ul class="sub-list">
      ${tasks.map((task) => `
        <li>
          <strong>${escapeHtml(task.title)}</strong>
          <div class="meta">
            <span class="badge ${escapeHtml(task.priority)}">${escapeHtml(task.priority)}</span>
          </div>
          ${task.reason ? `<p>${escapeHtml(task.reason)}</p>` : ""}
        </li>
      `).join("")}
    </ul>
  `;
}

function renderKnowledgePoints(points) {
  if (!points.length) return "";
  return `
    <ul class="sub-list">
      ${points.map((point) => `
        <li>
          <strong>${escapeHtml(point.title)}</strong>
          ${point.content ? `<p>${escapeHtml(point.content)}</p>` : ""}
        </li>
      `).join("")}
    </ul>
  `;
}

function renderTags(tags) {
  if (!tags.length) return "";
  return tags.map((tag) => `<span class="badge">${escapeHtml(tag)}</span>`).join("");
}

function renderTaskTimeBadges(task) {
  const badges = [];
  const due = parseDate(task.dueAt);
  if (due) {
    badges.push(`<span class="badge ${escapeHtml(dueBadgeClass(due))}">${escapeHtml(dueLabel(due))}</span>`);
  } else if (task.dueSuggestion) {
    badges.push(`<span class="badge">Suggested: ${escapeHtml(task.dueSuggestion)}</span>`);
  }
  if (task.reminderAt) {
    const reminder = parseDate(task.reminderAt);
    badges.push(`<span class="badge ${reminder && reminder <= new Date() && !task.remindedAt ? "reminder-due" : ""}">${escapeHtml(reminderLabel(task))}</span>`);
  }
  return badges.join("");
}

function startReminderLoop() {
  if (tauriInvoke) return;
  setInterval(() => {
    void checkDueReminders();
  }, REMINDER_CHECK_INTERVAL_MS);
}

async function checkDueReminders() {
  if (!state.data || state.busy) return;
  if (tauriInvoke) return;
  const now = new Date();
  const dueTasks = state.data.tasks.filter((task) => {
    const reminderAt = parseDate(task.reminderAt);
    return task.status === "open"
      && reminderAt
      && reminderAt <= now
      && !task.remindedAt
      && !remindedTaskIds.has(task.id);
  });

  for (const task of dueTasks) {
    remindedTaskIds.add(task.id);
    await showReminder(task);
    try {
      await api("/api/tasks/reminded", { method: "POST", body: { id: task.id } });
      task.remindedAt = new Date().toISOString();
    } catch (error) {
      setStatus(error.message);
    }
  }
  if (dueTasks.length && state.view === "tasks") render();
}

async function showReminder(task) {
  const title = "Task reminder";
  const body = task.title;
  if (tauriInvoke) {
    try {
      await invokeCommand("show_task_notification", { title, body });
      return;
    } catch (error) {
      setStatus(error.message);
    }
  }
  if ("Notification" in window) {
    try {
      const permission = Notification.permission === "default"
        ? await Notification.requestPermission()
        : Notification.permission;
      if (permission === "granted") {
        new Notification(title, { body });
        return;
      }
    } catch {
      // Fall through to the in-app status reminder.
    }
  }
  setStatus(`Reminder: ${task.title}`);
}

function replaceContent(node) {
  els.contentList.replaceChildren(node);
}

function emptyNode() {
  return document.querySelector("#emptyTemplate").content.cloneNode(true);
}

function html(value) {
  const template = document.createElement("template");
  template.innerHTML = value.trim();
  return template.content.firstElementChild;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function trim(value, length) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateInputToIso(value) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day, 23, 59, 59, 999).toISOString();
}

function dateTimeInputToIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isoToDateInput(value) {
  const date = parseDate(value);
  if (!date) return "";
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join("-");
}

function isoToDateTimeInput(value) {
  const date = parseDate(value);
  if (!date) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function dueLabel(due) {
  const today = startOfDay(new Date());
  const dueDay = startOfDay(due);
  const days = Math.round((dueDay - today) / 86_400_000);
  if (days < 0) return "Overdue";
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `Due ${formatDate(due)}`;
}

function dueBadgeClass(due) {
  const today = startOfDay(new Date());
  const dueDay = startOfDay(due);
  if (dueDay < today) return "overdue";
  if (dueDay.getTime() === today.getTime()) return "due-today";
  return "due-upcoming";
}

function reminderLabel(task) {
  if (task.remindedAt) return `Reminded ${formatDateTime(task.remindedAt)}`;
  return `Reminder ${formatDateTime(task.reminderAt)}`;
}

function formatDate(value) {
  const date = parseDate(value);
  if (!date) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatDateTime(value) {
  const date = parseDate(value);
  if (!date) return "";
  return `${formatDate(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function providerLabel() {
  const latest = state.data?.aiRuns?.[0];
  if (!latest) return tauriInvoke ? "Tauri local" : "Local first";
  if (latest.provider === "local-mock") return "Local mock";
  return latest.model ?? latest.provider;
}

function setBusy(value, label = "Working") {
  state.busy = value;
  document.querySelectorAll("button, input, textarea").forEach((control) => {
    if (control.id === "refreshButton") return;
    control.disabled = value;
  });
  if (value) setStatus(label);
}

function setStatus(message) {
  els.statusLine.textContent = message;
}
