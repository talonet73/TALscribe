'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const invoke = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);
const on = (ch) => (fn) => { const h = (_e, d) => fn(d); ipcRenderer.on(ch, h); return () => ipcRenderer.removeListener(ch, h); };

contextBridge.exposeInMainWorld('tal', {
  info: invoke('app:info'),
  setSettings: invoke('app:setSettings'),
  openExternal: invoke('app:openExternal'),
  openPath: invoke('app:openPath'),
  pickFile: invoke('app:pickFile'),
  pathForFile: (f) => webUtils.getPathForFile(f),

  scan: invoke('hw:scan'),
  models: invoke('models:state'),
  downloadModel: invoke('models:download'),
  cancelDownload: invoke('models:cancel'),
  deleteModel: invoke('models:delete'),
  selectModel: invoke('models:select'),
  installCuda: invoke('engine:installCuda'),
  removeCuda: invoke('engine:removeCuda'),
  onDownload: on('models:progress'),

  start: invoke('job:start'),
  cancel: invoke('job:cancel'),
  onProgress: on('job:progress'),
  onSegment: on('job:segment'),
  onMeta: on('job:meta'),
  onNotice: on('job:notice'),
  onDone: on('job:done'),
  onError: on('job:error'),

  history: invoke('history:list'),
  getItem: invoke('history:get'),
  deleteItem: invoke('history:delete'),
  renameItem: invoke('history:rename'),
  buildExport: invoke('export:build'),
  saveExport: invoke('export:save'),
  updateYtdlp: invoke('ytdlp:update'),

  ollamaStatus: invoke('ollama:status'),
  ollamaPull: invoke('ollama:pull'),
  ollamaRefine: invoke('ollama:refine'),
  ollamaCancel: invoke('ollama:cancel'),
  onOllamaProgress: on('ollama:progress'),
  onOllamaChunk: on('ollama:chunk'),
});
