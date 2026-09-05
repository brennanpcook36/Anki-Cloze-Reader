import * as pdfjsLib from "../../node_modules/pdfjs-dist/build/pdf.mjs";
import { escapeHtml, makeCloze, resolveClozeFields, sentenceAround, storageKey } from "./card-utils.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("../../node_modules/pdfjs-dist/build/pdf.worker.mjs", import.meta.url).href;
const $ = selector => document.querySelector(selector);
const reader = $("#reader");
const state = {
  pdf: null, fingerprint: null, fileName: "", currentDocumentId: null, renameTarget: null,
  highlights: [], pendingSelection: null, pageText: new Map(), screenshotSession: null, occlusionDraft: null,
  aiEnabled: localStorage.getItem("cloze-reader:ai-enabled") !== "false",
  mode: localStorage.getItem("cloze-reader:mode") === "interpretative" ? "interpretative" : "verbatim"
};

function saveStateOnly() {
  if (state.fingerprint) localStorage.setItem(storageKey(state.fingerprint), JSON.stringify(state.highlights));
}
function saveState() { saveStateOnly(); renderSidebar(); }
function toast(message) {
  const element = $("#toast"); element.textContent = message; element.classList.add("show");
  clearTimeout(toast.timer); toast.timer = setTimeout(() => element.classList.remove("show"), 3000);
}
function stateLabel(item) {
  return ({ generating: "Generating…", synced: "In Anki", queued: "Anki queued", "needs-key": "Needs API key", error: "Needs attention", draft: "Local draft" })[item.status] || "Local draft";
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
    card.querySelector(".card-cloze").addEventListener("input", event => { item.cloze = event.target.value; if (item.status === "synced") item.status = "draft"; saveStateOnly(); });
    const preview = card.querySelector(".card-image-preview");
    if (preview) window.clozeReader.loadScreenshot(item.frontImageId || item.originalImageId).then(dataUrl => { preview.src = dataUrl; }).catch(() => preview.remove());
    card.querySelector(".save").addEventListener("click", () => syncCard(item));
    const backWrap = card.querySelector(".back-editor-wrap"), backEditor = card.querySelector(".back-editor"), backButton = card.querySelector(".edit-back");
    backButton?.addEventListener("click", () => { backWrap.hidden = !backWrap.hidden; backButton.textContent = backWrap.hidden ? "Edit back" : "Hide back"; if (!backWrap.hidden) backEditor.focus(); });
    backEditor.addEventListener("input", () => { item.extraHtml = sanitizeBackHtml(backEditor.innerHTML); if (item.status === "synced") item.status = "draft"; saveStateOnly(); });
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
    card.querySelector(".delete").addEventListener("click", () => deleteCard(item));
    list.append(card);
  });
  const queued = state.highlights.filter(item => item.status === "queued").length;
  $("#retry-button").hidden = queued === 0;
  $("#retry-button").textContent = `Retry queued (${queued})`;
}

