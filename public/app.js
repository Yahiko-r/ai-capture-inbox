const state = {
  data: null,
  busy: false,
  view: "note",
  selectedNoteId: null,
  selectedBigNoteId: null,
  search: ""
};

const tauriInvoke = window.__TAURI__?.core?.invoke ?? null;

const els = {
  providerLabel: document.querySelector("#providerLabel"),
  statusLine: document.querySelector("#statusLine"),
  refreshButton: document.querySelector("#refreshButton"),
  searchInput: document.querySelector("#searchInput"),
  noteList: document.querySelector("#noteList"),
  bigNoteList: document.querySelector("#bigNoteList"),
  todoNavButton: document.querySelector("#todoNavButton"),
  newBigNoteButton: document.querySelector("#newBigNoteButton"),
  statNotes: document.querySelector("#statNotes"),
  statTasks: document.querySelector("#statTasks"),
  mainPanel: document.querySelector("#mainPanel"),
  textCaptureForm: document.querySelector("#textCaptureForm"),
  textCaptureInput: document.querySelector("#textCaptureInput"),
  urlCaptureForm: document.querySelector("#urlCaptureForm"),
  urlCaptureInput: document.querySelector("#urlCaptureInput"),
  fileCaptureForm: document.querySelector("#fileCaptureForm"),
  fileCaptureInput: document.querySelector("#fileCaptureInput")
};

document.querySelectorAll(".composer-tab").forEach((button) => {
  button.addEventListener("click", () => setCaptureMode(button.dataset.captureMode));
});

els.refreshButton.addEventListener("click", () => refresh());
els.todoNavButton.addEventListener("click", () => {
  state.view = "todos";
  render();
});
els.newBigNoteButton.addEventListener("click", () => createBigNote());
els.searchInput.addEventListener("input", () => {
  state.search = els.searchInput.value.trim();
  render();
});
els.textCaptureForm.addEventListener("submit", submitTextNote);
els.urlCaptureForm.addEventListener("submit", submitUrlNote);
els.fileCaptureForm.addEventListener("submit", submitFileNote);

await refresh();

function setCaptureMode(mode) {
  document.querySelectorAll(".composer-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.captureMode === mode);
  });
  document.querySelectorAll(".capture-form").forEach((form) => form.classList.remove("active"));
  document.querySelector(`#${mode}CaptureForm`).classList.add("active");
}

async function refresh() {
  setBusy(true, "Refreshing");
  try {
    state.data = await invokeCommand("get_state");
    ensureSelection();
    render();
    setStatus("Ready");
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusy(false);
  }
}

async function submitTextNote(event) {
  event.preventDefault();
  const text = els.textCaptureInput.value.trim();
  if (!text) return;
  await action("Creating note", async () => {
    const note = await invokeCommand("create_text_note", { text });
    els.textCaptureInput.value = "";
    await refresh();
    selectNote(note.id);
  });
}

async function submitUrlNote(event) {
  event.preventDefault();
  const url = els.urlCaptureInput.value.trim();
  if (!url) return;
  await action("Analyzing web", async () => {
    const note = await invokeCommand("create_url_note", { url });
    els.urlCaptureInput.value = "";
    await refresh();
    selectNote(note.id);
  });
}

async function submitFileNote(event) {
  event.preventDefault();
  const file = els.fileCaptureInput.files?.[0];
  if (!file) return;
  await action("Analyzing image", async () => {
    const dataBase64 = await readFileBase64(file);
    const note = await invokeCommand("create_file_note", {
      fileName: file.name,
      mimeType: file.type || null,
      dataBase64
    });
    els.fileCaptureInput.value = "";
    await refresh();
    selectNote(note.id);
  });
}

async function createBigNote() {
  await action("Creating big note", async () => {
    const bigNote = await invokeCommand("create_big_note", {
      title: "Untitled Note",
      contentMarkdown: ""
    });
    await refresh();
    selectBigNote(bigNote.id);
  });
}

async function saveBigNote(form, id) {
  const title = form.querySelector('[name="title"]').value;
  const contentMarkdown = form.querySelector('[name="contentMarkdown"]').value;
  await action("Saving note", async () => {
    await invokeCommand("update_big_note", { id, title, contentMarkdown });
    await refresh();
    selectBigNote(id);
  });
}

