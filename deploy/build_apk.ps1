# 重打 APK：make_www → cap sync → gradlew assembleDebug → 复制产物到 deploy\onetwobubu.apk
$ErrorActionPreference = 'Stop'
Set-Location d:\onetwobubu
node deploy\make_www.js
if ($LASTEXITCODE -ne 0) { throw 'make_www failed' }
node node_modules\@capacitor\cli\bin\capacitor sync android
if ($LASTEXITCODE -ne 0) { throw 'cap sync failed' }
$env:TMP = 'C:\Windows\Temp'
$env:TEMP = 'C:\Windows\Temp'
Set-Location d:\onetwobubu\android
.\gradlew.bat assembleDebug "-Djava.io.tmpdir=C:\Windows\Temp"
if ($LASTEXITCODE -ne 0) { throw 'gradle failed' }
Copy-Item app\build\outputs\apk\debug\app-debug.apk d:\onetwobubu\deploy\onetwobubu.apk -Force
Write-Output ('APK OK: ' + (Get-Item d:\onetwobubu\deploy\onetwobubu.apk).Length + ' bytes')
