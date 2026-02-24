const { app, BrowserWindow, shell, dialog, Menu, Tray } = require("electron");
const path = require("path");
const { fork } = require("child_process");
const net = require("net");

const SERVER_PORT = 3001;
const isDev = !app.isPackaged;

let mainWindow = null;
let serverProcess = null;
let tray = null;

function getResourcePath(...segments) {
  if (isDev) {
    return path.join(__dirname, "..", "app", ...segments);
  }
  return path.join(process.resourcesPath, ...segments);
}

function waitForPort(port, host = "127.0.0.1", timeout = 30000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tryConnect = () => {
      const socket = new net.Socket();
      socket.setTimeout(1000);
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() - start > timeout) {
          reject(new Error(`Server did not start within ${timeout}ms`));
        } else {
          setTimeout(tryConnect, 500);
        }
      });
      socket.once("timeout", () => {
        socket.destroy();
        if (Date.now() - start > timeout) {
          reject(new Error(`Server did not start within ${timeout}ms`));
        } else {
          setTimeout(tryConnect, 500);
        }
      });
      socket.connect(port, host);
    };
    tryConnect();
  });
}

function startServer() {
  const serverPath = getResourcePath("server");
  const serverEntry = path.join(serverPath, "index.js");
  const storagePath = path.join(app.getPath("userData"), "storage");

  // Ensure storage directory exists
  const fs = require("fs");
  if (!fs.existsSync(storagePath)) {
    fs.mkdirSync(storagePath, { recursive: true });
  }

  const env = {
    ...process.env,
    NODE_ENV: "production",
    SERVER_PORT: String(SERVER_PORT),
    STORAGE_DIR: storagePath,
    LLM_PROVIDER: "litellm",
    VECTOR_DB: "lancedb",
    EMBEDDING_ENGINE: "native",
  };

  console.log("[Desktop] Starting server from:", serverEntry);
  console.log("[Desktop] Storage path:", storagePath);

  serverProcess = fork(serverEntry, [], {
    cwd: serverPath,
    env,
    stdio: ["pipe", "pipe", "pipe", "ipc"],
  });

  serverProcess.stdout.on("data", (data) => {
    console.log(`[Server] ${data.toString().trim()}`);
  });

  serverProcess.stderr.on("data", (data) => {
    console.error(`[Server] ${data.toString().trim()}`);
  });

  serverProcess.on("exit", (code) => {
    console.log(`[Desktop] Server exited with code ${code}`);
    serverProcess = null;
  });

  return waitForPort(SERVER_PORT);
}

function stopServer() {
  if (serverProcess) {
    console.log("[Desktop] Stopping server...");
    serverProcess.kill();
    serverProcess = null;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "AnythingLLM",
    icon: path.join(__dirname, "..", "assets", "icon.png"),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    show: false,
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.loadURL(`http://127.0.0.1:${SERVER_PORT}`);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Build app menu
  const menuTemplate = [
    {
      label: "File",
      submenu: [
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));
}

app.on("ready", async () => {
  try {
    await startServer();
    createWindow();
  } catch (err) {
    dialog.showErrorBox(
      "Failed to start AnythingLLM",
      `The server could not be started.\n\n${err.message}`
    );
    app.quit();
  }
});

app.on("window-all-closed", () => {
  stopServer();
  app.quit();
});

app.on("before-quit", () => {
  stopServer();
});

app.on("activate", () => {
  if (mainWindow === null) {
    createWindow();
  }
});
