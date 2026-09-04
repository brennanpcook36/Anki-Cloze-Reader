const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("clozeReader", {
  openPdf: () => ipcRenderer.invoke("pdf:open"),
  listPdfs: () => ipcRenderer.invoke("pdf:list"),
  loadPdf: (id) => ipcRenderer.invoke("pdf:load", id),
  renamePdf: (id, name) => ipcRenderer.invoke("pdf:rename", { id, name }),
  ankiRequest: (payload) => ipcRenderer.invoke("anki:request", payload),
  openAIStatus: () => ipcRenderer.invoke("openai:status"),
  saveOpenAIKey: (apiKey) => ipcRenderer.invoke("openai:save-key", apiKey),
  generateCloze: (payload) => ipcRenderer.invoke("openai:generate-cloze", payload),
  readClipboardImage: () => ipcRenderer.invoke("clipboard:read-image")
});
