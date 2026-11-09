# Downloads a static Windows FFmpeg build into vendor/ffmpeg-win (ffmpeg.exe, ffprobe.exe, LICENSE).
# Tries several mirrors, with retries, so a single host outage does not break the build.
param([string]$Dest = 'vendor/ffmpeg-win')
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force $Dest | Out-Null
if ((Test-Path "$Dest/ffmpeg.exe") -and (Test-Path "$Dest/ffprobe.exe")) { Write-Host 'FFmpeg already present.'; return }

$sources = @(
  'https://github.com/GyanD/codexffmpeg/releases/download/7.1.1/ffmpeg-7.1.1-essentials_build.zip',
  'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
  'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip'
)
$zip = Join-Path ([IO.Path]::GetTempPath()) 'ffmpeg-download.zip'
$tmp = Join-Path ([IO.Path]::GetTempPath()) 'ffmpeg-download'
$ok = $false
foreach ($url in $sources) {
  for ($try = 1; $try -le 3 -and -not $ok; $try++) {
    try {
      Write-Host "Downloading FFmpeg from $url (attempt $try)"
      Remove-Item $zip -Force -ErrorAction SilentlyContinue
      Invoke-WebRequest $url -OutFile $zip -UseBasicParsing -TimeoutSec 600
      if ((Get-Item $zip).Length -lt 10MB) { throw 'download too small' }
      if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
      Expand-Archive $zip -DestinationPath $tmp
      $ff = Get-ChildItem $tmp -Recurse -Filter ffmpeg.exe | Select-Object -First 1
      $fp = Get-ChildItem $tmp -Recurse -Filter ffprobe.exe | Select-Object -First 1
      if (-not $ff -or -not $fp) { throw 'ffmpeg.exe / ffprobe.exe not found in the archive' }
      Copy-Item $ff.FullName, $fp.FullName $Dest -Force
      $lic = Get-ChildItem $tmp -Recurse -Filter 'LICENSE*' | Where-Object { -not $_.PSIsContainer } | Select-Object -First 1
      if ($lic) { Copy-Item $lic.FullName (Join-Path $Dest 'LICENSE') -Force } else { Set-Content (Join-Path $Dest 'LICENSE') 'FFmpeg is licensed under the GNU GPL v3. See https://ffmpeg.org/legal.html' }
      $ok = $true
    } catch {
      Write-Host "  failed: $($_.Exception.Message)"
      Start-Sleep -Seconds (5 * $try)
    }
  }
  if ($ok) { break }
}
if (-not $ok) { throw 'Could not download FFmpeg from any source.' }
& "$Dest/ffmpeg.exe" -version | Select-Object -First 1
