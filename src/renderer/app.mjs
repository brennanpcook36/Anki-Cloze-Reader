import * as pdfjsLib from "../../node_modules/pdfjs-dist/build/pdf.mjs";
import { escapeHtml, makeCloze, resolveClozeFields, sentenceAround, storageKey } from "./card-utils.mjs";
import { pageSequence, renderIsCurrent } from "./render-utils.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("../../node_modules/pdfjs-dist/build/pdf.worker.mjs", import.meta.url).href;
const $ = selector => document.querySelector(selector);
const reader = $("#reader");
function readLocal(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
let profiles = readLocal("cr:profiles", []);
let activeProfile = localStorage.getItem("cr:active-profile") || "";
const readingMemory = readLocal("cr:reading-memory", {});
const undoHistory = new Map();
let restoringReading = false;
function studyProfile(mode) { return mode === "interpretative" ? (profiles.find(p => p.id === activeProfile)?.description || "") : ""; }
function placement(item) { return item.frontImageId ? "occlusion" : (item.imagePlacement || "front-below"); }

const state = {
  pdf: null, fingerprint: null, fileName: "", currentDocumentId: null, renameTarget: null,
  highlights: [], pendingSelection: null, pageText: new Map(), screenshotSession: null, occlusionDraft: null,
  aiEnabled: localStorage.getItem("cloze-reader:ai-enabled") !== "false",
  mode: localStorage.getItem("cloze-reader:mode") === "interpretative" ? "interpretative" : "verbatim",
  renderSession: 0, renderObserver: null, renderCleanup: null
};

const documents = new Map();
const syncing = new Set();
let autoSync = localStorage.getItem("cloze-reader:auto-sync") === "true";
function saveStateOnly() {
  for (const [key, cards] of documents) localStorage.setItem(storageKey(key), JSON.stringify(cards));
  if (state.fingerprint) localStorage.setItem(storageKey(state.fingerprint), JSON.stringify(state.highlights));
}
function saveState() { saveStateOnly(); renderSidebar(); }
function toast(message) {
  const element = $("#toast"); element.textContent = message; element.classList.add("show");
  clearTimeout(toast.timer); toast.timer = setTimeout(() => element.classList.remove("show"), 3000);
}
function stateLabel(item) {
  return ({ syncing: "Syncing…", generating: "Generating…", synced: "In Anki", queued: "Anki queued", "needs-key": "Needs API key", error: "Needs attention", draft: "Local draft" })[item.status] || "Local draft";
}

function sanitizeBackHtml(html) {
  const document = new DOMParser().parseFromString(String(html || ""), "text/html");
  const allowed = new Set(["DIV", "P", "BR", "B", "STRONG", "I", "EM", "UL", "OL", "LI", "IMG"]);
  [...document.body.querySelectorAll("*")].forEach(node => {
    if (!allowed.has(node.tagName)) return node.replaceWith(...node.childNodes);
    [...node.attributes].forEach(attribute => {
      if (node.tagName === "IMG" && attribute.name === "src" && /^(data:image\/(png|jpeg|gif|webp);base64,)/i.test(attribute.value)) return;
      node.removeAttribute(attribute.name);
    });
  });
  return document.body.innerHTML;
}

function insertImageAtCursor(editor, dataUrl) {
  editor.focus();
  const image = document.createElement("img"); image.src = dataUrl; image.alt = "Pasted card image";
  const selection = window.getSelection();
  if (selection?.rangeCount && editor.contains(selection.anchorNode)) {
    const range = selection.getRangeAt(0); range.deleteContents(); range.insertNode(image); range.collapse(false);
  } else editor.append(image);
  editor.dispatchEvent(new Event("input", { bubbles: true }));
}

function insertPastedImage(editor, file) {
  const reader = new FileReader();
  reader.onload = () => insertImageAtCursor(editor, reader.result);
  reader.readAsDataURL(file);
}

function renderSidebar() {
  const list = $("#cards-list");
  $("#undo-remove").disabled = !(undoHistory.get(state.fingerprint)?.length);
  $("#card-count").textContent = state.highlights.length;
  $("#sidebar-empty").hidden = state.highlights.length > 0;
  $("#sync-all-button").disabled = !state.highlights.some(item => item.cloze && item.status !== "synced" && item.status !== "generating");
  $("#clear-all-button").disabled = state.highlights.length === 0;
  list.replaceChildren();
  [...state.highlights].reverse().forEach(item => {
    const card = document.createElement("article");
    const stateClass = item.status === "synced" ? "state-synced" : (["error", "needs-key"].includes(item.status) ? "state-error" : "");
    card.className = `card-item ${item.status === "generating" ? "generating" : ""}`;
    card.innerHTML = `<div class="card-top"><span>Page ${item.page} · ${item.kind === "screenshot" ? "Screenshot" : (item.mode === "interpretative" ? "Interpretative" : "Verbatim")}</span><span class="card-state ${stateClass}"><i class="state-dot"></i>${stateLabel(item)}</span></div>
      ${(item.frontImageId || item.originalImageId) ? '<img class="card-image-preview" alt="Card screenshot preview" />' : ""}
      <textarea class="card-cloze" ${item.status === "generating" ? "disabled" : ""}>${escapeHtml(item.cloze || "Creating your cloze card…")}</textarea>
      <p class="card-source">${escapeHtml(item.sourceText || item.selectedText || (item.kind === "screenshot" ? "PDF screenshot" : ""))}</p>
      <div class="back-editor-wrap" hidden><span class="back-label">BACK OF CARD</span><div class="back-editor" contenteditable="true">${sanitizeBackHtml(item.extraHtml)}</div></div>
      <div class="card-actions">${item.cloze ? '<button class="mini-button edit-back">Edit back</button>' : ""}<button class="mini-button save">Save & sync</button>${["error", "needs-key"].includes(item.status) ? '<button class="mini-button regenerate">Regenerate</button>' : ""}<button class="mini-button delete">Remove here</button></div>
      ${item.cloze ? `<div class="more-cards"><label>More cards <select class="more-count">${Array.from({ length: 10 }, (_, index) => `<option value="${index + 1}"${index === 2 ? " selected" : ""}>${index + 1}</option>`).join("")}</select></label><button class="mini-button generate-more" ${item.batchGenerating ? "disabled" : ""}>${item.batchGenerating ? "Generating…" : "Generate more"}</button></div>` : ""}`;
    card.querySelector(".card-cloze").addEventListener("input", event => { item.cloze = event.target.value; if (item.status !== "generating") item.status = "draft"; saveStateOnly(); $("#sync-all-button").disabled = false; });
    const preview = card.querySelector(".card-image-preview");
    if (preview) window.clozeReader.loadScreenshot(item.frontImageId || item.originalImageId).then(dataUrl => { preview.src = dataUrl; }).catch(() => preview.remove());
    card.querySelector(".save").disabled = syncing.has(item.id) || item.status === "generating";
    card.querySelector(".card-cloze").disabled = syncing.has(item.id) || item.status === "generating";
    const previewButton = document.createElement("button"); previewButton.className = "mini-button"; previewButton.textContent = "Preview"; card.querySelector(".card-actions").prepend(previewButton);
    previewButton.addEventListener("click", () => previewCard(item));
    card.querySelector(".save").addEventListener("click", () => syncCard(item));
    const backWrap = card.querySelector(".back-editor-wrap"), backEditor = card.querySelector(".back-editor"), backButton = card.querySelector(".edit-back");
    backButton?.addEventListener("click", () => { backWrap.hidden = !backWrap.hidden; backButton.textContent = backWrap.hidden ? "Edit back" : "Hide back"; if (!backWrap.hidden) backEditor.focus(); });
    backEditor.contentEditable = syncing.has(item.id) ? "false" : "true";
    backEditor.addEventListener("input", () => { item.extraHtml = sanitizeBackHtml(backEditor.innerHTML); if (item.status !== "generating") item.status = "draft"; saveStateOnly(); $("#sync-all-button").disabled = false; });
    backEditor.addEventListener("paste", async event => {
      const imageItem = [...event.clipboardData.items].find(item => item.type.startsWith("image/"));
      const imageFile = imageItem?.getAsFile() || [...event.clipboardData.files].find(file => file.type.startsWith("image/"));
      if (imageFile) { event.preventDefault(); insertPastedImage(backEditor, imageFile); return; }
      if ((event.clipboardData.getData("text/html") || "").includes("<img")) {
        event.preventDefault();
        const dataUrl = await window.clozeReader.readClipboardImage();
        if (dataUrl) insertImageAtCursor(backEditor, dataUrl);
        else {
          const text = event.clipboardData.getData("text/plain");
          document.execCommand("insertText", false, text);
        }
      }
    });
    card.querySelector(".regenerate")?.addEventListener("click", () => generateCard(item, item.kind !== "screenshot"));
    card.querySelector(".generate-more")?.addEventListener("click", () => generateMoreCards(item, Number(card.querySelector(".more-count").value)));
    const actions = card.querySelector(".card-actions");
    const source = documentElement("button", "mini-button"); source.textContent = "Source"; source.addEventListener("click", () => jumpToSource(item)); actions.prepend(source);
    const improve = documentElement("button", "mini-button"); improve.textContent = "Improve"; improve.disabled = !item.cloze || syncing.has(item.id); improve.addEventListener("click", () => openImprove(item)); actions.prepend(improve);
    if (item.originalImageId && !item.frontImageId) {
      const label = documentElement("label", "placement-control"); label.textContent = "Screenshot ";
      const select = document.createElement("select"); [["front-below", "Front"], ["back", "Back"], ["none", "Neither"]].forEach(([value,text]) => select.add(new Option(text,value)));
      select.value = placement(item); select.disabled = syncing.has(item.id); select.addEventListener("change", () => { item.imagePlacement = select.value; item.status = "draft"; saveState(); }); label.append(select); card.append(label);
    }
    card.querySelector(".delete").addEventListener("click", () => deleteCard(item));
    list.append(card);
  });
  const queued = state.highlights.filter(item => item.status === "queued").length;
  $("#retry-button").hidden = queued === 0;
  $("#retry-button").textContent = `Retry queued (${queued})`;
}

let ankiWasConnected = false;

async function refreshAnkiDecks() {
  const decks = await window.clozeReader.ankiRequest({ action: "deckNames" });
  const select = $("#deck-select"), previous = select.value;
  const sortedDecks = [...decks].sort();
  select.replaceChildren(...sortedDecks.map(deck => new Option(deck, deck)));
  select.value = sortedDecks.includes(previous) ? previous : (sortedDecks.includes("Default") ? "Default" : sortedDecks[0]);
}

async function refreshAnkiConnection({ refreshDecks = false } = {}) {
  let ankiConnected = false;
  try {
    await window.clozeReader.ankiRequest({ action: "version" });
    if (refreshDecks || !ankiWasConnected) await refreshAnkiDecks();
    $("#anki-status").textContent = "Anki connected"; $("#anki-status").className = "status online";
    ankiConnected = true; ankiWasConnected = true;
  } catch {
    ankiWasConnected = false;
    const running = await window.clozeReader.isAnkiRunning().catch(() => false);
    $("#anki-status").textContent = running ? "AnkiConnect unavailable" : "Anki closed"; $("#anki-status").className = "status offline";
  }
  return ankiConnected;
}

async function refreshAIConnection() {
  const ai = await window.clozeReader.openAIStatus();
  $("#ai-status").textContent = ai.configured ? "AI ready" : "AI not configured";
  $("#ai-status").className = `status ${ai.configured ? "online" : "offline"}`;
}

async function refreshConnections(options = {}) {
  const ankiConnected = await refreshAnkiConnection(options);
  await refreshAIConnection();
  return ankiConnected;
}

async function refreshLibrary() {
  const documents = await window.clozeReader.listPdfs();
  const list = $("#library-list"); list.replaceChildren();
  $("#library-empty").hidden = documents.length > 0;
  documents.forEach(document => {
    const button = documentElement("button", "library-item");
    if (document.id === state.currentDocumentId) button.classList.add("active");
    button.innerHTML = `<span class="library-pdf-icon">PDF</span><span class="library-name">${escapeHtml(document.name)}</span>`;
    button.title = document.name;
    button.addEventListener("click", async () => loadPdfFile(await window.clozeReader.loadPdf(document.id)));
    button.addEventListener("contextmenu", event => {
      event.preventDefault(); state.renameTarget = { id: document.id, name: document.name };
      const menu = $("#library-context-menu");
      menu.style.left = `${Math.min(window.innerWidth - 165, event.clientX)}px`;
      menu.style.top = `${Math.min(window.innerHeight - 88, event.clientY)}px`;
      menu.hidden = false;
    });
    list.append(button);
  });
}

function documentElement(tag, className) {
  const element = document.createElement(tag); element.className = className; return element;
}

async function importPdf() {
  const file = await window.clozeReader.openPdf(); if (!file) return;
  await loadPdfFile(file); await refreshLibrary();
}

async function loadPdfFile(file, requestedPage = null) {
  const session = ++state.renderSession;
  rememberReading(); restoringReading = true;
  cancelPending(); cancelScreenshotMode();
  state.renderCleanup?.(); state.renderCleanup = null; state.renderObserver = null;
  const previousPdf = state.pdf;
  state.pdf = null;
  try { await previousPdf?.destroy(); } catch {}
  const pdf = await pdfjsLib.getDocument({ data: file.bytes }).promise;
  if (session !== state.renderSession) { try { await pdf.destroy(); } catch {} return; }
  state.currentDocumentId = file.id;
  state.pdf = pdf;
  state.fingerprint = pdf.fingerprints?.[0] || `${file.name}:${file.bytes.length}`;
  state.fileName = file.name; state.pageText.clear();
  if (!documents.has(state.fingerprint)) {
    let cards; try { cards = JSON.parse(localStorage.getItem(storageKey(state.fingerprint))) || []; } catch { cards = []; }
    cards.forEach(card => { card.batchGenerating = false; if (["generating", "syncing"].includes(card.status)) card.status = "draft"; });
    documents.set(state.fingerprint, cards);
  }
  state.highlights = documents.get(state.fingerprint);
  const memory = readingMemory[state.fingerprint];
  if (memory) {
    activeProfile = profiles.some(p => p.id === memory.profile) ? memory.profile : ""; updateProfiles();
    if (memory.deck) { if (![...$("#deck-select").options].some(o => o.value === memory.deck)) $("#deck-select").add(new Option(memory.deck, memory.deck)); $("#deck-select").value = memory.deck; }
  }
  const requested = Number(requestedPage);
  const hasRequestedPage = Number.isInteger(requested) && requested >= 1;
  const requestedIsValid = hasRequestedPage && requested <= pdf.numPages;
  const destinationPage = requestedIsValid ? requested : Math.min(pdf.numPages, Math.max(1, Number(memory?.page || 1)));
  const destinationOffset = requestedIsValid ? 0 : Number(memory?.offset || 0);
  $("#document-name").textContent = file.name; $("#empty-state").hidden = true; reader.hidden = false; $("#home-button").hidden = false;
  reader.replaceChildren(); renderSidebar(); await renderDocument(pdf, session, destinationPage, destinationOffset);
  if (!renderIsCurrent(session, state.renderSession, pdf, state.pdf)) return;
  await refreshLibrary();
  restoringReading = false;
  if (hasRequestedPage && !requestedIsValid) toast(`This PDF has ${pdf.numPages} pages.`);
  else if (requestedIsValid) { rememberReading(); toast(`Opened ${file.name} at PDF page ${requested}.`); }

}

async function closePdf() {
  ++state.renderSession;
  rememberReading();
  cancelPending(); cancelScreenshotMode();
  state.renderCleanup?.(); state.renderCleanup = null; state.renderObserver = null;
  try { await state.pdf?.destroy(); } catch {}
  state.pdf = null; state.fingerprint = null; state.fileName = ""; state.currentDocumentId = null; state.highlights = []; state.pageText.clear();
  reader.replaceChildren(); reader.hidden = true; $("#empty-state").hidden = false; $("#viewer-column").scrollTop = 0;
  $("#document-name").textContent = "No PDF open"; $("#home-button").hidden = true;
  renderSidebar(); await refreshLibrary();
}

async function renderDocument(pdf, session, initialPage = 1, initialOffset = 0) {
  const maxWidth = Math.min(820, Math.max(420, window.innerWidth - 700));
  let referencePage;
  try { referencePage = await pdf.getPage(initialPage); } catch (error) { if (!renderIsCurrent(session, state.renderSession, pdf, state.pdf)) return; throw error; }
  if (!renderIsCurrent(session, state.renderSession, pdf, state.pdf)) return;
  const referenceBase = referencePage.getViewport({ scale: 1 });
  const referenceViewport = referencePage.getViewport({ scale: maxWidth / referenceBase.width });
  const pageElements = new Map(), renderTasks = new Map();
  for (const pageNumber of pageSequence(pdf.numPages)) {
    const pageElement = document.createElement("article"); pageElement.className = "pdf-page"; pageElement.dataset.page = pageNumber;
    pageElement.dataset.rendered = "false";
    pageElement.style.width = `${referenceViewport.width}px`; pageElement.style.height = `${referenceViewport.height}px`;
    const number = document.createElement("span"); number.className = "page-number"; number.textContent = pageNumber; pageElement.append(number);
    pageElements.set(pageNumber, pageElement); reader.append(pageElement);
  }
  const initialElement = pageElements.get(initialPage);
  $("#viewer-column").scrollTop = initialElement.offsetTop + initialOffset * initialElement.offsetHeight;

  const renderPage = pageNumber => {
    if (renderTasks.has(pageNumber)) return renderTasks.get(pageNumber);
    const task = (async () => {
      if (!renderIsCurrent(session, state.renderSession, pdf, state.pdf)) return;
      let page;
      try { page = pageNumber === initialPage ? referencePage : await pdf.getPage(pageNumber); }
      catch (error) { if (!renderIsCurrent(session, state.renderSession, pdf, state.pdf)) return; throw error; }
      if (!renderIsCurrent(session, state.renderSession, pdf, state.pdf)) return;
      const base = page.getViewport({ scale: 1 }), viewport = page.getViewport({ scale: maxWidth / base.width });
    const pageElement = pageElements.get(pageNumber);
    const pageNumberLabel = pageElement.querySelector(".page-number");
    for (const staleCanvas of pageElement.querySelectorAll("canvas")) staleCanvas.width = staleCanvas.height = 0;
    pageElement.replaceChildren(pageNumberLabel);
    pageElement.style.width = `${viewport.width}px`; pageElement.style.height = `${viewport.height}px`;
    const canvas = document.createElement("canvas"), outputScale = window.devicePixelRatio || 1;
    canvas.width = Math.floor(viewport.width * outputScale); canvas.height = Math.floor(viewport.height * outputScale);
    canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`; pageElement.append(canvas);
    const textLayer = document.createElement("div"); textLayer.className = "textLayer"; pageElement.append(textLayer);
    const highlightLayer = document.createElement("div"); highlightLayer.className = "highlight-layer"; pageElement.append(highlightLayer);
    try { await page.render({ canvasContext: canvas.getContext("2d"), viewport, transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0] }).promise; }
    catch (error) { if (!renderIsCurrent(session, state.renderSession, pdf, state.pdf)) return; throw error; }
    if (!renderIsCurrent(session, state.renderSession, pdf, state.pdf)) return;
    const textContent = await page.getTextContent();
    if (!renderIsCurrent(session, state.renderSession, pdf, state.pdf)) return;
    state.pageText.set(pageNumber, textContent.items.map(item => item.str).join(" "));
    await new pdfjsLib.TextLayer({ textContentSource: textContent, container: textLayer, viewport }).render();
    if (!renderIsCurrent(session, state.renderSession, pdf, state.pdf)) return;
    pageElement.dataset.rendered = "true";
    renderHighlights(pageNumber);
    })();
    renderTasks.set(pageNumber, task);
    task.then(() => renderTasks.delete(pageNumber), () => renderTasks.delete(pageNumber));
    return task;
  };

  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) void renderPage(Number(entry.target.dataset.page)).catch(error => toast(error.message));
  }, { root: $("#viewer-column"), rootMargin: "1200px 0px", threshold: 0.01 });
  state.renderObserver = observer;
  for (const element of pageElements.values()) observer.observe(element);
  const viewer = $("#viewer-column");
  let unloadTimer = null;
  const unloadDistantPages = () => {
    const viewportHeight = viewer.clientHeight, viewerRect = viewer.getBoundingClientRect();
    for (const [pageNumber, element] of pageElements) {
      if (element.dataset.rendered !== "true" || renderTasks.has(pageNumber)) continue;
      const rect = element.getBoundingClientRect();
      if (rect.bottom >= viewerRect.top - viewportHeight * 4 && rect.top <= viewerRect.bottom + viewportHeight * 4) continue;
      const number = element.querySelector(".page-number");
      for (const canvas of element.querySelectorAll("canvas")) canvas.width = canvas.height = 0;
      element.replaceChildren(number); element.dataset.rendered = "false"; state.pageText.delete(pageNumber);
    }
  };
  const scheduleUnload = () => { clearTimeout(unloadTimer); unloadTimer = setTimeout(unloadDistantPages, 250); };
  viewer.addEventListener("scroll", scheduleUnload, { passive: true });
  state.renderCleanup = () => { observer.disconnect(); viewer.removeEventListener("scroll", scheduleUnload); clearTimeout(unloadTimer); };
  await renderPage(initialPage);
  const nearby = [initialPage - 2, initialPage - 1, initialPage + 1, initialPage + 2].filter(page => page >= 1 && page <= pdf.numPages);
  void Promise.all(nearby.map(renderPage)).catch(error => toast(error.message));
}

function renderHighlights(pageNumber) {
  const page = reader.querySelector(`[data-page="${pageNumber}"]`); if (!page) return;
  const layer = page.querySelector(".highlight-layer"); if (!layer) return; layer.replaceChildren();
  state.highlights.filter(item => item.page === pageNumber).forEach(item => item.rects.forEach(rect => {
    const mark = document.createElement("span"); mark.className = `highlight${item.kind === "screenshot" ? " screenshot-highlight" : ""}`;
    Object.assign(mark.style, { left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` }); layer.append(mark);
  }));
}