async function refreshConnections() {
  try {
    const decks = await window.clozeReader.ankiRequest({ action: "deckNames" });
    const select = $("#deck-select"), previous = select.value;
    select.replaceChildren(...decks.sort().map(deck => new Option(deck, deck)));
    select.value = decks.includes(previous) ? previous : (decks.includes("Default") ? "Default" : decks[0]);
    $("#anki-status").textContent = "Anki connected"; $("#anki-status").className = "status online";
  } catch {
    $("#anki-status").textContent = "Anki disconnected"; $("#anki-status").className = "status offline";
  }
  const ai = await window.clozeReader.openAIStatus();
  $("#ai-status").textContent = ai.configured ? "AI ready" : "AI not configured";
  $("#ai-status").className = `status ${ai.configured ? "online" : "offline"}`;
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
      menu.style.top = `${Math.min(window.innerHeight - 52, event.clientY)}px`;
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

async function loadPdfFile(file) {
  state.currentDocumentId = file.id;
  state.pdf = await pdfjsLib.getDocument({ data: file.bytes }).promise;
  state.fingerprint = state.pdf.fingerprints?.[0] || `${file.name}:${file.bytes.length}`;
  state.fileName = file.name; state.pageText.clear();
  try { state.highlights = JSON.parse(localStorage.getItem(storageKey(state.fingerprint))) || []; } catch { state.highlights = []; }
  $("#document-name").textContent = file.name; $("#empty-state").hidden = true; reader.hidden = false; $("#home-button").hidden = false;
  reader.replaceChildren(); renderSidebar(); await renderDocument(); await refreshLibrary();
}

async function closePdf() {
  cancelPending(); cancelScreenshotMode();
  try { await state.pdf?.destroy(); } catch {}
  state.pdf = null; state.fingerprint = null; state.fileName = ""; state.currentDocumentId = null; state.highlights = []; state.pageText.clear();
  reader.replaceChildren(); reader.hidden = true; $("#empty-state").hidden = false; $("#viewer-column").scrollTop = 0;
  $("#document-name").textContent = "No PDF open"; $("#home-button").hidden = true;
  renderSidebar(); await refreshLibrary();
}

async function renderDocument() {
  const maxWidth = Math.min(820, Math.max(420, window.innerWidth - 700));
  for (let pageNumber = 1; pageNumber <= state.pdf.numPages; pageNumber++) {
    const page = await state.pdf.getPage(pageNumber), base = page.getViewport({ scale: 1 }), viewport = page.getViewport({ scale: maxWidth / base.width });
    const pageElement = document.createElement("article"); pageElement.className = "pdf-page"; pageElement.dataset.page = pageNumber;
    pageElement.style.width = `${viewport.width}px`; pageElement.style.height = `${viewport.height}px`;
    const canvas = document.createElement("canvas"), outputScale = window.devicePixelRatio || 1;
    canvas.width = Math.floor(viewport.width * outputScale); canvas.height = Math.floor(viewport.height * outputScale);
    canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`; pageElement.append(canvas);
    const textLayer = document.createElement("div"); textLayer.className = "textLayer"; pageElement.append(textLayer);
    const highlightLayer = document.createElement("div"); highlightLayer.className = "highlight-layer"; pageElement.append(highlightLayer);
    const number = document.createElement("span"); number.className = "page-number"; number.textContent = pageNumber; pageElement.append(number); reader.append(pageElement);
    await page.render({ canvasContext: canvas.getContext("2d"), viewport, transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0] }).promise;
    const textContent = await page.getTextContent(); state.pageText.set(pageNumber, textContent.items.map(item => item.str).join(" "));
    await new pdfjsLib.TextLayer({ textContentSource: textContent, container: textLayer, viewport }).render(); renderHighlights(pageNumber);
  }
}

function renderHighlights(pageNumber) {
  const page = reader.querySelector(`[data-page="${pageNumber}"]`); if (!page) return;
  const layer = page.querySelector(".highlight-layer"); layer.replaceChildren();
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
  if (state.aiEnabled) await generateCard(item); else await syncCard(item);
}

async function generateCard(item, syncAfter = true) {
  item.status = "generating"; item.error = ""; saveState();
  try {
    const result = item.kind === "screenshot"
      ? await window.clozeReader.generateScreenshotCard({ imageDataUrl: await window.clozeReader.loadScreenshot(item.originalImageId), fileName: item.fileName || state.fileName, page: item.page })
      : await window.clozeReader.generateCloze({ mode: item.mode || "verbatim", sourceText: item.sourceText || item.selectedText, context: item.context || item.sourceText || item.selectedText, fileName: item.fileName || state.fileName, page: item.page });
    item.cloze = result.cloze; item.status = "draft"; saveState();
    if (syncAfter) await syncCard(item); else toast("Screenshot card ready to review in the sidebar.");
  } catch (error) {
    item.status = error.message === "OPENAI_KEY_MISSING" ? "needs-key" : "error"; item.error = error.message; saveState();
    if (item.status === "needs-key") $("#settings-dialog").showModal(); else toast(error.message);
  }
}

async function generateMoreCards(sourceItem, requestedCount) {
  const count = Math.max(1, Math.min(10, Number(requestedCount) || 1));
  sourceItem.batchGenerating = true; saveState();
  try {
    const sameSource = item => sourceItem.kind === "screenshot"
      ? item.originalImageId === sourceItem.originalImageId
      : item.kind === "text" && item.sourceText === sourceItem.sourceText && item.page === sourceItem.page;
    const existingCards = state.highlights
      .filter(item => sameSource(item) && item.cloze)
      .map(item => item.cloze);
    const result = sourceItem.kind === "screenshot"
      ? await window.clozeReader.generateScreenshotCards({ imageDataUrl: await window.clozeReader.loadScreenshot(sourceItem.originalImageId), mode: sourceItem.mode || "verbatim", count, existingCards, fileName: sourceItem.fileName || state.fileName, page: sourceItem.page })
      : await window.clozeReader.generateTextCards({ mode: sourceItem.mode || "verbatim", sourceText: sourceItem.sourceText, context: sourceItem.context, count, existingCards, fileName: sourceItem.fileName || state.fileName, page: sourceItem.page });
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
      state.highlights.push(newItem); newItems.push(newItem);
    }
    saveState();
    for (const item of newItems) await syncCard(item);
    toast(`${result.cards.length} additional card${result.cards.length === 1 ? "" : "s"} created and synced.`);
  } catch (error) {
    if (error.message === "OPENAI_KEY_MISSING") $("#settings-dialog").showModal();
    else toast(error.message);
  } finally {
    sourceItem.batchGenerating = false; saveState();
  }
}

async function syncCard(item) {
  if (!item.cloze || !/\{\{c\d+::.+?\}\}/s.test(item.cloze)) return toast("This card needs a valid {{c1::cloze}} deletion.");
  try {
    const extra = await prepareExtraForAnki(item);
    const fieldNames = await window.clozeReader.ankiRequest({ action: "modelFieldNames", params: { modelName: "Cloze" } });
    const { textField, backField } = resolveClozeFields(fieldNames);
    if (!textField || !backField) throw new Error("Your Anki Cloze note type needs separate text and back fields.");
    let front = item.cloze;
    const imageBelow = item.kind === "screenshot" && (item.mode === "interpretative" || item.imagePlacement === "front-below");
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
    else item.ankiNoteId = await window.clozeReader.ankiRequest({ action: "addNote", params: { note: { deckName: item.deck, modelName: "Cloze", fields, options: { allowDuplicate: false }, tags: [...new Set([...item.tags, "cloze-reader"])] } } });
    item.status = "synced"; toast(extra ? `Back synced to Anki field “${backField}”.` : "Cloze card synced to Anki.");
  } catch (error) { item.status = "queued"; item.error = error.message; toast("Card saved here; open Anki and retry when ready."); }
  saveState(); await refreshConnections();
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
  if (item.originalImageId && item.mode === "verbatim" && item.includeImageOnBack !== false) {
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
  state.occlusionDraft = { ...draft, concealRect: null };
  $("#occlusion-image").src = draft.imageDataUrl; $("#occlusion-box").hidden = true; $("#create-occlusion").disabled = true;
  $("#occlusion-dialog").showModal();
}

async function createInterpretativeScreenshot(draft) {
  const originalImageId = await window.clozeReader.saveScreenshot(draft.imageDataUrl);
  const item = { id: crypto.randomUUID(), kind: "screenshot", mode: "interpretative", documentId: state.currentDocumentId, fileName: state.fileName, page: draft.page, sourceText: "Interpretative screenshot", rects: [draft.rect], context: "", cloze: "", originalImageId, extraHtml: "", deck: $("#deck-select").value || "Default", tags: ["pdf-reading", "interpretative", "screenshot-card"], status: "generating", createdAt: new Date().toISOString() };
  state.highlights.push(item); saveState(); renderHighlights(item.page); await generateCard(item, false);
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
  const item = { id: crypto.randomUUID(), kind: "screenshot", mode: "verbatim", documentId: state.currentDocumentId, fileName: state.fileName, page: draft.page, sourceText: "Verbatim image occlusion", rects: [draft.rect], context: "", cloze: "Image occlusion: {{c1::reveal the hidden region}}", originalImageId, frontImageId, extraHtml: "", deck: $("#deck-select").value || "Default", tags: ["pdf-reading", "verbatim", "image-occlusion"], status: "draft", createdAt: new Date().toISOString() };
  state.highlights.push(item); saveState(); renderHighlights(item.page); toast("Image-occlusion card ready to review in the sidebar.");
}

function deleteCard(item) { state.highlights = state.highlights.filter(candidate => candidate.id !== item.id); saveState(); renderHighlights(item.page); }
$("#open-button").addEventListener("click", importPdf); $("#empty-open-button").addEventListener("click", importPdf); $("#library-import-button").addEventListener("click", importPdf);
$("#home-button").addEventListener("click", closePdf);
reader.addEventListener("mouseup", () => setTimeout(captureSelection, 0));
reader.addEventListener("contextmenu", event => {
  const page = event.target.closest(".pdf-page");
  if (!page) return;
  event.preventDefault(); beginScreenshotMode(page);
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
  state.highlights = []; saveState();
  reader.querySelectorAll(".pdf-page").forEach(page => renderHighlights(Number(page.dataset.page)));
  toast("Cards and highlights cleared from this PDF. Anki cards were not deleted.");
});
document.addEventListener("click", event => { if (!event.target.closest("#library-context-menu")) $("#library-context-menu").hidden = true; });
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
refreshConnections(); refreshLibrary();
