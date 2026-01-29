const noteGrid = document.getElementById("noteGrid");
const noteTitle = document.getElementById("noteTitle");
const noteContent = document.getElementById("noteContent");
const noteTag = document.getElementById("noteTag");
const noteMood = document.getElementById("noteMood");
const notePinned = document.getElementById("notePinned");
const saveNote = document.getElementById("saveNote");
const newNoteButton = document.getElementById("newNoteButton");
const clearButton = document.getElementById("clearButton");
const searchInput = document.getElementById("searchInput");
const tagList = document.getElementById("tagList");
const noteCount = document.getElementById("noteCount");
const pinnedCount = document.getElementById("pinnedCount");
const toast = document.getElementById("toast");
const viewButtons = document.querySelectorAll(".view-switch button");

const STORAGE_KEY = "velvet-notes";

let notes = JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? [];
let activeTag = "";
let activeView = "all";

const showToast = () => {
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2000);
};

const resetEditor = () => {
  noteTitle.value = "";
  noteContent.value = "";
  noteTag.value = "";
  noteMood.value = "serein";
  notePinned.checked = false;
};

const saveNotes = () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
};

const formatDate = (iso) =>
  new Date(iso).toLocaleDateString("fr-FR", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

const escapeHTML = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const renderTags = () => {
  const uniqueTags = Array.from(
    new Set(notes.flatMap((note) => note.tags))
  ).sort();
  tagList.innerHTML = uniqueTags
    .map(
      (tag) =>
        `<button class="tag ${tag === activeTag ? "active" : ""}" data-tag="${encodeURIComponent(
          tag
        )}">${escapeHTML(tag)}</button>`
    )
    .join("");

  tagList.querySelectorAll(".tag").forEach((button) => {
    button.addEventListener("click", () => {
      const decodedTag = decodeURIComponent(button.dataset.tag ?? "");
      activeTag = decodedTag === activeTag ? "" : decodedTag;
      render();
    });
  });
};

const createCard = (note) => {
  const tagMarkup = note.tags
    .map((tag) => `<span class="tag">${escapeHTML(tag)}</span>`)
    .join("");

  return `
    <article class="note-card" data-id="${note.id}">
      <div>
        <h3>${escapeHTML(note.title)}</h3>
        <p>${escapeHTML(note.content)}</p>
      </div>
      <div class="note-meta">
        <span>${formatDate(note.createdAt)}</span>
        <span class="note-mood">${escapeHTML(note.mood)}</span>
      </div>
      <div class="note-meta">
        <div class="tag-list">${tagMarkup}</div>
      </div>
      <div class="note-actions">
        <button data-action="pin">${note.pinned ? "Désépingler" : "Épingler"}</button>
        <button class="delete" data-action="delete">Supprimer</button>
      </div>
    </article>
  `;
};

const updateCounts = () => {
  noteCount.textContent = notes.length;
  pinnedCount.textContent = notes.filter((note) => note.pinned).length;
};

const render = () => {
  const query = searchInput.value.toLowerCase();
  const filtered = notes.filter((note) => {
    const matchesTag = activeTag ? note.tags.includes(activeTag) : true;
    const matchesSearch =
      note.title.toLowerCase().includes(query) ||
      note.content.toLowerCase().includes(query) ||
      note.tags.some((tag) => tag.toLowerCase().includes(query));
    const matchesView = activeView === "all" ? true : note.pinned;
    return matchesTag && matchesSearch && matchesView;
  });

  noteGrid.innerHTML = filtered
    .sort((a, b) => Number(b.pinned) - Number(a.pinned))
    .map((note) => createCard(note))
    .join("");

  noteGrid.querySelectorAll("button").forEach((button) => {
    const action = button.dataset.action;
    if (!action) {
      return;
    }

    button.addEventListener("click", () => {
      const card = button.closest(".note-card");
      const note = notes.find((item) => item.id === card?.dataset.id);
      if (!note) {
        return;
      }

      if (action === "pin") {
        note.pinned = !note.pinned;
      }

      if (action === "delete") {
        notes = notes.filter((item) => item.id !== note.id);
      }

      saveNotes();
      render();
    });
  });

  renderTags();
  updateCounts();
};

saveNote.addEventListener("click", () => {
  if (!noteTitle.value.trim() || !noteContent.value.trim()) {
    toast.textContent = "Ajoute un titre et du contenu ✍️";
    showToast();
    return;
  }

  const tags = noteTag.value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

  const newNote = {
    id: crypto.randomUUID(),
    title: noteTitle.value.trim(),
    content: noteContent.value.trim(),
    tags,
    mood: noteMood.value,
    pinned: notePinned.checked,
    createdAt: new Date().toISOString(),
  };

  notes = [newNote, ...notes];
  saveNotes();
  resetEditor();
  toast.textContent = "Note enregistrée ✨";
  showToast();
  render();
});

newNoteButton.addEventListener("click", () => {
  resetEditor();
  noteTitle.focus();
});

clearButton.addEventListener("click", () => {
  notes = [];
  saveNotes();
  render();
  toast.textContent = "Toutes les notes ont disparu.";
  showToast();
});

searchInput.addEventListener("input", render);

viewButtons.forEach((button) => {
  button.addEventListener("click", () => {
    viewButtons.forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    activeView = button.dataset.view;
    render();
  });
});

render();