function captureSelection() {
  const selection = window.getSelection(), text = selection?.toString().replace(/\s+/g, " ").trim();
  if (!text || selection.rangeCount === 0) return cancelPending();
  const range = selection.getRangeAt(0), parent = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
  const page = parent?.closest?.(".pdf-page");
  if (!page || !page.contains(range.startContainer) || !page.contains(range.endContainer)) return cancelPending();
  const bounds = page.getBoundingClientRect();
  const rects = [...range.getClientRects()].filter(rect => rect.width > 1 && rect.height > 1).map(rect => ({ x: (rect.left - bounds.left) / bounds.width, y: (rect.top - bounds.top) / bounds.height, width: rect.width / bounds.width, height: rect.height / bounds.height }));
  if (!rects.length) return cancelPending();
  state.pendingSelection = { page: Number(page.dataset.page), sourceText: text, rects };
  const lastRect = range.getBoundingClientRect(), prompt = $("#selection-prompt");
  prompt.style.left = `${Math.min(window.innerWidth - 225, Math.max(12, lastRect.right + 8))}px`; prompt.style.top = `${Math.min(window.innerHeight - 48, Math.max(76, lastRect.bottom + 7))}px`; prompt.hidden = false;
}

function cancelPending() { state.pendingSelection = null; $("#selection-prompt").hidden = true; window.getSelection()?.removeAllRanges(); }
async function commitPending() {
  if (!state.pendingSelection) return;
  const pending = state.pendingSelection, pageText = state.pageText.get(pending.page) || pending.sourceText;
  const context = sentenceAround(pageText, pending.sourceText);
  const item = { id: crypto.randomUUID(), kind: "text", mode: state.mode, documentId: state.currentDocumentId, fileName: state.fileName, page: pending.page, sourceText: pending.sourceText, rects: pending.rects, context, cloze: "", extraHtml: "", deck: $("#deck-select").value || "Default", tags: ["pdf-reading", state.mode, state.aiEnabled ? "ai-cloze" : "manual-cloze"], status: state.aiEnabled ? "generating" : "draft", createdAt: new Date().toISOString() };
  if (!state.aiEnabled) item.cloze = makeCloze(context, pending.sourceText);
  state.highlights.push(item); cancelPending(); saveState(); renderHighlights(item.page);
  if (state.aiEnabled) await generateCard(item); else if (autoSync) await syncCard(item);
}

