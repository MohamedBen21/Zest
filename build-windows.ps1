# Zest - one-click Windows build
# Usage (PowerShell, inside this folder):  powershell -ExecutionPolicy Bypass -File .\build-windows.ps1
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

function Step($m) { Write-Host "`n=== $m ===" -ForegroundColor Yellow }

Step '1/4  Installing dependencies (npm ci)'
if (Test-Path 'node_modules\electron-builder') { Write-Host 'node_modules already present, skipping install.' } else {
  npm ci
  if ($LASTEXITCODE -ne 0) { Write-Host 'npm ci failed, trying npm install...'; npm install; if ($LASTEXITCODE -ne 0) { throw 'npm install failed' } }
}

Step '2/4  FFmpeg (downloaded once into vendor\ffmpeg-win)'
& "$PSScriptRoot\build\fetch-ffmpeg.ps1" -Dest 'vendor\ffmpeg-win'

Step '3/4  sharp Windows binaries'
$sharpSrc = 'node_modules\@img\sharp-win32-x64'
if (!(Test-Path $sharpSrc)) {
  npm pack '@img/sharp-win32-x64@0.34.5'
  New-Item -ItemType Directory -Force $sharpSrc | Out-Null
  tar -xzf 'img-sharp-win32-x64-0.34.5.tgz' -C $sharpSrc --strip-components=1
  Remove-Item 'img-sharp-win32-x64-0.34.5.tgz' -ErrorAction SilentlyContinue
}
if (Test-Path 'vendor\sharp-win32-x64') { Remove-Item -Recurse -Force 'vendor\sharp-win32-x64' }
Copy-Item -Recurse $sharpSrc 'vendor\sharp-win32-x64'

Step '4/4  Building installer, portable exe and zip'
node build\gen-shell-nsh.js
npx electron-builder --win --x64 --publish never
if ($LASTEXITCODE -ne 0) { throw 'electron-builder failed' }

Write-Host "`nDone. Your files are in the dist folder:" -ForegroundColor Green
Get-ChildItem dist -File | Where-Object { $_.Extension -in '.exe', '.zip' } | ForEach-Object { Write-Host "  $($_.Name)" }
