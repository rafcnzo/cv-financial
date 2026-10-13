$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskTools = Join-Path $taskRoot '.tools'
New-Item -ItemType Directory -Force -Path $taskTools | Out-Null
function Download-Archive($Url, $Archive, $Destination) {
    if (-not (Test-Path -LiteralPath $Destination)) {
        Write-Output "Downloading $Archive"
        $taskZip = Join-Path $taskTools $Archive
        & curl.exe --fail --location --silent --show-error --continue-at - --retry 5 --retry-all-errors --output $taskZip $Url
        if ($LASTEXITCODE -ne 0) { throw "Download failed: $Archive" }
        New-Item -ItemType Directory -Force -Path $Destination | Out-Null
        Expand-Archive -LiteralPath $taskZip -DestinationPath $Destination -Force
    }
}
Download-Archive 'https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse' 'jdk17.zip' (Join-Path $taskTools 'jdk')
$taskJava = (Get-ChildItem -LiteralPath (Join-Path $taskTools 'jdk') -Directory | Select-Object -First 1).FullName
$env:JAVA_HOME = $taskJava
$taskSdk = Join-Path $taskTools 'android-sdk'
Download-Archive 'https://dl.google.com/android/repository/commandlinetools-win-13114758_latest.zip' 'android-tools.zip' (Join-Path $taskSdk 'cmdline-tools/latest-temp')
$taskLatest = Join-Path $taskSdk 'cmdline-tools/latest'
if (-not (Test-Path -LiteralPath $taskLatest)) { Move-Item -LiteralPath (Join-Path $taskSdk 'cmdline-tools/latest-temp/cmdline-tools') -Destination $taskLatest }
$env:ANDROID_HOME = $taskSdk
1..100 | ForEach-Object { 'y' } | & (Join-Path $taskLatest 'bin/sdkmanager.bat') --licenses | Out-Null
& (Join-Path $taskLatest 'bin/sdkmanager.bat') 'platform-tools' 'platforms;android-35' 'build-tools;35.0.0'
if ($LASTEXITCODE -ne 0) { throw 'Android SDK installation failed' }
Download-Archive 'https://services.gradle.org/distributions/gradle-8.11.1-bin.zip' 'gradle.zip' (Join-Path $taskTools 'gradle')
$taskGradle = Join-Path $taskTools 'gradle/gradle-8.11.1/bin/gradle.bat'
& $taskGradle -p (Join-Path $taskRoot 'apps/android') wrapper --gradle-version 8.11.1
if ($LASTEXITCODE -ne 0) { throw 'Gradle wrapper creation failed' }
Write-Output 'Android toolchain ready in .tools. Build with scripts/build-android.ps1.'
