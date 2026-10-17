# OneTwoBuBu 服务器看门狗：每 30 秒查一次 8765 端口，进程死了就拉起（生产限流 AUTH_RATE_LIMIT=1）。
# 由计划任务「OneTwoBuBu-Watchdog」在登录时启动，见 setup_autostart.ps1。
$dir = 'd:\onetwobubu'
$log = Join-Path $dir 'deploy\watchdog.log'
while ($true) {
  $up = Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue
  if (-not $up) {
    $env:AUTH_RATE_LIMIT = '1'
    Start-Process -FilePath 'node' -ArgumentList 'server.js' -WorkingDirectory $dir -WindowStyle Hidden
    Add-Content -Path $log -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') server DOWN -> restarted"
  }
  Start-Sleep -Seconds 30
}