async function createTodoFromNote(note, form) {
  const title = form.querySelector('[name="title"]').value.trim();
  const dueAt = dateInputToIso(form.querySelector('[name="dueAt"]').value);
  const reminderAt = dateTimeInputToIso(form.querySelector('[name="reminderAt"]').value);
  if (!dueAt) {
    setStatus("Due date is required");
    return;
  }
  await action("Creating todo", async () => {
    await invokeCommand("create_todo_from_note", {
      noteId: note.id,
      title: title || note.title,
      dueAt,
      reminderAt
    });
    await refresh();
    state.view = "todos";
    render();
  });
}

async function addManualTodo(form) {
  const title = form.querySelector('[name="title"]').value.trim();
  const dueAt = dateInputToIso(form.querySelector('[name="dueAt"]').value);
  const reminderAt = dateTimeInputToIso(form.querySelector('[name="reminderAt"]').value);
  if (!title || !dueAt) {
    setStatus("Title and due date are required");
    return;
  }
  await action("Creating todo", async () => {
    await invokeCommand("create_task", { title, notes: null, dueAt, reminderAt });
    await refresh();
    state.view = "todos";
    render();
  });
}

async function completeTodo(id) {
  await action("Completing todo", async () => {
    await invokeCommand("complete_task", { id });
    await refresh();
    state.view = "todos";
    render();
  });
}

async function insertNoteIntoBigNote(noteId, bigNoteId) {
  await action("Inserting note", async () => {
    const bigNote = await invokeCommand("insert_note_into_big_note", {
      noteId,
      bigNoteId: bigNoteId || null
    });
    await refresh();
    selectBigNote(bigNote.id);
  });
}

