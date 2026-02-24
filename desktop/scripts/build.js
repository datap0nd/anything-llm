/**
 * Build script for AnythingLLM Desktop
 *
 * Copies the server and frontend into the desktop/app directory,
 * builds the frontend for production, and installs server dependencies.
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const DESKTOP = path.resolve(__dirname, "..");
const APP_DIR = path.join(DESKTOP, "app");
const SERVER_SRC = path.join(ROOT, "server");
const COLLECTOR_SRC = path.join(ROOT, "collector");
const FRONTEND_SRC = path.join(ROOT, "frontend");

function run(cmd, cwd = DESKTOP) {
  console.log(`> ${cmd}`);
  execSync(cmd, { cwd, stdio: "inherit" });
}

function copyDir(src, dest, exclude = []) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });

  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (exclude.includes(entry.name)) continue;

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath, exclude);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

console.log("=== AnythingLLM Desktop Build ===\n");

// 1. Clean previous build
console.log("[1/5] Cleaning previous build...");
if (fs.existsSync(APP_DIR)) {
  fs.rmSync(APP_DIR, { recursive: true });
}
fs.mkdirSync(APP_DIR, { recursive: true });

// 2. Copy server
console.log("[2/5] Copying server...");
copyDir(SERVER_SRC, path.join(APP_DIR, "server"), [
  "node_modules",
  "storage",
  ".env.development",
  ".env",
]);

// 3. Copy collector
console.log("[3/5] Copying collector...");
copyDir(COLLECTOR_SRC, path.join(APP_DIR, "collector"), [
  "node_modules",
  ".env",
]);

// 4. Install server production dependencies
console.log("[4/5] Installing server dependencies...");
run("yarn install --production", path.join(APP_DIR, "server"));

// 5. Build frontend and copy to server/public
console.log("[5/5] Building frontend...");

// Set the API base for production (served from same origin)
const frontendEnv = path.join(FRONTEND_SRC, ".env");
const envContent = fs.readFileSync(frontendEnv, "utf8");
const prodEnv = envContent.replace(
  /VITE_API_BASE=.*/,
  "VITE_API_BASE='/api'"
);
fs.writeFileSync(frontendEnv, prodEnv);

run("yarn build", FRONTEND_SRC);

// Copy built frontend to server/public
const frontendDist = path.join(FRONTEND_SRC, "dist");
const serverPublic = path.join(APP_DIR, "server", "public");
copyDir(frontendDist, serverPublic);

console.log("\n=== Build complete! ===");
console.log(`Output: ${APP_DIR}`);
