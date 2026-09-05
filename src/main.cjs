const { app, BrowserWindow, clipboard, dialog, ipcMain, safeStorage } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1180,
    minHeight: 680,
    title: "Cloze Reader",
    backgroundColor: "#f3f0e9",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  window.loadFile(path.join(__dirname, "renderer", "index.html"));
}

ipcMain.handle("pdf:open", async () => {
  const result = await dialog.showOpenDialog({
    title: "Open a PDF",
    properties: ["openFile"],
    filters: [{ name: "PDF documents", extensions: ["pdf"] }]
  });

  if (result.canceled || !result.filePaths[0]) return null;
  const filePath = result.filePaths[0];
  const bytes = await fs.readFile(filePath);
  const id = crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 24);
  const libraryDirectory = path.join(app.getPath("userData"), "pdf-library");
  await fs.mkdir(libraryDirectory, { recursive: true });
  await fs.writeFile(path.join(libraryDirectory, `${id}.pdf`), bytes);
  const indexPath = path.join(libraryDirectory, "index.json");
  let index = [];
  try { index = JSON.parse(await fs.readFile(indexPath, "utf8")); } catch {}
  const existing = index.find(item => item.id === id);
  if (existing) existing.lastOpenedAt = new Date().toISOString();
  else index.push({ id, name: path.basename(filePath), importedAt: new Date().toISOString(), lastOpenedAt: new Date().toISOString() });
  await fs.writeFile(indexPath, JSON.stringify(index, null, 2));
  return {
    id,
    name: path.basename(filePath),
    bytes: Uint8Array.from(bytes)
  };
});

ipcMain.handle("pdf:list", async () => {
  try {
    const contents = await fs.readFile(path.join(app.getPath("userData"), "pdf-library", "index.json"), "utf8");
    return JSON.parse(contents).sort((a, b) => String(b.lastOpenedAt).localeCompare(String(a.lastOpenedAt)));
  } catch { return []; }
});

ipcMain.handle("pdf:load", async (_event, id) => {
  if (!/^[a-f0-9]{24}$/.test(String(id))) throw new Error("Invalid library document ID.");
  const directory = path.join(app.getPath("userData"), "pdf-library");
  const indexPath = path.join(directory, "index.json");
  const index = JSON.parse(await fs.readFile(indexPath, "utf8"));
  const item = index.find(entry => entry.id === id);
  if (!item) throw new Error("That PDF is no longer available.");
  item.lastOpenedAt = new Date().toISOString();
  await fs.writeFile(indexPath, JSON.stringify(index, null, 2));
  const bytes = await fs.readFile(path.join(directory, `${id}.pdf`));
  return { id, name: item.name, bytes: Uint8Array.from(bytes) };
});

ipcMain.handle("pdf:rename", async (_event, payload) => {
  const id = String(payload?.id || "");
  const name = String(payload?.name || "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 180);
  if (!/^[a-f0-9]{24}$/.test(id)) throw new Error("Invalid library document ID.");
  if (!name) throw new Error("Enter a name for the PDF.");
  const indexPath = path.join(app.getPath("userData"), "pdf-library", "index.json");
  const index = JSON.parse(await fs.readFile(indexPath, "utf8"));
  const item = index.find(entry => entry.id === id);
  if (!item) throw new Error("That PDF is no longer available.");
  item.name = name;
  await fs.writeFile(indexPath, JSON.stringify(index, null, 2));
  return { id, name };
});

ipcMain.handle("anki:request", async (_event, payload) => {
  const response = await fetch("http://127.0.0.1:8765", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ version: 6, ...payload })
  });

  if (!response.ok) throw new Error(`AnkiConnect returned HTTP ${response.status}`);
  const data = await response.json();
  if (data.error) throw new Error(data.error);
  return data.result;
});

ipcMain.handle("clipboard:read-image", () => {
  const image = clipboard.readImage();
  return image.isEmpty() ? "" : image.toDataURL();
});

ipcMain.handle("screenshot:save", async (_event, dataUrl) => {
  const match = String(dataUrl || "").match(/^data:image\/(png|jpeg|webp);base64,(.+)$/i);
  if (!match) throw new Error("Unsupported screenshot format.");
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length > 9_000_000) throw new Error("The screenshot is too large to save.");
  const extension = match[1].toLowerCase() === "jpeg" ? "jpg" : match[1].toLowerCase();
  const id = `${crypto.createHash("sha256").update(bytes).digest("hex")}.${extension}`;
  const directory = path.join(app.getPath("userData"), "card-images");
  await fs.mkdir(directory, { recursive: true }); await fs.writeFile(path.join(directory, id), bytes);
  return id;
});

ipcMain.handle("screenshot:load", async (_event, id) => {
  const safeId = String(id || "");
  if (!/^[a-f0-9]{64}\.(png|jpg|webp)$/.test(safeId)) throw new Error("Invalid screenshot reference.");
  const bytes = await fs.readFile(path.join(app.getPath("userData"), "card-images", safeId));
  const mime = safeId.endsWith(".jpg") ? "jpeg" : safeId.split(".").pop();
  return `data:image/${mime};base64,${bytes.toString("base64")}`;
});

