const { app, BrowserWindow, ipcMain, dialog, Notification } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const Store = require('electron-store');
const nodemailer = require('nodemailer');

const store = new Store();
let mainWindow;
let renderProcesses = new Map();
let renderStats = new Map(); // Track render times for estimates

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    backgroundColor: '#0f172a',
    icon: path.join(__dirname, 'icon.ico')
  });

  mainWindow.loadFile('index.html');
  
  // Load persisted queue on startup
  const savedQueue = store.get('renderQueue', []);
  if (savedQueue.length > 0) {
    mainWindow.webContents.on('did-finish-load', () => {
      mainWindow.webContents.send('load-queue', savedQueue);
    });
  }
  
  // Uncomment for dev tools
  // mainWindow.webContents.openDevTools();
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  // Kill all running render processes
  renderProcesses.forEach(proc => proc.kill());
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// ========================================
// QUEUE PERSISTENCE
// ========================================
ipcMain.handle('save-queue', (event, queue) => {
  store.set('renderQueue', queue);
  return true;
});

ipcMain.handle('load-queue', () => {
  return store.get('renderQueue', []);
});

ipcMain.handle('clear-saved-queue', () => {
  store.delete('renderQueue');
  return true;
});

// ========================================
// RENDER TIME TRACKING & ESTIMATES
// ========================================
function saveRenderStats(projectName, duration, frameCount) {
  const stats = store.get('renderStats', {});
  if (!stats[projectName]) {
    stats[projectName] = [];
  }
  
  stats[projectName].push({
    duration: duration,
    frameCount: frameCount,
    timestamp: Date.now()
  });
  
  // Keep only last 10 renders for each project
  if (stats[projectName].length > 10) {
    stats[projectName] = stats[projectName].slice(-10);
  }
  
  store.set('renderStats', stats);
}

function estimateRenderTime(projectName, frameCount) {
  const stats = store.get('renderStats', {});
  const projectStats = stats[projectName];
  
  if (!projectStats || projectStats.length === 0) {
    return null; // No historical data
  }
  
  // Calculate average time per frame from recent renders
  const avgTimePerFrame = projectStats.reduce((sum, stat) => {
    return sum + (stat.duration / stat.frameCount);
  }, 0) / projectStats.length;
  
  return Math.round(avgTimePerFrame * frameCount);
}

ipcMain.handle('get-render-estimate', (event, projectName, frameCount) => {
  return estimateRenderTime(projectName, frameCount);
});

// ========================================
// EMAIL NOTIFICATIONS
// ========================================
async function sendEmailNotification(to, subject, body) {
  const emailSettings = store.get('emailSettings', {});
  
  if (!emailSettings.enabled || !emailSettings.smtp || !emailSettings.from) {
    return { success: false, error: 'Email not configured' };
  }
  
  try {
    const transporter = nodemailer.createTransport({
      host: emailSettings.smtp,
      port: emailSettings.port || 587,
      secure: emailSettings.port === 465,
      auth: {
        user: emailSettings.username,
        pass: emailSettings.password
      }
    });
    
    await transporter.sendMail({
      from: emailSettings.from,
      to: to,
      subject: subject,
      text: body,
      html: body.replace(/\n/g, '<br>')
    });
    
    return { success: true };
  } catch (error) {
    console.error('Email error:', error);
    return { success: false, error: error.message };
  }
}

ipcMain.handle('get-email-settings', () => {
  return store.get('emailSettings', {
    enabled: false,
    smtp: '',
    port: 587,
    username: '',
    password: '',
    from: '',
    to: ''
  });
});

ipcMain.handle('save-email-settings', (event, settings) => {
  store.set('emailSettings', settings);
  return true;
});

ipcMain.handle('test-email', async (event) => {
  const settings = store.get('emailSettings', {});
  return await sendEmailNotification(
    settings.to,
    'AE Renderer - Test Email',
    'This is a test email from AE Background Renderer. Email notifications are working correctly!'
  );
});

// ========================================
// SETTINGS
// ========================================
ipcMain.handle('get-aerender-path', () => {
  return store.get('aerenderPath', 'C:\\Program Files\\Adobe\\Adobe After Effects 2025\\Support Files\\aerender.exe');
});

ipcMain.handle('set-aerender-path', (event, path) => {
  store.set('aerenderPath', path);
  return true;
});

ipcMain.handle('browse-aerender', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select aerender.exe',
    filters: [{ name: 'Executable', extensions: ['exe'] }],
    properties: ['openFile']
  });
  
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('browse-projects', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select After Effects Projects',
    filters: [
      { name: 'After Effects Projects', extensions: ['aep', 'aepx'] }
    ],
    properties: ['openFile', 'multiSelections']
  });
  
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths.map(filePath => ({
      path: filePath,
      name: path.basename(filePath)
    }));
  }
  return [];
});

ipcMain.handle('browse-output-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Output Folder',
    properties: ['openDirectory']
  });
  
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

