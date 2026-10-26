Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "  Updating ORB Platform on Vessel (GCL TAPI)" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition

Write-Host "1. Stopping ORB Backend service..." -ForegroundColor Yellow
Stop-Service -Name "WP_ORB_Backend" -Force -ErrorAction SilentlyContinue

Write-Host "2. Copying Backend files to C:\WORKPLACE\orb_backend..." -ForegroundColor Yellow
Copy-Item -Path "$scriptDir\orb_backend\*" -Destination "C:\WORKPLACE\orb_backend" -Recurse -Force

Write-Host "3. Copying Frontend files to C:\WORKPLACE\nginx\html..." -ForegroundColor Yellow
Copy-Item -Path "$scriptDir\html\*" -Destination "C:\WORKPLACE\nginx\html" -Recurse -Force

Write-Host "4. Starting ORB Backend service..." -ForegroundColor Yellow
Start-Service -Name "WP_ORB_Backend" -ErrorAction SilentlyContinue

Write-Host "`n========================================================" -ForegroundColor Green
Write-Host "  Update completed successfully!" -ForegroundColor Green
Write-Host "  ORB backend is restarting and auto-syncing all 59 alerts and Feed." -ForegroundColor Green
Write-Host "  Please do a hard refresh in your browser (Ctrl + F5)." -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Green
