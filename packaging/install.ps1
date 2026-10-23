# Installs the Roughbook studio's standalone binary on Windows. It carries its own Node.js runtime,
# so the machine needs none:
#
#   irm https://github.com/bharatnow/roughbook-studio/releases/latest/download/install.ps1 | iex
#
# ROUGHBOOK_VERSION installs that version (0.3.16) instead of the latest. ROUGHBOOK_INSTALL_DIR is
# the folder it goes in (%LOCALAPPDATA%\Programs\roughbook by default), which is added to your
# user PATH unless ROUGHBOOK_NO_MODIFY_PATH is set. ROUGHBOOK_DOWNLOAD_URL is a folder of the
# release's files to download from instead of GitHub (a mirror). The archive is checked against
# the release's SHA256SUMS before anything is installed.
& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'
  $Repo = 'bharatnow/roughbook-studio'

  if ($env:ROUGHBOOK_DOWNLOAD_URL) {
    $Base = $env:ROUGHBOOK_DOWNLOAD_URL.TrimEnd('/')
  } elseif ($env:ROUGHBOOK_VERSION) {
    $Base = "https://github.com/$Repo/releases/download/v$($env:ROUGHBOOK_VERSION.TrimStart('v'))"
  } else {
    $Base = "https://github.com/$Repo/releases/latest/download"
  }
  if ($env:ROUGHBOOK_INSTALL_DIR) {
    $Dir = $env:ROUGHBOOK_INSTALL_DIR
  } else {
    $Dir = Join-Path $env:LOCALAPPDATA 'Programs\roughbook'
  }
  # One binary, for x64; Windows on Arm runs it through its x64 emulation.
  $Archive = 'roughbook-windows-x64.zip'

  $Temp = Join-Path ([System.IO.Path]::GetTempPath()) ("roughbook-" + [guid]::NewGuid())
  New-Item -ItemType Directory -Path $Temp | Out-Null
  try {
    Write-Host "Downloading $Archive from $Base"
    Invoke-WebRequest -UseBasicParsing -Uri "$Base/$Archive" -OutFile (Join-Path $Temp $Archive)
    Invoke-WebRequest -UseBasicParsing -Uri "$Base/SHA256SUMS" -OutFile (Join-Path $Temp 'SHA256SUMS')
    $Line = Get-Content (Join-Path $Temp 'SHA256SUMS') | Where-Object { $_ -match " $([regex]::Escape($Archive))$" } | Select-Object -First 1
    if (-not $Line) { throw "SHA256SUMS lists no $Archive." }
    $Expected = ($Line -split ' ')[0].ToLowerInvariant()
    $Actual = (Get-FileHash -Algorithm SHA256 (Join-Path $Temp $Archive)).Hash.ToLowerInvariant()
    if ($Actual -ne $Expected) { throw "$Archive does not match its SHA256SUMS line; nothing was installed." }

    Expand-Archive -Path (Join-Path $Temp $Archive) -DestinationPath (Join-Path $Temp 'out') -Force
    New-Item -ItemType Directory -Force -Path $Dir | Out-Null
    Copy-Item -Force (Join-Path $Temp 'out\roughbook.exe') (Join-Path $Dir 'roughbook.exe')
  } finally {
    Remove-Item -Recurse -Force $Temp -ErrorAction SilentlyContinue
  }

  $Version = & (Join-Path $Dir 'roughbook.exe') --version
  Write-Host "Installed $Version at $(Join-Path $Dir 'roughbook.exe')"

  $UserPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $OnPath = ($UserPath -split ';') -contains $Dir
  if (-not $OnPath -and -not $env:ROUGHBOOK_NO_MODIFY_PATH) {
    [Environment]::SetEnvironmentVariable('Path', (@($UserPath, $Dir) | Where-Object { $_ }) -join ';', 'User')
    $env:Path = "$env:Path;$Dir"
    Write-Host "Added $Dir to your user PATH. Open a new terminal for other windows to see it."
  } elseif (-not $OnPath) {
    Write-Host "$Dir is not on your PATH; add it to run roughbook by name."
  }
  Write-Host 'Next: roughbook login, then roughbook init in your app''s repository.'
}