async function readSettings() {
  try { return JSON.parse(await fs.readFile(path.join(app.getPath("userData"), "settings.json"), "utf8")); }
  catch { return {}; }
}

async function writeSettings(settings) {
  await fs.mkdir(app.getPath("userData"), { recursive: true });
  await fs.writeFile(path.join(app.getPath("userData"), "settings.json"), JSON.stringify(settings), { mode: 0o600 });
}

async function getApiKey() {
  const settings = await readSettings();
  if (!settings.encryptedApiKey || !safeStorage.isEncryptionAvailable()) return "";
  try { return safeStorage.decryptString(Buffer.from(settings.encryptedApiKey, "base64")); }
  catch { return ""; }
}

ipcMain.handle("openai:status", async () => ({ configured: Boolean(await getApiKey()) }));

ipcMain.handle("openai:save-key", async (_event, apiKey) => {
  const trimmed = String(apiKey || "").trim();
  if (!trimmed) { await writeSettings({}); return { configured: false }; }
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure credential storage is unavailable on this Mac.");
  await writeSettings({ encryptedApiKey: safeStorage.encryptString(trimmed).toString("base64") });
  return { configured: true };
});

function responseText(data) {
  return String(data.output_text || data.output?.flatMap(item => item.content || []).find(item => item.type === "output_text")?.text || "")
    .trim().replace(/^```(?:text)?\s*|\s*```$/g, "").trim();
}

async function requestCloze(apiKey, input) {
  let requestInput = input;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-5.6-luna", input: requestInput, reasoning: { effort: "none" }, max_output_tokens: 600 })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || `OpenAI returned HTTP ${response.status}`);
    const cloze = responseText(data);
    if (/\{\{c\d+::.+?\}\}/s.test(cloze)) return { cloze };
    const correction = `Your previous response was invalid because it did not contain a cloze deletion. Return exactly one sentence containing {{c1::answer}} and nothing else. Previous response: ${cloze || "(empty)"}`;
    requestInput = typeof input === "string"
      ? `${input}\n\n${correction}`
      : [...input, { role: "user", content: [{ type: "input_text", text: correction }] }];
  }
  throw new Error("The AI did not return a valid cloze deletion after an automatic retry.");
}

async function requestClozeBatch(apiKey, initialInput, count) {
  let input = initialInput;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST", headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-5.6-luna", input, reasoning: { effort: "none" }, max_output_tokens: 4000 })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || `OpenAI returned HTTP ${response.status}`);
    const output = responseText(data).replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
    try {
      const cards = JSON.parse(output).cards;
      const valid = Array.isArray(cards) && cards.length === count && cards.every(card => typeof card === "string" && /\{\{c\d+::.+?\}\}/s.test(card));
      if (valid && new Set(cards.map(card => card.trim().toLocaleLowerCase())).size === count) return { cards: cards.map(card => card.trim()) };
    } catch {}
    input = [...input, { role: "user", content: [{ type: "input_text", text: `The previous response was invalid. Return exactly ${count} distinct cloze strings in the required JSON object and nothing else.` }] }];
  }
  throw new Error("The AI could not produce the requested number of distinct cards after an automatic retry.");
}

ipcMain.handle("openai:generate-cloze", async (_event, payload) => {
  const apiKey = await getApiKey();
  if (!apiKey) throw new Error("OPENAI_KEY_MISSING");
  const interpretative = payload.mode === "interpretative";
  const prompt = [
    "Create exactly one high-quality Anki cloze card from the selected source passage.",
    interpretative
      ? "Faithfully rewrite the selected passage into one concise, standalone, testable fact, then put only the minimum key answer inside {{c1::...}}."
      : "Preserve the selected passage verbatim and only insert {{c1::...}} around its most educationally important answer span. Do not add, remove, reorder, or reword anything.",
    "Preserve the passage's exact specific knowledge, anatomy, diagnosis, relationships, numbers, directionality, certainty, and qualifiers.",
    "Do not generalize, add outside knowledge, infer a different teaching point, or change the meaning. If a safe rewrite is not possible, preserve the source wording.",
    "The visible text must make the answer uniquely inferable and the cloze must test the central knowledge in the selection.",
    "Return only the finished cloze sentence, with no markdown, label, quotation marks, or explanation.",
    `Document: ${payload.fileName}, page ${payload.page}`,
    `Nearby page text: ${payload.context}`,
    `Selected source passage: ${payload.sourceText}`
  ].join("\n\n");
  return requestCloze(apiKey, prompt);
});

