const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("clozeReader", {
  openPdf: () => ipcRenderer.invoke("pdf:open"),
  listPdfs: () => ipcRenderer.invoke("pdf:list"),
  loadPdf: (id) => ipcRenderer.invoke("pdf:load", id),
  renamePdf: (id, name) => ipcRenderer.invoke("pdf:rename", { id, name }),
  ankiRequest: (payload) => ipcRenderer.invoke("anki:request", payload),
  launchAnki: () => ipcRenderer.invoke("anki:launch"),
  isAnkiRunning: () => ipcRenderer.invoke("anki:is-running"),
  openAIStatus: () => ipcRenderer.invoke("openai:status"),
  saveOpenAIKey: (apiKey) => ipcRenderer.invoke("openai:save-key", apiKey),
  selectBulkCards: payload => ipcRenderer.invoke("openai:select-bulk-cards", payload),
  bulkCards: payload => ipcRenderer.invoke("openai:bulk-cards", payload),
  improveCard: payload => ipcRenderer.invoke("openai:improve-card", payload),
  generateCloze: (payload) => ipcRenderer.invoke("openai:generate-cloze", payload),
  generateScreenshotCard: (payload) => ipcRenderer.invoke("openai:generate-screenshot-card", payload),
  generateScreenshotCards: (payload) => ipcRenderer.invoke("openai:generate-screenshot-cards", payload),
  generateTextCards: (payload) => ipcRenderer.invoke("openai:generate-text-cards", payload),
  readClipboardImage: () => ipcRenderer.invoke("clipboard:read-image"),
  saveScreenshot: (dataUrl) => ipcRenderer.invoke("screenshot:save", dataUrl),
  loadScreenshot: (id) => ipcRenderer.invoke("screenshot:load", id)
});
