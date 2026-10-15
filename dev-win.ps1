# dev-win.ps1 — Windows-friendly dev launcher for Stagesmith
# Usage: .\dev-win.ps1
# Starts the Next.js dev server (port 3000) and the stagesmith-sync
# service (port 3003) in separate PowerShell windows.

$root = $PSScriptRoot

# Start the sync service in a new window
Start-Process powershell -ArgumentList @(
  "-NoExit",
  "-Command",
  "cd '$root\mini-services\stagesmith-sync'; npm run start:node"
) -WindowStyle Normal

# Small delay so sync starts first
Start-Sleep -Milliseconds 800

# Start Next.js in the current window
Write-Host "Starting Next.js dev server on port 3000..." -ForegroundColor Cyan
Set-Location $root
npx next dev -p 3000
