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

ipcMain.handle("openai:generate-cloze", async (_event, payload) => {
  const apiKey = await getApiKey();
  if (!apiKey) throw new Error("OPENAI_KEY_MISSING");
  const prompt = [
    "Create exactly one high-quality Anki cloze card from the selected source passage.",
    "Choose the most educationally important fact and put only the minimum answer span inside {{c1::...}}.",
    "The remaining text must make the answer uniquely inferable. Rewrite for clarity when needed, but do not introduce unsupported facts.",
    "Return only the finished cloze sentence, with no markdown, label, quotation marks, or explanation.",
    `Document: ${payload.fileName}, page ${payload.page}`,
    `Nearby page text: ${payload.context}`,
    `Selected source passage: ${payload.sourceText}`
  ].join("\n\n");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-5.6-luna", input: prompt, reasoning: { effort: "low" }, max_output_tokens: 180 })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || `OpenAI returned HTTP ${response.status}`);
  const output = data.output_text || data.output?.flatMap(item => item.content || []).find(item => item.type === "output_text")?.text || "";
  const cloze = output.trim().replace(/^```(?:text)?\s*|\s*```$/g, "").trim();
  if (!/\{\{c1::.+?\}\}/s.test(cloze)) throw new Error("The AI response did not contain a valid cloze deletion.");
  return { cloze };
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
