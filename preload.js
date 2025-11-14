const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Settings
  getAerenderPath: () => ipcRenderer.invoke('get-aerender-path'),
  setAerenderPath: (path) => ipcRenderer.invoke('set-aerender-path', path),
  browseAerender: () => ipcRenderer.invoke('browse-aerender'),
  
  // File operations
  browseProjects: () => ipcRenderer.invoke('browse-projects'),
  browseOutputFolder: () => ipcRenderer.invoke('browse-output-folder'),
  
  // Rendering
  startRender: (item) => ipcRenderer.invoke('start-render', item),
  cancelRender: (itemId) => ipcRenderer.invoke('cancel-render', itemId),
  
  // Queue persistence
  saveQueue: (queue) => ipcRenderer.invoke('save-queue', queue),
  loadQueue: () => ipcRenderer.invoke('load-queue'),
  clearSavedQueue: () => ipcRenderer.invoke('clear-saved-queue'),
  onLoadQueue: (callback) => {
    ipcRenderer.on('load-queue', (event, queue) => callback(queue));
  },
  
  // Time estimates
  getRenderEstimate: (projectName, frameCount) => 
    ipcRenderer.invoke('get-render-estimate', projectName, frameCount),
  
  // Email notifications
  getEmailSettings: () => ipcRenderer.invoke('get-email-settings'),
  saveEmailSettings: (settings) => ipcRenderer.invoke('save-email-settings', settings),
  testEmail: () => ipcRenderer.invoke('test-email'),
  
  // Listen for render progress
  onRenderProgress: (callback) => {
    ipcRenderer.on('render-progress', (event, data) => callback(data));
  },
  onRenderOutput: (callback) => {
    ipcRenderer.on('render-output', (event, data) => callback(data));
  }
});