async function generateCard(item, syncAfter = true) {
  item.status = "generating"; item.error = ""; saveState();
  try {
    const result = item.kind === "screenshot"
      ? await window.clozeReader.generateScreenshotCard({ studyProfile: studyProfile("interpretative"), imageDataUrl: await window.clozeReader.loadScreenshot(item.originalImageId), fileName: item.fileName || state.fileName, page: item.page })
      : await window.clozeReader.generateCloze({ studyProfile: studyProfile(item.mode), mode: item.mode || "verbatim", sourceText: item.sourceText || item.selectedText, context: item.context || item.sourceText || item.selectedText, fileName: item.fileName || state.fileName, page: item.page });
    if (![...documents.values()].some(cards => cards.includes(item))) return;
    item.cloze = result.cloze; item.status = "draft"; saveState();
    if (autoSync) await syncCard(item); else toast("Screenshot card ready to review in the sidebar.");
  } catch (error) {
    item.status = error.message === "OPENAI_KEY_MISSING" ? "needs-key" : "error"; item.error = error.message; saveState();
    if (item.status === "needs-key") $("#settings-dialog").showModal(); else toast(error.message);
  }
}

async function generateMoreCards(sourceItem, requestedCount) {
  const count = Math.max(1, Math.min(10, Number(requestedCount) || 1));
  if (sourceItem.batchGenerating) return;
  const targetCards = state.highlights;
  sourceItem.batchGenerating = true; saveState();
  try {
    const sameSource = item => sourceItem.kind === "screenshot"
      ? item.originalImageId === sourceItem.originalImageId
      : item.kind === "text" && item.sourceText === sourceItem.sourceText && item.page === sourceItem.page;
    const existingCards = state.highlights
      .filter(item => sameSource(item) && item.cloze)
      .map(item => item.cloze);
    const result = sourceItem.kind === "screenshot"
      ? await window.clozeReader.generateScreenshotCards({ studyProfile: studyProfile(sourceItem.mode), imageDataUrl: await window.clozeReader.loadScreenshot(sourceItem.originalImageId), mode: sourceItem.mode || "verbatim", count, existingCards, fileName: sourceItem.fileName || state.fileName, page: sourceItem.page })
      : await window.clozeReader.generateTextCards({ studyProfile: studyProfile(sourceItem.mode), mode: sourceItem.mode || "verbatim", sourceText: sourceItem.sourceText, context: sourceItem.context, count, existingCards, fileName: sourceItem.fileName || state.fileName, page: sourceItem.page });
    const newItems = [];
    for (const cloze of result.cards) {
      const newItem = {
        id: crypto.randomUUID(), kind: sourceItem.kind, mode: sourceItem.mode || "verbatim", documentId: sourceItem.documentId,
        fileName: sourceItem.fileName, page: sourceItem.page, sourceText: sourceItem.sourceText,
        rects: sourceItem.rects.map(rect => ({ ...rect })), context: sourceItem.context || "", cloze, originalImageId: sourceItem.originalImageId,
        extraHtml: "", deck: sourceItem.deck || $("#deck-select").value || "Default",
        tags: ["pdf-reading", sourceItem.mode || "verbatim", sourceItem.kind === "screenshot" ? "screenshot-card" : "text-card"],
        status: "draft", createdAt: new Date().toISOString()
      };
      if (sourceItem.kind === "screenshot") { newItem.imagePlacement = "front-below"; newItem.includeImageOnBack = false; }
      if (!targetCards.includes(sourceItem)) break;
      targetCards.push(newItem); newItems.push(newItem);
    }
    saveState();
    if (autoSync) for (const item of newItems) await syncCard(item);
    toast(`${newItems.length} cards created; ${newItems.filter(item => item.status === "synced").length} synced.`);
  } catch (error) {
    if (error.message === "OPENAI_KEY_MISSING") $("#settings-dialog").showModal();
    else toast(error.message);
  } finally {
    sourceItem.batchGenerating = false; saveState();
  }
}