async function insertTodoIntoBigNote(todoId, bigNoteId) {
  await action("Inserting todo", async () => {
    const bigNote = await invokeCommand("insert_todo_into_big_note", {
      todoId,
      bigNoteId: bigNoteId || null
    });
    await refresh();
    selectBigNote(bigNote.id);
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

async function invokeCommand(command, args = {}) {
  if (!tauriInvoke) {
    throw new Error("Tauri desktop runtime is required for this workspace.");
  }
  try {
    return await tauriInvoke(command, args);
  } catch (error) {
    throw new Error(typeof error === "string" ? error : error?.message ?? String(error));
  }
}

function ensureSelection() {
  const notes = state.data?.notes ?? [];
  const bigNotes = state.data?.bigNotes ?? [];
  if (state.selectedNoteId && !notes.some((note) => note.id === state.selectedNoteId)) {
    state.selectedNoteId = null;
  }
  if (state.selectedBigNoteId && !bigNotes.some((note) => note.id === state.selectedBigNoteId)) {
    state.selectedBigNoteId = null;
  }
  if (!state.selectedNoteId && notes.length) {
    state.selectedNoteId = notes[0].id;
    state.view = "note";
  } else if (!notes.length && !state.selectedBigNoteId && bigNotes.length) {
    state.selectedBigNoteId = bigNotes[0].id;
    state.view = "bigNote";
  }
}

function selectNote(id) {
  state.selectedNoteId = id;
  state.view = "note";
  render();
}

function selectBigNote(id) {
  state.selectedBigNoteId = id;
  state.view = "bigNote";
  render();
}

function render() {
  if (!state.data) return;
  const notes = filteredNotes();
  const bigNotes = filteredBigNotes();
  const tasks = sortedTasks(filteredTasks());

  els.providerLabel.textContent = providerLabel();
  els.statNotes.textContent = String(state.data.notes.length);
  els.statTasks.textContent = String(state.data.tasks.filter((task) => task.status !== "done").length);
  renderSidebar(notes, bigNotes);

  if (state.view === "todos") {
    renderTodos(tasks);
    return;
  }
  if (state.view === "bigNote") {
    renderBigNote();
    return;
  }
  renderNoteDetail();
}

function renderSidebar(notes, bigNotes) {
  els.noteList.replaceChildren(...notes.map((note) => {
    const button = html(`
      <button class="nav-row ${note.id === state.selectedNoteId && state.view === "note" ? "active" : ""}" type="button">
        <span>${escapeHtml(note.title)}</span>
        <small>${escapeHtml(note.sourceType)}</small>
      </button>
    `);
    button.addEventListener("click", () => selectNote(note.id));
    return button;
  }));

  els.todoNavButton.classList.toggle("active", state.view === "todos");

  els.bigNoteList.replaceChildren(...bigNotes.map((note) => {
    const button = html(`
      <button class="nav-row ${note.id === state.selectedBigNoteId && state.view === "bigNote" ? "active" : ""}" type="button">
        <span>${escapeHtml(note.title)}</span>
        <small>${escapeHtml(formatDate(note.updatedAt))}</small>
      </button>
    `);
    button.addEventListener("click", () => selectBigNote(note.id));
    return button;
  }));
}

function renderNoteDetail() {
  const note = state.data.notes.find((item) => item.id === state.selectedNoteId);
  if (!note) {
    renderEmpty("No note selected");
    return;
  }

  const bigNotes = state.data.bigNotes;
  const node = html(`
    <article class="document-view">
      <div class="doc-tags">
        <span class="pill">${escapeHtml(note.sourceType)}</span>
        ${note.aiCategory ? `<span class="pill">${escapeHtml(note.aiCategory)}</span>` : ""}
        ${note.status === "failed" ? `<span class="pill danger">failed</span>` : ""}
        ${note.aiTags.map((tag) => `<span class="pill">${escapeHtml(tag)}</span>`).join("")}
      </div>
      <h2>${escapeHtml(note.title)}</h2>
      ${note.sourceUrl ? `<a class="source-link" href="${escapeHtml(note.sourceUrl)}">${escapeHtml(note.sourceUrl)}</a>` : ""}
      ${note.imageDataUrl ? `<img class="note-image" src="${escapeHtml(note.imageDataUrl)}" alt="Original upload">` : ""}
      <section class="doc-section">
        <h3>AI Summary</h3>
        <p>${escapeHtml(note.aiSummary || note.extractedText || note.rawText || "")}</p>
      </section>
      <section class="doc-section muted-section">
        <h3>Original</h3>
        <pre>${escapeHtml(note.rawText || note.extractedText || note.filePath || "")}</pre>
      </section>
      ${note.processingError ? `<p class="error-line">${escapeHtml(note.processingError)}</p>` : ""}
      <div class="action-grid">
        <form class="action-card" data-action="todo">
          <h3>Set TODO</h3>
          <input name="title" type="text" value="${escapeHtml(note.title)}">
          <input name="dueAt" type="date" required>
          <input name="reminderAt" type="datetime-local">
          <button class="primary-button" type="submit">Create TODO</button>
        </form>
        <form class="action-card" data-action="insert">
          <h3>Insert to Big Note</h3>
          <select name="bigNoteId">
            <option value="">Latest big note</option>
            ${bigNotes.map((bigNote) => `<option value="${escapeHtml(bigNote.id)}">${escapeHtml(bigNote.title)}</option>`).join("")}
          </select>
          <button class="secondary-button" type="submit">Insert</button>
        </form>
      </div>
    </article>
  `);

  node.querySelector('[data-action="todo"]').addEventListener("submit", (event) => {
    event.preventDefault();
    void createTodoFromNote(note, event.currentTarget);
  });
  node.querySelector('[data-action="insert"]').addEventListener("submit", (event) => {
    event.preventDefault();
    void insertNoteIntoBigNote(note.id, event.currentTarget.querySelector('[name="bigNoteId"]').value);
  });
  replaceMain(node);
}

function renderTodos(tasks) {
  const bigNotes = state.data.bigNotes;
  const fragment = document.createDocumentFragment();
  const form = html(`
    <form class="todo-create">
      <input name="title" type="text" placeholder="New TODO">
      <input name="dueAt" type="date" required>
      <input name="reminderAt" type="datetime-local">
      <button class="primary-button" type="submit">Add</button>
    </form>
  `);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void addManualTodo(form);
  });
  fragment.append(form);

  if (!tasks.length) {
    fragment.append(emptyNode("No TODOs"));
  } else {
    tasks.forEach((task) => {
      const node = html(`
        <article class="todo-row ${task.status === "done" ? "done" : ""}">
          <div>
            <h3>${escapeHtml(task.title)}</h3>
            ${task.notes ? `<p>${escapeHtml(task.notes)}</p>` : ""}
            <div class="meta">
              <span class="pill">${escapeHtml(task.status)}</span>
              ${task.dueAt ? `<span class="pill">${escapeHtml(dueLabel(task.dueAt))}</span>` : ""}
              ${task.reminderAt ? `<span class="pill">Reminder ${escapeHtml(formatDateTime(task.reminderAt))}</span>` : ""}
            </div>
          </div>
          <div class="row-actions">
            <select name="bigNoteId">
              <option value="">Latest big note</option>
              ${bigNotes.map((bigNote) => `<option value="${escapeHtml(bigNote.id)}">${escapeHtml(bigNote.title)}</option>`).join("")}
            </select>
            <button class="secondary-button" data-action="insert" type="button">Insert</button>
            ${task.status === "done" ? "" : `<button class="primary-button" data-action="done" type="button">Done</button>`}
          </div>
        </article>
      `);
      node.querySelector('[data-action="insert"]').addEventListener("click", () => {
        void insertTodoIntoBigNote(task.id, node.querySelector('[name="bigNoteId"]').value);
      });
      node.querySelector('[data-action="done"]')?.addEventListener("click", () => completeTodo(task.id));
      fragment.append(node);
    });
  }

  replaceMain(html(`<section class="list-view"><h2>TODO</h2></section>`));
  els.mainPanel.querySelector(".list-view").append(fragment);
}

function renderBigNote() {
  let bigNote = state.data.bigNotes.find((item) => item.id === state.selectedBigNoteId);
  if (!bigNote && state.data.bigNotes.length) {
    bigNote = state.data.bigNotes[0];
    state.selectedBigNoteId = bigNote.id;
  }
  if (!bigNote) {
    renderEmpty("No big note yet");
    return;
  }

  const node = html(`
    <form class="big-note-editor">
      <input name="title" class="big-title" type="text" value="${escapeHtml(bigNote.title)}">
      <textarea name="contentMarkdown" class="markdown-editor">${escapeHtml(bigNote.contentMarkdown)}</textarea>
      <div class="editor-actions">
        <span>Updated ${escapeHtml(formatDateTime(bigNote.updatedAt))}</span>
        <button class="primary-button" type="submit">Save</button>
      </div>
    </form>
  `);
  node.addEventListener("submit", (event) => {
    event.preventDefault();
    void saveBigNote(node, bigNote.id);
  });
  replaceMain(node);
}

function filteredNotes() {
  const query = state.search.toLowerCase();
  const notes = state.data.notes ?? [];
  if (!query) return notes;
  return notes.filter((note) => searchableText(note).includes(query));
}

function filteredTasks() {
  const query = state.search.toLowerCase();
  const tasks = state.data.tasks ?? [];
  if (!query) return tasks;
  return tasks.filter((task) => searchableText(task).includes(query));
}

function filteredBigNotes() {
  const query = state.search.toLowerCase();
  const notes = state.data.bigNotes ?? [];
  if (!query) return notes;
  return notes.filter((note) => searchableText(note).includes(query));
}

function searchableText(item) {
  return JSON.stringify(item ?? {}).toLowerCase();
}

function sortedTasks(tasks) {
  return [...tasks].sort((a, b) => {
    if (a.status !== b.status) return a.status === "done" ? 1 : -1;
    return (parseDate(a.dueAt)?.getTime() ?? Number.MAX_SAFE_INTEGER)
      - (parseDate(b.dueAt)?.getTime() ?? Number.MAX_SAFE_INTEGER);
  });
}

function replaceMain(node) {
  els.mainPanel.replaceChildren(node);
}

function renderEmpty(message) {
  replaceMain(emptyNode(message));
}

function emptyNode(message = "No items") {
  return html(`<div class="empty-state"><h3>${escapeHtml(message)}</h3></div>`);
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

function dueLabel(value) {
  const date = parseDate(value);
  if (!date) return "";
  return `Due ${formatDate(date)}`;
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
  document.querySelectorAll("button, input, textarea, select").forEach((control) => {
    if (control.id === "refreshButton") return;
    control.disabled = value;
  });
  if (value) setStatus(label);
}

function setStatus(message) {
  els.statusLine.textContent = message;
}