// ========================================
// RENDERING WITH TIME TRACKING
// ========================================
ipcMain.handle('start-render', async (event, item) => {
  const aerenderPath = store.get('aerenderPath');
  
  if (!fs.existsSync(aerenderPath)) {
    return { success: false, error: 'aerender.exe not found at specified path' };
  }
  
  if (!fs.existsSync(item.path)) {
    return { success: false, error: 'Project file not found' };
  }

  const startTime = Date.now();

  return new Promise((resolve) => {
    const args = ['-project', item.path];
    
    if (item.comp && item.comp !== 'All Comps') {
      args.push('-comp', item.comp);
    }
    
    if (item.output) {
      args.push('-output', item.output);
    }
    
    if (item.renderSettings) {
      args.push('-RStemplate', item.renderSettings);
    }
    
    if (item.outputModule) {
      args.push('-OMtemplate', item.outputModule);
    }

    console.log('Starting render:', aerenderPath, args);

    const renderProcess = spawn(aerenderPath, args);
    renderProcesses.set(item.id, renderProcess);

    let outputData = '';
    let errorData = '';
    let totalFrames = 0;
    let currentFrame = 0;

    renderProcess.stdout.on('data', (data) => {
      const output = data.toString();
      outputData += output;
      
      // Parse frame count: "Total Frames: 300"
      const frameCountMatch = output.match(/Total Frames:\s*(\d+)/i);
      if (frameCountMatch) {
        totalFrames = parseInt(frameCountMatch[1]);
      }
      
      // Parse current frame: "Rendering frame 150 of 300"
      const frameMatch = output.match(/Rendering frame\s*(\d+)\s*of\s*(\d+)/i);
      if (frameMatch) {
        currentFrame = parseInt(frameMatch[1]);
        const total = parseInt(frameMatch[2]);
        const progress = Math.round((currentFrame / total) * 100);
        
        // Calculate ETA
        const elapsed = Date.now() - startTime;
        const timePerFrame = elapsed / currentFrame;
        const remainingFrames = total - currentFrame;
        const eta = Math.round((remainingFrames * timePerFrame) / 1000); // seconds
        
        mainWindow.webContents.send('render-progress', {
          id: item.id,
          progress: progress,
          currentFrame: currentFrame,
          totalFrames: total,
          eta: eta
        });
      }
      
      // Legacy progress parsing
      const progressMatch = output.match(/PROGRESS:\s*(\d+)%/);
      if (progressMatch && !frameMatch) {
        const progress = parseInt(progressMatch[1]);
        mainWindow.webContents.send('render-progress', {
          id: item.id,
          progress: progress
        });
      }
      
      mainWindow.webContents.send('render-output', {
        id: item.id,
        output: output
      });
    });

    renderProcess.stderr.on('data', (data) => {
      errorData += data.toString();
      mainWindow.webContents.send('render-output', {
        id: item.id,
        output: data.toString(),
        isError: true
      });
    });

    renderProcess.on('close', (code) => {
      renderProcesses.delete(item.id);
      const duration = Math.round((Date.now() - startTime) / 1000); // seconds
      
      if (code === 0) {
        // Save render stats for future estimates
        if (totalFrames > 0) {
          saveRenderStats(item.name, duration, totalFrames);
        }
        
        // Send desktop notification
        if (Notification.isSupported()) {
          new Notification({
            title: 'Render Complete',
            body: `${item.name} finished in ${formatDuration(duration)}`
          }).show();
        }
        
        // Send email notification if enabled
        const emailSettings = store.get('emailSettings', {});
        if (emailSettings.enabled && emailSettings.to) {
          sendEmailNotification(
            emailSettings.to,
            'AE Render Complete',
            `Project: ${item.name}\nDuration: ${formatDuration(duration)}\nStatus: Success`
          );
        }
        
        resolve({ 
          success: true, 
          output: outputData,
          duration: duration,
          frames: totalFrames
        });
      } else {
        // Send failure notification
        if (Notification.isSupported()) {
          new Notification({
            title: 'Render Failed',
            body: `${item.name} failed with code ${code}`
          }).show();
        }
        
        const emailSettings = store.get('emailSettings', {});
        if (emailSettings.enabled && emailSettings.to) {
          sendEmailNotification(
            emailSettings.to,
            'AE Render Failed',
            `Project: ${item.name}\nError Code: ${code}\nDetails: ${errorData || 'See logs for details'}`
          );
        }
        
        resolve({ 
          success: false, 
          error: `Render failed with code ${code}`,
          details: errorData || outputData
        });
      }
    });

    renderProcess.on('error', (error) => {
      renderProcesses.delete(item.id);
      resolve({ 
        success: false, 
        error: error.message 
      });
    });
  });
});

ipcMain.handle('cancel-render', (event, itemId) => {
  const renderProcess = renderProcesses.get(itemId);
  if (renderProcess) {
    renderProcess.kill();
    renderProcesses.delete(itemId);
    return true;
  }
  return false;
});

// ========================================
// UTILITY FUNCTIONS
// ========================================
function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  } else {
    return `${secs}s`;
  }
}
