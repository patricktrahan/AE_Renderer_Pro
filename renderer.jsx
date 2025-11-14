// FILE: renderer.jsx
// Enhanced React UI with Queue Persistence, Time Estimates, and Email Notifications

const { useState, useRef, useEffect } = React;

function App() {
  const [queue, setQueue] = useState([]);
  const [isRendering, setIsRendering] = useState(false);
  const [currentRender, setCurrentRender] = useState(null);
  const [aerenderPath, setAerenderPath] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  const [showOutput, setShowOutput] = useState(false);
  const [renderLog, setRenderLog] = useState([]);
  const [dragActive, setDragActive] = useState(false);
  const [emailSettings, setEmailSettings] = useState({
    enabled: false,
    smtp: '',
    port: 587,
    username: '',
    password: '',
    from: '',
    to: ''
  });
  const [renderStats, setRenderStats] = useState({
    totalRendered: 0,
    totalTime: 0,
    successRate: 100
  });

  // Auto-save queue whenever it changes
  useEffect(() => {
    if (queue.length > 0) {
      window.electronAPI.saveQueue(queue);
    }
  }, [queue]);

  // Load saved data on mount
  useEffect(() => {
    // Load aerender path
    window.electronAPI.getAerenderPath().then(path => {
      setAerenderPath(path);
    });

    // Load email settings
    window.electronAPI.getEmailSettings().then(settings => {
      setEmailSettings(settings);
    });

    // Load saved queue
    window.electronAPI.onLoadQueue((savedQueue) => {
      // Filter out completed/error items, keep only pending
      const pendingItems = savedQueue.filter(item => 
        item.status === 'pending' || item.status === 'rendering'
      ).map(item => ({ ...item, status: 'pending', progress: 0 }));
      
      if (pendingItems.length > 0) {
        setQueue(pendingItems);
      }
    });

    // Listen for render progress updates
    window.electronAPI.onRenderProgress((data) => {
      updateQueueItem(data.id, { 
        progress: data.progress,
        currentFrame: data.currentFrame,
        totalFrames: data.totalFrames,
        eta: data.eta
      });
    });

    // Listen for render output
    window.electronAPI.onRenderOutput((data) => {
      setRenderLog(prev => [...prev.slice(-200), {
        id: data.id,
        text: data.output,
        isError: data.isError,
        timestamp: new Date()
      }]);
    });
  }, []);

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    const files = [...e.dataTransfer.files];
    const aepFiles = files.filter(file => 
      file.name.endsWith('.aep') || file.name.endsWith('.aepx')
    );
    
    if (aepFiles.length > 0) {
      addToQueue(aepFiles.map(f => ({ path: f.path, name: f.name })));
    }
  };

  const handleBrowse = async () => {
    const files = await window.electronAPI.browseProjects();
    if (files.length > 0) {
      addToQueue(files);
    }
  };

  const addToQueue = async (files) => {
    const newItems = await Promise.all(files.map(async (file, idx) => {
      // Try to get render time estimate
      const estimate = await window.electronAPI.getRenderEstimate(file.name, 300);
      
      return {
        id: Date.now() + idx,
        name: file.name,
        path: file.path,
        comp: 'All Comps',
        output: '',
        renderSettings: '',
        outputModule: '',
        status: 'pending',
        progress: 0,
        estimate: estimate,
        startTime: null,
        endTime: null,
        currentFrame: 0,
        totalFrames: 0,
        eta: null
      };
    }));
    
    setQueue(prev => [...prev, ...newItems]);
  };

  const removeFromQueue = (id) => {
    if (currentRender === id) {
      window.electronAPI.cancelRender(id);
    }
    setQueue(prev => prev.filter(item => item.id !== id));
  };

  const updateQueueItem = (id, updates) => {
    setQueue(prev => prev.map(item => 
      item.id === id ? { ...item, ...updates } : item
    ));
  };

  const startRendering = async () => {
    setIsRendering(true);
    const pendingItems = queue.filter(item => item.status === 'pending');
    
    let successCount = 0;
    let totalTime = 0;
    
    for (const item of pendingItems) {
      setCurrentRender(item.id);
      const startTime = Date.now();
      updateQueueItem(item.id, { 
        status: 'rendering', 
        progress: 0,
        startTime: startTime
      });
      
      const result = await window.electronAPI.startRender(item);
      const endTime = Date.now();
      const duration = Math.round((endTime - startTime) / 1000);
      totalTime += duration;
      
      if (result.success) {
        successCount++;
        updateQueueItem(item.id, { 
          status: 'completed', 
          progress: 100,
          endTime: endTime,
          duration: duration,
          frames: result.frames
        });
      } else {
        updateQueueItem(item.id, { 
          status: 'error', 
          error: result.error,
          progress: 0,
          endTime: endTime,
          duration: duration
        });
      }
    }
    
    // Update stats
    setRenderStats({
      totalRendered: renderStats.totalRendered + pendingItems.length,
      totalTime: renderStats.totalTime + totalTime,
      successRate: Math.round((successCount / pendingItems.length) * 100)
    });
    
    setIsRendering(false);
    setCurrentRender(null);
  };

  const stopRendering = () => {
    if (currentRender) {
      window.electronAPI.cancelRender(currentRender);
      updateQueueItem(currentRender, { status: 'cancelled', progress: 0 });
    }
    setIsRendering(false);
    setCurrentRender(null);
  };

  const saveAerenderPath = async () => {
    await window.electronAPI.setAerenderPath(aerenderPath);
    alert('Aerender path saved!');
  };

  const browseAerenderPath = async () => {
    const path = await window.electronAPI.browseAerender();
    if (path) {
      setAerenderPath(path);
    }
  };

  const browseOutputFolder = async (itemId) => {
    const folder = await window.electronAPI.browseOutputFolder();
    if (folder) {
      updateQueueItem(itemId, { output: folder });
    }
  };

  const saveEmailSettings = async () => {
    await window.electronAPI.saveEmailSettings(emailSettings);
    alert('Email settings saved!');
  };

  const testEmail = async () => {
    const result = await window.electronAPI.testEmail();
    if (result.success) {
      alert('Test email sent successfully! Check your inbox.');
    } else {
      alert(`Email test failed: ${result.error}`);
    }
  };

  const clearCompleted = () => {
    setQueue(prev => prev.filter(item => 
      item.status !== 'completed' && item.status !== 'error' && item.status !== 'cancelled'
    ));
  };

  const clearQueue = async () => {
    if (confirm('Clear entire queue? This cannot be undone.')) {
      setQueue([]);
      await window.electronAPI.clearSavedQueue();
    }
  };

  const formatDuration = (seconds) => {
    if (!seconds) return '0s';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) return `${hours}h ${minutes}m ${secs}s`;
    if (minutes > 0) return `${minutes}m ${secs}s`;
    return `${secs}s`;
  };

  const formatETA = (seconds) => {
    if (!seconds) return 'Calculating...';
    return `~${formatDuration(seconds)} remaining`;
  };

  const renderStatuses = {
    pending: { icon: '⏱️', color: 'text-gray-400', bg: 'bg-gray-800', label: 'Pending' },
    rendering: { icon: '🔄', color: 'text-blue-500', bg: 'bg-blue-900/50', label: 'Rendering' },
    completed: { icon: '✅', color: 'text-green-500', bg: 'bg-green-900/50', label: 'Completed' },
    error: { icon: '❌', color: 'text-red-500', bg: 'bg-red-900/50', label: 'Error' },
    cancelled: { icon: '⛔', color: 'text-orange-500', bg: 'bg-orange-900/50', label: 'Cancelled' }
  };

  return (
    <div className="w-full h-screen bg-gradient-to-br from-slate-900 to-slate-800 text-white flex flex-col">
      {/* Header */}
      <div className="bg-slate-800/50 border-b border-slate-700 p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center text-2xl">
            ▶️
          </div>
          <div>
            <h1 className="text-xl font-bold">AE Background Renderer Pro</h1>
            <p className="text-sm text-slate-400">
              {renderStats.totalRendered} total renders • {formatDuration(renderStats.totalTime)} total time
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowOutput(!showOutput)}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm transition-colors"
          >
            {showOutput ? '📋 Hide' : '📋 Show'} Output
          </button>
          <button
            onClick={() => setShowEmail(!showEmail)}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm transition-colors"
          >
            📧 Email
          </button>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm transition-colors"
          >
            ⚙️ Settings
          </button>
        </div>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <div className="bg-slate-800/90 border-b border-slate-700 p-4">
          <div className="max-w-3xl space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">aerender.exe Path</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={aerenderPath}
                  onChange={(e) => setAerenderPath(e.target.value)}
                  className="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-sm"
                  placeholder="C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\aerender.exe"
                />
                <button
                  onClick={browseAerenderPath}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm"
                >
                  Browse
                </button>
                <button
                  onClick={saveAerenderPath}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm"
                >
                  Save
                </button>
              </div>
            </div>
            
            <div className="flex gap-4 pt-2">
              <div className="bg-slate-900/50 rounded-lg p-3 flex-1">
                <div className="text-sm text-slate-400">Total Renders</div>
                <div className="text-2xl font-bold">{renderStats.totalRendered}</div>
              </div>
              <div className="bg-slate-900/50 rounded-lg p-3 flex-1">
                <div className="text-sm text-slate-400">Total Time</div>
                <div className="text-2xl font-bold">{formatDuration(renderStats.totalTime)}</div>
              </div>
              <div className="bg-slate-900/50 rounded-lg p-3 flex-1">
                <div className="text-sm text-slate-400">Success Rate</div>
                <div className="text-2xl font-bold text-green-500">{renderStats.successRate}%</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Email Settings Panel */}
      {showEmail && (
        <div className="bg-slate-800/90 border-b border-slate-700 p-4">
          <div className="max-w-3xl space-y-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Email Notifications</h3>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={emailSettings.enabled}
                  onChange={(e) => setEmailSettings({...emailSettings, enabled: e.target.checked})}
                  className="w-5 h-5"
                />
                <span className="text-sm">Enable notifications</span>
              </label>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">SMTP Server</label>
                <input
                  type="text"
                  value={emailSettings.smtp}
                  onChange={(e) => setEmailSettings({...emailSettings, smtp: e.target.value})}
                  placeholder="smtp.gmail.com"
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Port</label>
                <input
                  type="number"
                  value={emailSettings.port}
                  onChange={(e) => setEmailSettings({...emailSettings, port: parseInt(e.target.value)})}
                  placeholder="587"
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Username</label>
                <input
                  type="text"
                  value={emailSettings.username}
                  onChange={(e) => setEmailSettings({...emailSettings, username: e.target.value})}
                  placeholder="your.email@gmail.com"
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Password / App Password</label>
                <input
                  type="password"
                  value={emailSettings.password}
                  onChange={(e) => setEmailSettings({...emailSettings, password: e.target.value})}
                  placeholder="••••••••"
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">From Email</label>
                <input
                  type="email"
                  value={emailSettings.from}
                  onChange={(e) => setEmailSettings({...emailSettings, from: e.target.value})}
                  placeholder="sender@example.com"
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">To Email</label>
                <input
                  type="email"
                  value={emailSettings.to}
                  onChange={(e) => setEmailSettings({...emailSettings, to: e.target.value})}
                  placeholder="recipient@example.com"
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-sm"
                />
              </div>
            </div>
            
            <div className="flex gap-2">
              <button
                onClick={saveEmailSettings}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm"
              >
                Save Settings
              </button>
              <button
                onClick={testEmail}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded-lg text-sm"
              >
                Send Test Email
              </button>
            </div>
            
            <p className="text-xs text-slate-400">
              💡 Tip: For Gmail, use an App Password instead of your regular password. 
              Generate one at: myaccount.google.com/apppasswords
            </p>
          </div>
        </div>
      )}

      {/* Output Log Panel */}
      {showOutput && (
        <div className="bg-slate-900/90 border-b border-slate-700 p-4 max-h-64 overflow-y-auto">
          <div className="font-mono text-xs space-y-1">
            {renderLog.length === 0 ? (
              <p className="text-slate-500">No output yet...</p>
            ) : (
              renderLog.map((log, idx) => (
                <div key={idx} className={log.isError ? 'text-red-400' : 'text-green-400'}>
                  {log.text}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col p-6 overflow-hidden">
        {/* Drop Zone */}
        <div
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-xl p-8 mb-6 transition-all ${
            dragActive 
              ? 'border-blue-500 bg-blue-500/10' 
              : 'border-slate-600 bg-slate-800/30'
          }`}
        >
          <div className="text-center">
            <div className="text-5xl mb-4">📁</div>
            <p className="text-lg font-medium mb-2">
              Drag & Drop AE Projects Here
            </p>
            <p className="text-sm text-slate-400 mb-4">
              Queue persists between sessions - your renders won't be lost!
            </p>
            <button
              onClick={handleBrowse}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
            >
              Browse Files
            </button>
          </div>
        </div>

        {/* Queue Controls */}
        {queue.length > 0 && (
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm text-slate-400">
              {queue.length} items • {queue.filter(i => i.status === 'pending').length} pending • 
              {queue.filter(i => i.status === 'completed').length} completed • 
              {queue.filter(i => i.status === 'error').length} errors
            </div>
            <div className="flex gap-2">
              <button
                onClick={clearCompleted}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm"
              >
                Clear Completed
              </button>
              <button
                onClick={clearQueue}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm"
              >
                Clear All
              </button>
              {isRendering ? (
                <button
                  onClick={stopRendering}
                  className="px-6 py-2 bg-red-600 hover:bg-red-700 rounded-lg font-medium"
                >
                  ⏸️ Stop Queue
                </button>
              ) : (
                <button
                  onClick={startRendering}
                  disabled={queue.filter(i => i.status === 'pending').length === 0}
                  className="px-6 py-2 bg-green-600 hover:bg-green-700 disabled:bg-slate-700 disabled:cursor-not-allowed rounded-lg font-medium"
                >
                  ▶️ Start Queue
                </button>
              )}
            </div>
          </div>
        )}

        {/* Render Queue */}
        <div className="flex-1 overflow-y-auto space-y-2">
          {queue.map((item) => (
            <div
              key={item.id}
              className={`rounded-lg p-4 border transition-all ${renderStatuses[item.status].bg} ${
                item.id === currentRender 
                  ? 'border-blue-500 shadow-lg shadow-blue-500/20' 
                  : 'border-slate-700'
              }`}
            >
              <div className="flex items-start gap-4">
                <div className="text-2xl p-2 rounded-lg bg-slate-900/50">
                  {renderStatuses[item.status].icon}
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium truncate">{item.name}</h3>
                      <p className="text-sm text-slate-400 truncate">{item.path}</p>
                    </div>
                    <button
                      onClick={() => removeFromQueue(item.id)}
                      disabled={item.status === 'rendering'}
                      className="p-1 hover:bg-slate-700 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      ❌
                    </button>
                  </div>
                  
                  {/* Configuration */}
                  {item.status === 'pending' && (
                    <div className="grid grid-cols-2 gap-2 mb-2 text-sm">
                      <div>
                        <label className="text-slate-500 text-xs">Output Folder:</label>
                        <div className="flex gap-1 mt-1">
                          <input
                            type="text"
                            value={item.output}
                            onChange={(e) => updateQueueItem(item.id, { output: e.target.value })}
                            placeholder="Leave blank for default"
                            className="flex-1 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs"
                          />
                          <button
                            onClick={() => browseOutputFolder(item.id)}
                            className="px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded text-xs"
                          >
                            📁
                          </button>
                        </div>
                      </div>
                      <div>
                        <label className="text-slate-500 text-xs">Composition:</label>
                        <input
                          type="text"
                          value={item.comp}
                          onChange={(e) => updateQueueItem(item.id, { comp: e.target.value })}
                          className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs mt-1"
                        />
                      </div>
                    </div>
                  )}
                  
                  {/* Render Progress */}
                  {item.status === 'rendering' && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-400">
                          {item.currentFrame > 0 ? `Frame ${item.currentFrame} / ${item.totalFrames}` : 'Starting...'}
                        </span>
                        <span className="font-medium">{item.progress}%</span>
                      </div>
                      <div className="w-full bg-slate-700 rounded-full h-2">
                        <div
                          className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                          style={{ width: `${item.progress}%` }}
                        />
                      </div>
                      {item.eta && (
                        <div className="text-xs text-slate-400">
                          {formatETA(item.eta)}
                        </div>
                      )}
                    </div>
                  )}
                  
                  {/* Completed */}
                  {item.status === 'completed' && (
                    <div className="text-sm">
                      <p className="text-green-400">✅ Completed in {formatDuration(item.duration)}</p>
                      {item.frames > 0 && (
                        <p className="text-slate-400 text-xs">{item.frames} frames rendered</p>
                      )}
                    </div>
                  )}
                  
                  {/* Error */}
                  {item.status === 'error' && (
                    <p className="text-sm text-red-400">❌ Error: {item.error}</p>
                  )}
                  
                  {/* Estimate */}
                  {item.status === 'pending' && item.estimate && (
                    <div className="text-xs text-slate-500 mt-2">
                      ⏱️ Estimated time: {formatDuration(item.estimate)} (based on previous renders)
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {queue.length === 0 && (
          <div className="flex-1 flex items-center justify-center text-slate-500">
            <div className="text-center">
              <div className="text-6xl mb-4 opacity-20">▶️</div>
              <p className="text-lg">No items in queue</p>
              <p className="text-sm">Add After Effects projects to get started</p>
              <p className="text-xs text-slate-600 mt-2">Queue automatically saves between sessions</p>
            </div>
          </div>
        )}
      </div>

      {/* Status Bar */}
      <div className="bg-slate-800/50 border-t border-slate-700 px-6 py-3 flex items-center justify-between text-sm">
        <div className="text-slate-400">
          {isRendering ? (
            <span className="flex items-center gap-2">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              Rendering in background - AE is still usable
              {emailSettings.enabled && ' • Email notifications enabled'}
            </span>
          ) : (
            <span>Ready to render • Queue auto-saves</span>
          )}
        </div>
        <div className="text-slate-500">
          After Effects 2025 • v2.0 Pro
        </div>
      </div>
    </div>
  );
}

ReactDOM.render(<App />, document.getElementById('root'));