async function syncCard(item) {
  if (syncing.has(item.id)) return;
  if (!item.cloze || !/\{\{c\d+::.+?\}\}/s.test(item.cloze)) return toast("This card needs a valid {{c1::cloze}} deletion.");
  syncing.add(item.id); item.status = "syncing"; saveState();
  try {
    const extra = await prepareExtraForAnki(item);
    const fieldNames = await window.clozeReader.ankiRequest({ action: "modelFieldNames", params: { modelName: "Cloze" } });
    const { textField, backField } = resolveClozeFields(fieldNames);
    if (!textField || !backField) throw new Error("Your Anki Cloze note type needs separate text and back fields.");
    let front = item.cloze;
    const imageBelow = item.kind === "screenshot" && placement(item) === "front-below";
    const frontImageId = imageBelow ? item.originalImageId : item.frontImageId;
    if (frontImageId) {
      const frontName = await storeDataImage(await window.clozeReader.loadScreenshot(frontImageId), `cloze-reader-${item.id}-front`);
      front = imageBelow ? `${front}<br><img src="${frontName}">` : `<img src="${frontName}"><br>${front}`;
    }
    const fields = {
      [textField]: front,
      [backField]: `${extra}<div class="pdf-source">${escapeHtml(item.fileName || state.fileName)} · page ${item.page}</div>`
    };
    item.ankiBackField = backField;
    if (item.ankiNoteId) await window.clozeReader.ankiRequest({ action: "updateNoteFields", params: { note: { id: item.ankiNoteId, fields } } });
    else {
      const matches = await window.clozeReader.ankiRequest({ action: "findNotes", params: { query: `tag:cr_${item.id}` } });
      if (matches.length) { item.ankiNoteId = matches[0]; await window.clozeReader.ankiRequest({ action: "updateNoteFields", params: { note: { id: item.ankiNoteId, fields } } }); }
      else item.ankiNoteId = await window.clozeReader.ankiRequest({ action: "addNote", params: { note: { deckName: item.deck, modelName: "Cloze", fields, options: { allowDuplicate: false }, tags: [...new Set([...item.tags, "cloze-reader", `cr_${item.id}`])] } } });
    }
    item.status = "synced"; toast(extra ? `Back synced to Anki field “${backField}”.` : "Cloze card synced to Anki.");
  } catch (error) { item.status = "queued"; item.error = error.message; toast(`Sync failed: ${error.message}`); }
  syncing.delete(item.id); saveState(); await refreshConnections();
}

async function prepareExtraForAnki(item) {
  const document = new DOMParser().parseFromString(sanitizeBackHtml(item.extraHtml), "text/html");
  const images = [...document.body.querySelectorAll("img")];
  for (let index = 0; index < images.length; index++) {
    const match = images[index].src.match(/^data:image\/(png|jpeg|gif|webp);base64,(.+)$/i);
    if (!match) continue;
    const extension = match[1].toLowerCase() === "jpeg" ? "jpg" : match[1].toLowerCase();
    const filename = `cloze-reader-${item.id}-${index}.${extension}`;
    await window.clozeReader.ankiRequest({ action: "storeMediaFile", params: { filename, data: match[2] } });
    images[index].setAttribute("src", filename);
  }
  let html = document.body.innerHTML;
  if (item.originalImageId && ["back", "occlusion"].includes(placement(item))) {
    const backName = await storeDataImage(await window.clozeReader.loadScreenshot(item.originalImageId), `cloze-reader-${item.id}-source`);
    html = `<img src="${backName}">${html}`;
  }
  return html;
}

async function storeDataImage(dataUrl, stem) {
  const match = String(dataUrl || "").match(/^data:image\/(png|jpeg|gif|webp);base64,(.+)$/i);
  if (!match) throw new Error("The screenshot image could not be prepared for Anki.");
  const extension = match[1].toLowerCase() === "jpeg" ? "jpg" : match[1].toLowerCase();
  const filename = `${stem}.${extension}`;
  await window.clozeReader.ankiRequest({ action: "storeMediaFile", params: { filename, data: match[2] } });
  return filename;
}

function normalizedRect(start, end, bounds) {
  const left = Math.max(0, Math.min(start.x, end.x));
  const top = Math.max(0, Math.min(start.y, end.y));
  const right = Math.min(bounds.width, Math.max(start.x, end.x));
  const bottom = Math.min(bounds.height, Math.max(start.y, end.y));
  return { x: left / bounds.width, y: top / bounds.height, width: (right - left) / bounds.width, height: (bottom - top) / bounds.height };
}