ipcMain.handle("openai:generate-screenshot-card", async (_event, payload) => {
  const apiKey = await getApiKey();
  if (!apiKey) throw new Error("OPENAI_KEY_MISSING");
  const imageDataUrl = String(payload.imageDataUrl || "");
  if (!/^data:image\/(png|jpeg|webp);base64,/i.test(imageDataUrl)) throw new Error("The screenshot format is not supported.");
  if (imageDataUrl.length > 12_000_000) throw new Error("The screenshot is too large to send.");
  const prompt = [
    "Create exactly one concise, standalone Anki cloze card from this PDF screenshot.",
    "Center the card on the most important specific knowledge visibly supported by the screenshot.",
    "Preserve exact anatomy, diagnoses, labels, relationships, numbers, directionality, certainty, and qualifiers.",
    "Do not generalize, add outside knowledge, or infer claims that are not visible in the image.",
    "Put only the minimum key answer span inside {{c1::...}} and make it uniquely inferable from the remaining text.",
    "Return only the finished cloze sentence, with no markdown, label, quotation marks, or explanation.",
    `Document: ${payload.fileName}, page ${payload.page}`
  ].join("\n\n");
  return requestCloze(apiKey, [{ role: "user", content: [{ type: "input_text", text: prompt }, { type: "input_image", image_url: imageDataUrl, detail: "high" }] }]);
});

ipcMain.handle("openai:generate-screenshot-cards", async (_event, payload) => {
  const apiKey = await getApiKey();
  if (!apiKey) throw new Error("OPENAI_KEY_MISSING");
  const imageDataUrl = String(payload.imageDataUrl || ""), count = Math.max(1, Math.min(10, Number(payload.count) || 1));
  const mode = payload.mode === "interpretative" ? "interpretative" : "verbatim";
  if (!/^data:image\/(png|jpeg|webp);base64,/i.test(imageDataUrl)) throw new Error("The screenshot format is not supported.");
  if (imageDataUrl.length > 12_000_000) throw new Error("The screenshot is too large to send.");
  const existingCards = Array.isArray(payload.existingCards) ? payload.existingCards.slice(0, 25).map(value => String(value).slice(0, 1000)) : [];
  const prompt = [
    `Create exactly ${count} additional, distinct Anki cloze cards from this PDF screenshot.`,
    mode === "interpretative"
      ? "Faithfully rewrite each visible fact into a concise standalone card. Each card must test a different fact and contain exactly one {{c1::...}} deletion."
      : "Use wording that appears in the screenshot without introducing or rewriting factual content. Each card must test a different visible fact and contain exactly one {{c1::...}} deletion.",
    "Preserve exact anatomy, diagnoses, labels, relationships, numbers, directionality, certainty, and qualifiers.",
    "Do not generalize, add outside knowledge, or duplicate another card in the batch.",
    existingCards.length ? `Do not duplicate these existing cards:\n${existingCards.map((card, index) => `${index + 1}. ${card}`).join("\n")}` : "There are no existing cards to exclude.",
    `Return only valid JSON in this exact shape: {"cards":["card 1","card 2"]}. The cards array must contain exactly ${count} strings.`,
    `Document: ${payload.fileName}, page ${payload.page}`
  ].join("\n\n");
  return requestClozeBatch(apiKey, [{ role: "user", content: [{ type: "input_text", text: prompt }, { type: "input_image", image_url: imageDataUrl, detail: "high" }] }], count);
});

ipcMain.handle("openai:generate-text-cards", async (_event, payload) => {
  const apiKey = await getApiKey();
  if (!apiKey) throw new Error("OPENAI_KEY_MISSING");
  const count = Math.max(1, Math.min(10, Number(payload.count) || 1));
  const mode = payload.mode === "interpretative" ? "interpretative" : "verbatim";
  const existingCards = Array.isArray(payload.existingCards) ? payload.existingCards.slice(0, 25).map(value => String(value).slice(0, 1000)) : [];
  const prompt = [
    `Create exactly ${count} additional, distinct Anki cloze cards from the selected PDF passage.`,
    mode === "interpretative"
      ? "Faithfully rewrite the source into separate concise, standalone facts while preserving its exact specific knowledge and qualifiers."
      : "Preserve the source wording. Create distinct cards by placing one {{c1::...}} deletion around a different important answer span in each card; do not rewrite the source.",
    "Each card must contain exactly one cloze deletion, test a different fact, and remain supported by the source.",
    "Do not generalize, add outside knowledge, change certainty, or duplicate another card in the batch.",
    existingCards.length ? `Do not duplicate these existing cards:\n${existingCards.map((card, index) => `${index + 1}. ${card}`).join("\n")}` : "There are no existing cards to exclude.",
    `Return only valid JSON in this exact shape: {"cards":["card 1","card 2"]}. The cards array must contain exactly ${count} strings.`,
    `Document: ${payload.fileName}, page ${payload.page}`,
    `Nearby page text: ${String(payload.context || "").slice(0, 5000)}`,
    `Selected source passage: ${String(payload.sourceText || "").slice(0, 3000)}`
  ].join("\n\n");
  return requestClozeBatch(apiKey, [{ role: "user", content: [{ type: "input_text", text: prompt }] }], count);
});

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
