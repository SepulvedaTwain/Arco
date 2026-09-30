# Regenerates the README screenshots in docs/images using headless Microsoft Edge.
#
#   powershell -ExecutionPolicy Bypass -File tools\screenshots.ps1
#
# Starts a throwaway bridge on port 3999 (OSC to an unused port, so nothing reaches REAPER),
# temporarily serves tools/shot.html (which stages each scene), captures 1180x820 @2x, cleans up.

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$edge = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
if (-not (Test-Path $edge)) { $edge = "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe" }
$out = Join-Path $root "docs\images"
$profile = Join-Path $env:TEMP "arco-shot-profile"
$harness = Join-Path $root "web\_shot.html"

New-Item -ItemType Directory -Force $out | Out-Null
Copy-Item (Join-Path $PSScriptRoot "shot.html") $harness -Force
$bridge = Start-Process python -ArgumentList "`"$root\bridge.py`" --port 3999 --reaper-port 9999" -PassThru -WindowStyle Hidden
try {
    Start-Sleep -Seconds 1
    foreach ($scene in "hero", "sso", "serum", "sd3", "menu", "layout", "artic", "graphite") {
        $args = @(
            "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
            "--user-data-dir=$profile", "--force-device-scale-factor=2", "--window-size=1180,820",
            "--virtual-time-budget=6000", "--screenshot=$out\$scene.png",
            "http://127.0.0.1:3999/_shot.html?s=$scene"
        )
        Start-Process -FilePath $edge -ArgumentList $args -Wait -WindowStyle Hidden
        Write-Host "captured $scene.png"
    }
}
finally {
    Stop-Process -Id $bridge.Id -ErrorAction SilentlyContinue
    Remove-Item $harness -ErrorAction SilentlyContinue
}
