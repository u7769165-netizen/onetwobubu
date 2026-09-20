# 重启游戏服务器（测试模式：AUTH_RATE_LIMIT=0）。用法：powershell -File tests\_restart_server.ps1 [-RateLimit 0|1]
param([string]$RateLimit = '0')
$conns = Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue
foreach ($c in $conns) {
  try { Stop-Process -Id $c.OwningProcess -Force; Write-Output ("killed pid " + $c.OwningProcess) } catch {}
}
Start-Sleep -Milliseconds 500
$env:AUTH_RATE_LIMIT = $RateLimit
Start-Process -FilePath "node" -ArgumentList "server.js" -WorkingDirectory "d:\onetwobubu" -WindowStyle Hidden
Start-Sleep -Seconds 2
try {
  $code = (Invoke-WebRequest -Uri http://127.0.0.1:8765/ -UseBasicParsing -TimeoutSec 5).StatusCode
  Write-Output ("server up: " + $code + "  AUTH_RATE_LIMIT=" + $RateLimit)
} catch {
  Write-Output "server DOWN"
}