function positionBox(element, rect) {
  Object.assign(element.style, { left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` });
}

function cancelScreenshotMode() {
  state.screenshotSession?.overlay?.remove();
  state.screenshotSession = null;
  $("#screenshot-prompt").hidden = true;
}

function beginScreenshotMode(page) {
  cancelPending(); cancelScreenshotMode();
  if (state.mode === "interpretative" && !state.aiEnabled) return toast("Turn AI on to create an Interpretative screenshot card.");
  const overlay = document.createElement("div"); overlay.className = "screenshot-overlay";
  const box = document.createElement("span"); box.className = "screenshot-selection"; box.hidden = true; overlay.append(box); page.append(overlay);
  state.screenshotSession = { page, overlay, box, start: null };
  $("#screenshot-prompt").hidden = false;
  overlay.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    const bounds = overlay.getBoundingClientRect();
    state.screenshotSession.start = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    box.hidden = false; overlay.setPointerCapture(event.pointerId);
  });
  overlay.addEventListener("pointermove", event => {
    if (!state.screenshotSession?.start) return;
    const bounds = overlay.getBoundingClientRect();
    positionBox(box, normalizedRect(state.screenshotSession.start, { x: event.clientX - bounds.left, y: event.clientY - bounds.top }, bounds));
  });
  overlay.addEventListener("pointerup", async event => {
    const session = state.screenshotSession; if (!session?.start) return;
    const bounds = overlay.getBoundingClientRect();
    const rect = normalizedRect(session.start, { x: event.clientX - bounds.left, y: event.clientY - bounds.top }, bounds);
    if (rect.width * bounds.width < 20 || rect.height * bounds.height < 20) return toast("Drag a larger screenshot area.");
    const pageNumber = Number(page.dataset.page), imageDataUrl = cropPageImage(page.querySelector("canvas"), rect);
    cancelScreenshotMode();
    if (state.mode === "verbatim") openOcclusionEditor({ page: pageNumber, rect, imageDataUrl });
    else await createInterpretativeScreenshot({ page: pageNumber, rect, imageDataUrl });
  });
}

function cropPageImage(canvas, rect) {
  const sx = Math.round(rect.x * canvas.width), sy = Math.round(rect.y * canvas.height);
  const sourceWidth = Math.max(1, Math.round(rect.width * canvas.width)), sourceHeight = Math.max(1, Math.round(rect.height * canvas.height));
  const scale = Math.min(1, 1400 / Math.max(sourceWidth, sourceHeight));
  const output = document.createElement("canvas"); output.width = Math.max(1, Math.round(sourceWidth * scale)); output.height = Math.max(1, Math.round(sourceHeight * scale));
  output.getContext("2d").drawImage(canvas, sx, sy, sourceWidth, sourceHeight, 0, 0, output.width, output.height);
  return output.toDataURL("image/jpeg", .86);
}

function openOcclusionEditor(draft) {
  state.occlusionDraft = { ...draft, targetCards: state.highlights, documentId: state.currentDocumentId, fileName: state.fileName, concealRect: null };
  $("#occlusion-image").src = draft.imageDataUrl; $("#occlusion-box").hidden = true; $("#create-occlusion").disabled = true;
  $("#occlusion-dialog").showModal();
}

async function createInterpretativeScreenshot(draft) {
  const targetCards = state.highlights, documentId = state.currentDocumentId, fileName = state.fileName;
  const originalImageId = await window.clozeReader.saveScreenshot(draft.imageDataUrl);
  const item = { id: crypto.randomUUID(), kind: "screenshot", mode: "interpretative", documentId, fileName, page: draft.page, sourceText: "Interpretative screenshot", rects: [draft.rect], context: "", cloze: "", originalImageId, extraHtml: "", deck: $("#deck-select").value || "Default", tags: ["pdf-reading", "interpretative", "screenshot-card"], status: "generating", createdAt: new Date().toISOString() };
  targetCards.push(item); saveState(); renderHighlights(item.page); await generateCard(item, false);
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = dataUrl; });
}

async function createBlurredImage(dataUrl, rect) {
  const image = await loadImage(dataUrl), canvas = document.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d"); context.drawImage(image, 0, 0);
  const x = Math.round(rect.x * canvas.width), y = Math.round(rect.y * canvas.height), width = Math.round(rect.width * canvas.width), height = Math.round(rect.height * canvas.height);
  context.save(); context.beginPath(); context.rect(x, y, width, height); context.clip(); context.filter = "blur(14px)";
  context.drawImage(image, -18, -18, canvas.width + 36, canvas.height + 36); context.restore();
  context.fillStyle = "rgba(245,245,245,.45)"; context.fillRect(x, y, width, height);
  context.strokeStyle = "rgba(35,35,35,.45)"; context.lineWidth = Math.max(2, canvas.width / 500); context.strokeRect(x, y, width, height);
  return canvas.toDataURL("image/jpeg", .86);
}

async function createVerbatimScreenshot(draft) {
  const blurred = await createBlurredImage(draft.imageDataUrl, draft.concealRect);
  const [originalImageId, frontImageId] = await Promise.all([window.clozeReader.saveScreenshot(draft.imageDataUrl), window.clozeReader.saveScreenshot(blurred)]);
  const item = { id: crypto.randomUUID(), kind: "screenshot", mode: "verbatim", documentId: draft.documentId, fileName: draft.fileName, page: draft.page, sourceText: "Verbatim image occlusion", rects: [draft.rect], context: "", cloze: "Image occlusion: {{c1::reveal the hidden region}}", originalImageId, frontImageId, extraHtml: "", deck: $("#deck-select").value || "Default", tags: ["pdf-reading", "verbatim", "image-occlusion"], status: "draft", createdAt: new Date().toISOString() };
  draft.targetCards.push(item); saveState(); renderHighlights(item.page); toast("Image-occlusion card ready to review in the sidebar."); if (autoSync) await syncCard(item);
}

function deleteCard(item) { recordRemoval([item]); state.highlights.splice(state.highlights.indexOf(item), 1); saveState(); renderHighlights(item.page); }
$("#open-button").addEventListener("click", importPdf); $("#empty-open-button").addEventListener("click", importPdf); $("#library-import-button").addEventListener("click", importPdf);
$("#home-button").addEventListener("click", closePdf);
reader.addEventListener("mouseup", () => setTimeout(captureSelection, 0));
reader.addEventListener("contextmenu", event => {
  const page = event.target.closest(".pdf-page");
  if (!page) return;
  event.preventDefault();
  if (page.dataset.rendered !== "true" || !page.querySelector("canvas")) return toast("That PDF page is still loading. Try again in a moment.");
  beginScreenshotMode(page);
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && state.pendingSelection) cancelPending();
  if (event.key === "Escape" && state.screenshotSession) cancelScreenshotMode();
  if (event.key === "Enter" && state.pendingSelection && !event.metaKey && !event.ctrlKey && !event.shiftKey) { event.preventDefault(); commitPending(); }
});
$("#settings-button").addEventListener("click", () => $("#settings-dialog").showModal());
$("#close-settings").addEventListener("click", () => $("#settings-dialog").close());
$("#settings-form").addEventListener("submit", async event => {
  event.preventDefault();
  try {
    await window.clozeReader.saveOpenAIKey($("#api-key-input").value); $("#api-key-input").value = ""; $("#settings-dialog").close(); await refreshConnections(); toast("AI key saved securely.");
    for (const item of state.highlights.filter(card => card.status === "needs-key")) await generateCard(item, item.kind !== "screenshot");
  } catch (error) { toast(error.message); }
});
$("#retry-button").addEventListener("click", async () => { for (const item of state.highlights.filter(card => card.status === "queued")) await syncCard(item); });
$("#sync-all-button").addEventListener("click", async () => {
  const pending = state.highlights.filter(item => item.cloze && item.status !== "synced" && item.status !== "generating");
  if (!pending.length) return toast("All cards are already synced.");
  for (const item of pending) await syncCard(item);
  const synced = pending.filter(item => item.status === "synced").length;
  toast(`${synced} of ${pending.length} card${pending.length === 1 ? "" : "s"} synced to Anki.`);
});
$("#clear-all-button").addEventListener("click", () => {
  if (!state.highlights.length) return;
  if (!window.confirm("Clear every card and highlight for this PDF? Cards already synced to Anki will remain in Anki.")) return;
  recordRemoval([...state.highlights]); state.highlights.splice(0); saveState();
  reader.querySelectorAll(".pdf-page").forEach(page => renderHighlights(Number(page.dataset.page)));
  toast("Cards and highlights cleared from this PDF. Anki cards were not deleted.");
});
document.addEventListener("click", event => { if (!event.target.closest("#library-context-menu")) $("#library-context-menu").hidden = true; });
$("#open-page-menu-button").addEventListener("click", () => {
  $("#library-context-menu").hidden = true;
  if (!state.renameTarget) return;
  $("#open-page-input").value = ""; $("#open-page-dialog").showModal(); $("#open-page-input").focus();
});
const closeOpenPage = () => $("#open-page-dialog").close();
$("#close-open-page").addEventListener("click", closeOpenPage); $("#cancel-open-page").addEventListener("click", closeOpenPage);
$("#open-page-form").addEventListener("submit", async event => {
  event.preventDefault();
  const target = state.renameTarget, page = Number($("#open-page-input").value);
  if (!target || !Number.isInteger(page) || page < 1) return toast("Enter a valid PDF page number.");
  closeOpenPage();
  try {
    if (target.id === state.currentDocumentId && state.pdf) {
      if (page > state.pdf.numPages) return toast(`This PDF has ${state.pdf.numPages} pages.`);
      const element = reader.querySelector(`[data-page="${page}"]`); if (!element) return toast("That PDF page is not ready yet.");
      $("#viewer-column").scrollTop = element.offsetTop; rememberReading(); toast(`Jumped to PDF page ${page}.`);
    } else await loadPdfFile(await window.clozeReader.loadPdf(target.id), page);
  } catch (error) { toast(error.message); }
});
$("#rename-menu-button").addEventListener("click", () => {
  $("#library-context-menu").hidden = true;
  if (!state.renameTarget) return;
  $("#rename-input").value = state.renameTarget.name; $("#rename-dialog").showModal(); $("#rename-input").select();
});
const closeRename = () => $("#rename-dialog").close();
$("#close-rename").addEventListener("click", closeRename); $("#cancel-rename").addEventListener("click", closeRename);
$("#rename-form").addEventListener("submit", async event => {
  event.preventDefault(); if (!state.renameTarget) return;
  try {
    const renamed = await window.clozeReader.renamePdf(state.renameTarget.id, $("#rename-input").value);
    if (renamed.id === state.currentDocumentId) { state.fileName = renamed.name; $("#document-name").textContent = renamed.name; }
    state.renameTarget = null; closeRename(); await refreshLibrary(); toast("PDF renamed.");
  } catch (error) { toast(error.message); }
});
const aiToggle = $("#ai-toggle"); aiToggle.checked = state.aiEnabled;
function updateAiToggle() { state.aiEnabled = aiToggle.checked; localStorage.setItem("cloze-reader:ai-enabled", String(state.aiEnabled)); aiToggle.parentElement.querySelector("b").textContent = state.aiEnabled ? "AI On" : "AI Off"; }
aiToggle.addEventListener("change", updateAiToggle); updateAiToggle();

function updateMode(mode) {
  state.mode = mode; localStorage.setItem("cloze-reader:mode", mode);
  $("#verbatim-mode").classList.toggle("active", mode === "verbatim");
  $("#interpretative-mode").classList.toggle("active", mode === "interpretative");
  $("#selection-action").textContent = mode === "interpretative" ? "Make interpretative cloze" : "Make verbatim cloze";
  toast(mode === "interpretative" ? "Interpretative mode rewrites faithfully around the selected knowledge." : "Verbatim mode preserves the selected wording.");
}
$("#verbatim-mode").addEventListener("click", () => updateMode("verbatim"));
$("#interpretative-mode").addEventListener("click", () => updateMode("interpretative"));
updateMode(state.mode);

const occlusionStage = $("#occlusion-stage"), occlusionBox = $("#occlusion-box");
let occlusionStart = null;
occlusionStage.addEventListener("pointerdown", event => {
  if (event.button !== 0 || !state.occlusionDraft) return;
  const bounds = occlusionStage.getBoundingClientRect(); occlusionStart = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  occlusionBox.hidden = false; occlusionStage.setPointerCapture(event.pointerId);
});
occlusionStage.addEventListener("pointermove", event => {
  if (!occlusionStart) return;
  const bounds = occlusionStage.getBoundingClientRect();
  const rect = normalizedRect(occlusionStart, { x: event.clientX - bounds.left, y: event.clientY - bounds.top }, bounds);
  positionBox(occlusionBox, rect);
});
occlusionStage.addEventListener("pointerup", event => {
  if (!occlusionStart || !state.occlusionDraft) return;
  const bounds = occlusionStage.getBoundingClientRect();
  const rect = normalizedRect(occlusionStart, { x: event.clientX - bounds.left, y: event.clientY - bounds.top }, bounds); occlusionStart = null;
  if (rect.width * bounds.width < 8 || rect.height * bounds.height < 8) return toast("Choose a slightly larger answer region.");
  state.occlusionDraft.concealRect = rect; positionBox(occlusionBox, rect); $("#create-occlusion").disabled = false;
});
function closeOcclusion() { state.occlusionDraft = null; occlusionStart = null; $("#occlusion-dialog").close(); }
$("#close-occlusion").addEventListener("click", closeOcclusion); $("#cancel-occlusion").addEventListener("click", closeOcclusion);
$("#occlusion-form").addEventListener("submit", async event => {
  event.preventDefault(); if (!state.occlusionDraft?.concealRect) return;
  const draft = state.occlusionDraft; closeOcclusion(); await createVerbatimScreenshot(draft);
});
refreshConnections({ refreshDecks: true }); refreshLibrary();
window.addEventListener("focus", refreshAnkiConnection);
setInterval(refreshAnkiConnection, 5000);

const syncToggle = $("#auto-sync"); syncToggle.checked = autoSync;
syncToggle.addEventListener("change", () => { autoSync = syncToggle.checked; localStorage.setItem("cloze-reader:auto-sync", String(autoSync)); });
$("#new-deck").addEventListener("click", () => $("#deck-dialog").showModal());
$("#refresh-anki").addEventListener("click", async () => {
  const button = $("#refresh-anki"), original = button.textContent; button.disabled = true; button.textContent = "Refreshing…";
  try { toast(await refreshAnkiConnection({ refreshDecks: true }) ? "Anki connection and decks refreshed." : $("#anki-status").textContent); }
  finally { button.disabled = false; button.textContent = original; }
});
$("#open-anki").addEventListener("click", async () => {
  const button = $("#open-anki"), original = button.textContent;
  button.disabled = true; button.textContent = "Opening…";
  try {
    await window.clozeReader.launchAnki();
    for (let attempt = 0; attempt < 8; attempt++) {
      button.textContent = `Connecting${".".repeat((attempt % 3) + 1)}`;
      await new Promise(resolve => setTimeout(resolve, attempt === 0 ? 500 : 1000));
      if (await refreshAnkiConnection()) { toast("Anki is open and connected."); return; }
    }
    toast("Anki opened, but AnkiConnect is not responding yet. Check that the AnkiConnect add-on is installed.");
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; button.textContent = original; }
});
$("#cancel-deck").addEventListener("click", () => $("#deck-dialog").close());
$("#deck-form").addEventListener("submit", async event => {
  event.preventDefault(); const name = $("#deck-name").value.trim(); if (!name) return;
  const button = $("#create-deck"); button.disabled = true;
  try { await window.clozeReader.ankiRequest({ action: "createDeck", params: { deck: name } }); await refreshAnkiConnection({ refreshDecks: true }); $("#deck-select").value = name; rememberReading(); $("#deck-dialog").close(); toast(`Deck selected: ${name}`); }
  catch(error) { toast(`Could not create deck: ${error.message}`); } finally { button.disabled = false; }
});
$("#close-preview").addEventListener("click", () => $("#preview-dialog").close());
async function previewCard(item) {
  const front = $("#preview-front"), back = $("#preview-back");
  const text = escapeHtml(item.cloze || "");
  front.innerHTML = text.replace(/\{\{c\d+::(.*?)(?:::(.*?))?\}\}/gs, '<b>[$2…]</b>');
  back.innerHTML = text.replace(/\{\{c\d+::(.*?)(?:::(.*?))?\}\}/gs, '<b>$1</b>') + '<hr>' + sanitizeBackHtml(item.extraHtml);
  $("#preview-dialog").showModal();
  const imageBelow = placement(item) === "front-below";
  const id = imageBelow ? item.originalImageId : item.frontImageId;
  if (id) { const url = await window.clozeReader.loadScreenshot(id); for (const element of [front, back]) { const img = new Image(); img.src = url; imageBelow ? element.append(img) : element.prepend(img); } }
  if (item.originalImageId && ["back", "occlusion"].includes(placement(item))) { const img = new Image(); img.src = await window.clozeReader.loadScreenshot(item.originalImageId); back.append(img); }
}

function updateProfiles() {
  const select = $("#profile-select"); select.replaceChildren(new Option("Off", ""));
  profiles.forEach(p => select.add(new Option(p.name, p.id))); select.value = activeProfile;
  localStorage.setItem("cr:active-profile", activeProfile);
}
function editProfile() {
  const profile = profiles.find(p => p.id === $("#profile-editor-select").value);
  $("#profile-name").value = profile?.name || ""; $("#profile-description").value = profile?.description || "";
  $("#profile-delete").disabled = !profile;
}
$("#profile-select").addEventListener("change", event => { activeProfile = event.target.value; updateProfiles(); rememberReading(); });
$("#profile-button").addEventListener("click", () => {
  const select = $("#profile-editor-select"); select.replaceChildren(new Option("New profile", "")); profiles.forEach(p => select.add(new Option(p.name,p.id)));
  select.value = activeProfile; editProfile(); $("#profile-dialog").showModal();
});
$("#profile-editor-select").addEventListener("change", editProfile);
$("#profile-close").addEventListener("click", () => $("#profile-dialog").close());
$("#profile-form").addEventListener("submit", event => {
  event.preventDefault(); const name = $("#profile-name").value.trim(), description = $("#profile-description").value.trim(); if (!name || !description) return;
  const id = $("#profile-editor-select").value || crypto.randomUUID();
  profiles = profiles.filter(p => p.id !== id); profiles.push({id,name,description}); activeProfile = id;
  localStorage.setItem("cr:profiles", JSON.stringify(profiles)); updateProfiles(); rememberReading(); $("#profile-dialog").close();
});
$("#profile-delete").addEventListener("click", () => {
  const id = $("#profile-editor-select").value; profiles = profiles.filter(p => p.id !== id); if (activeProfile === id) activeProfile = "";
  localStorage.setItem("cr:profiles", JSON.stringify(profiles)); updateProfiles(); rememberReading(); $("#profile-dialog").close();
});
function rememberReading() {
  if (!state.fingerprint || restoringReading) return;
  const viewer = $("#viewer-column"); const pages = [...reader.querySelectorAll(".pdf-page")];
  const page = pages.find(p => p.offsetTop + p.offsetHeight > viewer.scrollTop) || pages.at(-1);
  readingMemory[state.fingerprint] = {page: Number(page?.dataset.page || 1), offset: page ? (viewer.scrollTop-page.offsetTop)/page.offsetHeight : 0, deck: $("#deck-select").value, profile: activeProfile};
  localStorage.setItem("cr:reading-memory", JSON.stringify(readingMemory));
}
$("#viewer-column").addEventListener("scroll", rememberReading, {passive:true});
$("#deck-select").addEventListener("change", rememberReading);
window.addEventListener("beforeunload", rememberReading);
function recordRemoval(cards) {
  const history = undoHistory.get(state.fingerprint) || []; history.push(cards); if (history.length > 20) history.shift(); undoHistory.set(state.fingerprint, history);
}
$("#undo-remove").addEventListener("click", () => {
  const cards = undoHistory.get(state.fingerprint)?.pop(); if (!cards) return;
  const ids = new Set(state.highlights.map(c => c.id)); cards.forEach(c => { if (!ids.has(c.id)) state.highlights.push(c); });
  saveState(); reader.querySelectorAll(".pdf-page").forEach(p => renderHighlights(Number(p.dataset.page))); toast("Removed cards and highlights restored.");
});
function jumpToSource(item) {
  const page = reader.querySelector(`[data-page="${item.page}"]`); if (!page) return;
  $("#viewer-column").scrollTo({top:page.offsetTop + (item.rects?.[0]?.y || 0)*page.offsetHeight - 40, behavior:"smooth"});
  page.classList.add("source-focus"); setTimeout(()=>page.classList.remove("source-focus"),1800);
}
let improveSession = null;
function openImprove(item) {
  improveSession = { item, target:state.highlights, cards:[], split:false, busy:false };
  $("#improve-results").replaceChildren(); $("#improve-instructions").value = ""; $("#improve-status").textContent = ""; $("#improve-count").value = "1"; $("#improve-apply").hidden = true; $("#improve-generate").disabled = false;
  $("#improve-dialog").showModal();
}
$("#improve-close").addEventListener("click", ()=>$("#improve-dialog").close());
$("#improve-form").addEventListener("submit", async event => {
  event.preventDefault(); const session = improveSession; if (!session || session.busy) return;
  const {item} = session; session.busy = true; session.split = Number($("#improve-count").value)>1;
  $("#improve-generate").disabled = true; $("#improve-apply").hidden = true; $("#improve-status").textContent = "Generating proposal…";
  const payload = {cloze:item.cloze, sourceText:item.sourceText || item.selectedText, context:item.context, mode:item.mode || "verbatim", count:Number($("#improve-count").value), instructions:$("#improve-instructions").value, studyProfile:studyProfile(item.mode)};
  try {
    if (item.originalImageId) payload.imageDataUrl = await window.clozeReader.loadScreenshot(item.originalImageId);
    const result = await window.clozeReader.improveCard(payload); if (session !== improveSession) return;
    session.cards = result.cards; const list = $("#improve-results"); list.replaceChildren();
    result.cards.forEach(text=>{const editor=document.createElement("textarea"); editor.value=text; editor.setAttribute("aria-label","Proposed card"); list.append(editor);});
    $("#improve-status").textContent = result.cards.length ? "Edit the proposals below, then apply." : "No supported revision was returned."; $("#improve-apply").hidden = !result.cards.length;
  } catch(error) { if (session === improveSession) $("#improve-status").textContent = error.message; }
  finally { session.busy=false; if (session === improveSession) $("#improve-generate").disabled=false; }
});
$("#improve-apply").addEventListener("click", ()=>{
  const session = improveSession; if (!session || !session.target.includes(session.item)) return toast("The original card has been removed.");
  if (syncing.has(session.item.id)) return toast("Wait for this card to finish syncing.");
  const cards = [...$("#improve-results").querySelectorAll("textarea")].map(e=>e.value.trim());
  if (!cards.length || cards.some(c=>! /\{\{c\d+::.+?\}\}/s.test(c))) return toast("Every proposal needs a valid cloze deletion.");
  if (!session.split) { session.item.cloze=cards[0]; session.item.status="draft"; }
  else cards.forEach(cloze=>{
    const item = {...session.item, id:crypto.randomUUID(), cloze, status:"draft", extraHtml:session.item.extraHtml || "", batchGenerating:false, createdAt:new Date().toISOString()};
    delete item.ankiNoteId; delete item.ankiBackField; delete item.frontImageId; if(item.originalImageId) {item.imagePlacement="front-below"; item.includeImageOnBack=false;} session.target.push(item);
  });
  saveState(); $("#improve-dialog").close(); toast("Changes saved as drafts. Use Save & sync when ready.");
});
updateProfiles();

let bulkSession = null;
const bulkControls = ['#bulk-range','#bulk-count-mode','#bulk-limit','#bulk-mode','#bulk-images','#bulk-start'];
function setBulkBusy(busy) { bulkControls.forEach(id=>$(id).disabled=busy); $('#bulk-stop').disabled=!busy; $('#bulk-sync').disabled=busy; }
function describeBulkProfile() {
  $('#bulk-profile').textContent = $('#bulk-mode').value === 'interpretative' ? `Study Profile: ${profiles.find(p=>p.id===activeProfile)?.name || 'Off'}` : 'Study Profile is not used in Verbatim mode.';
}
$('#bulk-mode').addEventListener('change',describeBulkProfile);
$('#bulk-open').addEventListener('click',()=>{
  if(!state.pdf) return toast('Open a PDF first.');
  if(!bulkSession || (!bulkSession.busy && bulkSession.documentId!==state.currentDocumentId)) {
    bulkSession={busy:false,items:state.highlights.filter(c=>c.bulkBatchId),target:state.highlights,documentId:state.currentDocumentId,fileName:state.fileName,selected:new Set()};
    $('#bulk-range').value='1'; $('#bulk-mode').value=state.mode; $('#bulk-status').textContent='Choose pages and generate a batch to review.';
  }
  $('#bulk-document').textContent=bulkSession.fileName; describeBulkProfile(); renderBulkResults(); setBulkBusy(bulkSession.busy); $('#bulk-dialog').showModal();
});
$('#bulk-close').addEventListener('click',()=>$('#bulk-dialog').close());
$('#bulk-stop').addEventListener('click',()=>{if(bulkSession){bulkSession.stop=true;$('#bulk-status').textContent='Stopping after the current request. Completed drafts will be kept.';}});
function renderBulkResults() {
  const list=$('#bulk-results'); list.replaceChildren(); if(!bulkSession) return;
  bulkSession.items=bulkSession.items.filter(item=>bulkSession.target.includes(item));
  for(const item of bulkSession.items){
    const row=documentElement('article','card-item bulk-card');
    const heading=documentElement('div','card-top'); const label=document.createElement('label'); const checkbox=document.createElement('input'); checkbox.type='checkbox'; checkbox.checked=bulkSession.selected.has(item.id); checkbox.setAttribute('aria-label',`Select card from page ${item.page}`);
    checkbox.addEventListener('change',()=>checkbox.checked?bulkSession.selected.add(item.id):bulkSession.selected.delete(item.id)); label.append(checkbox,` PDF page ${item.page} · ${stateLabel(item)}`); heading.append(label); row.append(heading);
    const editor=document.createElement('textarea'); editor.value=item.cloze; editor.className='card-cloze'; editor.setAttribute('aria-label','Bulk card text'); editor.disabled=syncing.has(item.id);
    editor.addEventListener('input',()=>{item.cloze=editor.value;item.status='draft';saveStateOnly();}); row.append(editor);
    const actions=documentElement('div','card-actions');
    const preview=documentElement('button','mini-button'); preview.type='button';preview.textContent='Preview';preview.addEventListener('click',()=>previewCard(item));actions.append(preview);
    const remove=documentElement('button','mini-button');remove.type='button';remove.textContent='Remove draft';remove.disabled=syncing.has(item.id);remove.addEventListener('click',()=>{
      const i=bulkSession.target.indexOf(item);if(i>=0)bulkSession.target.splice(i,1);bulkSession.selected.delete(item.id);saveState();renderBulkResults();
    });actions.append(remove);row.append(actions);list.append(row);
  }
}
$('#bulk-select-all').addEventListener('click',()=>{if(bulkSession){bulkSession.items.forEach(c=>bulkSession.selected.add(c.id));renderBulkResults();}});
$('#bulk-select-none').addEventListener('click',()=>{if(bulkSession){bulkSession.selected.clear();renderBulkResults();}});
$('#bulk-sync').addEventListener('click',async()=>{
  const session=bulkSession;if(!session || session.busy)return;
  const chosen=session.items.filter(c=>session.selected.has(c.id)&&session.target.includes(c));if(!chosen.length)return toast('Select cards to sync first.');
  session.busy=true;setBulkBusy(true);$('#bulk-stop').disabled=true;
  try{for(const item of chosen){if(item.status!=='synced')await syncCard(item);}$('#bulk-status').textContent=`${chosen.filter(c=>c.status==='synced').length} of ${chosen.length} selected cards synced.`;}
  finally{session.busy=false;setBulkBusy(false);renderBulkResults();}
});
$('#bulk-form').addEventListener('submit',async event=>{
  event.preventDefault(); if(bulkSession?.busy)return;
  if(!state.pdf || bulkSession?.documentId!==state.currentDocumentId)return toast('Close this dialog and reopen Bulk create from the intended PDF.');
  const match=$('#bulk-range').value.trim().match(/^(\d+)\s*(?:[-–]\s*(\d+))?$/);
  const start=Number(match?.[1]),end=Number(match?.[2]||match?.[1]),limit=Number($('#bulk-limit').value);
  if(!match || start<1 || end<start || end>state.pdf.numPages || end-start+1>30)return toast(`Choose 1–30 pages within PDF pages 1–${state.pdf.numPages}.`);
  if(!Number.isInteger(limit)||limit<1||limit>50)return toast('Choose a card maximum between 1 and 50.');
  const session={busy:true,stop:false,items:[],target:state.highlights,documentId:state.currentDocumentId,fileName:state.fileName,selected:new Set(),batchId:crypto.randomUUID()};
  bulkSession=session;setBulkBusy(true);renderBulkResults();
  const mode=$('#bulk-mode').value,profile=studyProfile(mode),includeImages=$('#bulk-images').checked,automatic=$('#bulk-count-mode').value==='auto',deck=$('#deck-select').value||'Default';
  let pdf=null;let skipped=0;
  try {
    $('#bulk-status').textContent='Preparing PDF…';
    // Use a separate PDF instance so closing the reader cannot destroy this job.
    const file=await window.clozeReader.loadPdf(session.documentId);pdf=await pdfjsLib.getDocument({data:file.bytes}).promise;
    for(let first=start;first<=end && !session.stop;first+=3){
      const last=Math.min(end,first+2),pages=[],imageIds=new Map();
      $('#bulk-status').textContent=`Reading PDF pages ${first}–${last}. ${session.items.length} drafts saved.`;
      for(let pageNumber=first;pageNumber<=last;pageNumber++){
        const page=await pdf.getPage(pageNumber);const content=await page.getTextContent();const text=content.items.map(i=>i.str||'').join(' ').replace(/\s+/g,' ').trim();
        if(text.length>24000)throw new Error(`PDF page ${pageNumber} contains too much text for this batch.`);
        let imageDataUrl;
        if(includeImages){
          const base=page.getViewport({scale:1}),viewport=page.getViewport({scale:Math.min(2,1600/Math.max(base.width,base.height))});
          const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
          await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;imageDataUrl=canvas.toDataURL('image/jpeg',.85);canvas.width=canvas.height=0;
          imageIds.set(pageNumber,await window.clozeReader.saveScreenshot(imageDataUrl));
        }
        if(!text && !imageDataUrl){skipped++;continue;}pages.push({page:pageNumber,text,imageDataUrl});
      }
      if(!pages.length)continue;
      const quota=Math.max(1,Math.ceil(limit/Math.ceil((end-start+1)/3)));
      $('#bulk-status').textContent=`Generating from PDF pages ${first}–${last}… ${session.items.length} drafts saved.`;
      const result=await window.clozeReader.bulkCards({pages,count:quota,automatic,mode,studyProfile:profile,existingCards:session.target.map(c=>c.cloze).filter(Boolean)});
      for(const output of result.cards){
        const source=pages.find(p=>p.page===output.page);if(!source)continue;
        const item={id:crypto.randomUUID(),bulkBatchId:session.batchId,kind:includeImages?'screenshot':'text',mode,documentId:session.documentId,fileName:session.fileName,page:output.page,sourceText:source.text,context:source.text,rects:[],cloze:output.cloze,extraHtml:'',deck,tags:['pdf-reading','bulk-card',mode],status:'draft',createdAt:new Date().toISOString()};
        if(includeImages){item.originalImageId=imageIds.get(output.page);item.imagePlacement='front-below';item.includeImageOnBack=false;}
        session.target.push(item);session.items.push(item);
      }
      saveState();renderBulkResults();
    }
    if(session.items.length>limit){
      $('#bulk-status').textContent='Choosing a balanced final set across the page range…';
      let chosen;
      try { const result=await window.clozeReader.selectBulkCards({cards:session.items.map(c=>({page:c.page,cloze:c.cloze})),limit,mode,studyProfile:profile});chosen=new Set(result.indices.map(i=>session.items[i].id)); }
      catch { chosen=new Set(Array.from({length:limit},(_,i)=>session.items[Math.floor(i*session.items.length/limit)].id)); }
      for(const item of session.items)if(!chosen.has(item.id)){const index=session.target.indexOf(item);if(index>=0)session.target.splice(index,1);}
      session.items=session.items.filter(c=>chosen.has(c.id));saveState();renderBulkResults();
    }
    $('#bulk-status').textContent=`${session.stop?'Stopped. ':''}${session.items.length} drafts created. Review and select cards to sync.${skipped?` ${skipped} pages had no text; enable images for scanned pages.`:''}`;
  }catch(error){$('#bulk-status').textContent=`${error.message} ${session.items.length} completed drafts kept.`;}
  finally{if(pdf)await pdf.destroy().catch(()=>{});session.busy=false;setBulkBusy(false);saveState();renderBulkResults();}
});
