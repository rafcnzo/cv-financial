param([string]$Task = 'assembleDebug')
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskJdk = Join-Path $taskRoot '.tools/jdk'
if (Test-Path -LiteralPath $taskJdk) { $env:JAVA_HOME = (Get-ChildItem -LiteralPath $taskJdk -Directory | Select-Object -First 1).FullName }
$taskSdk = Join-Path $taskRoot '.tools/android-sdk'
if (Test-Path -LiteralPath $taskSdk) { $env:ANDROID_HOME = $taskSdk }
& (Join-Path $taskRoot 'apps/android/gradlew.bat') -p (Join-Path $taskRoot 'apps/android') $Task
if ($LASTEXITCODE -ne 0) { throw 'Android build failed' }
