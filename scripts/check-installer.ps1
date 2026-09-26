param([switch]$CancellationOnly)
$ErrorActionPreference = 'Stop'
if (-not $CancellationOnly -and $env:GITHUB_ACTIONS -ne 'true') {
  throw '完整安装/卸载检查仅允许在 GitHub Actions 隔离运行器中执行；本地可用 -CancellationOnly。'
}
$workspace = Split-Path -Parent $PSScriptRoot
$project = Get-Content -LiteralPath (Join-Path $workspace 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$product = $project.build.productName
$installer = Join-Path $workspace "$($project.build.directories.output)/$product Setup $($project.version).exe"
if (-not (Test-Path -LiteralPath $installer)) { throw '安装包不存在，请先构建。' }

Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class InstallerWindowCheck {
  public delegate bool Callback(IntPtr hwnd, IntPtr param);
  [DllImport("user32.dll")] static extern bool EnumWindows(Callback cb, IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr hwnd, Callback cb, IntPtr p);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr hwnd, int id);
  [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] static extern IntPtr GetParent(IntPtr hwnd);
  [DllImport("user32.dll")] static extern int GetDlgCtrlID(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hwnd, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd, uint msg, IntPtr w, IntPtr l);
  public static string ClassName(IntPtr hwnd) { var s = new StringBuilder(256); GetClassName(hwnd,s,256); return s.ToString(); }
  public static IntPtr[] Windows(int[] pids) {
    var found = new List<IntPtr>();
    EnumWindows((h,p)=>{uint id;GetWindowThreadProcessId(h,out id); if(Array.IndexOf(pids,(int)id)>=0) found.Add(h);return true;},IntPtr.Zero);
    return found.ToArray();
  }
  public static IntPtr Edit(IntPtr hwnd) {
    IntPtr found=IntPtr.Zero;
    EnumChildWindows(hwnd,(h,p)=>{if(ClassName(h)=="Edit" && IsWindowVisible(h) && IsWindowEnabled(h)) {found=h;return false;}return true;},IntPtr.Zero);
    return found;
  }
  public static string Describe(IntPtr hwnd) {
    var lines = new List<string>();
    Callback describe = (h,p)=>{
      var text = new StringBuilder(512); GetWindowText(h,text,512);
      lines.Add(String.Format("id={0} class={1} visible={2} enabled={3} text={4}", GetDlgCtrlID(h), ClassName(h), IsWindowVisible(h), IsWindowEnabled(h), text));
      return true;
    };
    describe(hwnd,IntPtr.Zero); EnumChildWindows(hwnd,describe,IntPtr.Zero);
    return String.Join(Environment.NewLine,lines);
  }
  public static void Click(IntPtr button) {
    if(button==IntPtr.Zero || !IsWindowEnabled(button)) throw new Exception("Installer button unavailable");
    // Notify the owning dialog directly: BM_CLICK can fail on inactive CI desktops.
    // BN_CLICKED is zero, so wParam contains only the control ID.
    if(!PostMessage(GetParent(button),0x111,new IntPtr(GetDlgCtrlID(button)),button))
      throw new Exception("Installer button notification failed");
  }
}
'@

function OwnedIds([int]$rootId) {
  $ids = [System.Collections.Generic.List[int]]::new()
  $ids.Add($rootId)
  $processes = @(Get-CimInstance Win32_Process)
  for ($index = 0; $index -lt $ids.Count; $index++) {
    foreach ($entry in $processes) { if ($entry.ParentProcessId -eq $ids[$index] -and -not $ids.Contains([int]$entry.ProcessId)) { $ids.Add([int]$entry.ProcessId) } }
  }
  return $ids.ToArray()
}
. (Join-Path $PSScriptRoot 'installer-records.ps1')
$installerMetadata = & node (Join-Path $PSScriptRoot 'installer-metadata.cjs')
if ($LASTEXITCODE -ne 0) { throw '无法读取安装包注册表标识。' }
$uninstallKey = ($installerMetadata | ConvertFrom-Json).uninstallKey
if ([string]::IsNullOrWhiteSpace($uninstallKey)) { throw '安装包注册表标识为空。' }
function InstallationRecords { Get-InstallerRecords -ProductName $product -UninstallKey $uninstallKey }
function FileFingerprint([string]$file) {
  if (Test-Path -LiteralPath $file -PathType Leaf) { return (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash }
  return 'missing'
}
function WaitExit($process, [int]$milliseconds = 60000) {
  if (-not $process.WaitForExit($milliseconds)) { throw "进程 $($process.Id) 未按时退出" }
  $process.Refresh()
}

$beforeRecords = @(InstallationRecords) | ConvertTo-Json -Compress
if (-not $CancellationOnly -and @(InstallationRecords).Count -gt 0) { throw '隔离运行器已有安装，拒绝覆盖。' }
$testBase = if ($CancellationOnly) { Join-Path $workspace 'release' } else { $env:RUNNER_TEMP }
$testRoot = [System.IO.Path]::GetFullPath((Join-Path $testBase ('installer-check-' + [guid]::NewGuid().ToString('N'))))
$installDir = Join-Path $testRoot $product
New-Item -ItemType Directory -Path $testRoot | Out-Null
$links = @((Join-Path ([Environment]::GetFolderPath('Desktop')) "$product.lnk"), (Join-Path ([Environment]::GetFolderPath('Programs')) "$product.lnk"))
$beforeLinks = @($links | ForEach-Object { FileFingerprint $_ })
$defaultLibrary = Join-Path ([Environment]::GetFolderPath('ApplicationData')) "$product/library.json"
$beforeLibrary = FileFingerprint $defaultLibrary
$programPaths = @((Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) "Programs/$product/$product.exe")) + @(InstallationRecords | ForEach-Object { Join-Path $_.InstallLocation "$product.exe" })
$beforePrograms = @($programPaths | ForEach-Object { FileFingerprint $_ })
$started = [System.Collections.Generic.List[System.Diagnostics.Process]]::new()
$previousUserData = $env:STUDIO_USER_DATA_DIR
try {
  $cancelProcess = Start-Process -FilePath $installer -ArgumentList '/currentuser' -WindowStyle Hidden -PassThru
  $started.Add($cancelProcess)
  $dialog = [IntPtr]::Zero
  $deadline = [DateTime]::UtcNow.AddSeconds(20)
  while ([DateTime]::UtcNow -lt $deadline -and $dialog -eq [IntPtr]::Zero) {
    foreach ($window in [InstallerWindowCheck]::Windows(@(OwnedIds $cancelProcess.Id))) {
      if ([InstallerWindowCheck]::ClassName($window) -eq '#32770' -and [InstallerWindowCheck]::GetDlgItem($window,2) -ne [IntPtr]::Zero) { $dialog = $window; break }
    }
    if ($dialog -eq [IntPtr]::Zero) { Start-Sleep -Milliseconds 150 }
  }
  if ($dialog -eq [IntPtr]::Zero) { throw '未出现安装向导窗口。' }
  # Only move off the welcome page. Never click the install button.
  [InstallerWindowCheck]::Click([InstallerWindowCheck]::GetDlgItem($dialog,1))
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  while ([InstallerWindowCheck]::Edit($dialog) -eq [IntPtr]::Zero -and [DateTime]::UtcNow -lt $deadline) {
    $cancelProcess.Refresh()
    if ($cancelProcess.HasExited) { throw "安装向导提前退出：$($cancelProcess.ExitCode)" }
    Start-Sleep -Milliseconds 150
  }
  if ([InstallerWindowCheck]::Edit($dialog) -eq [IntPtr]::Zero) {
    Write-Output ([InstallerWindowCheck]::Describe($dialog))
    throw '等待 30 秒后仍未出现可编辑的安装目录。'
  }
  [InstallerWindowCheck]::Click([InstallerWindowCheck]::GetDlgItem($dialog,2))
  $deadline = [DateTime]::UtcNow.AddSeconds(20)
  do {
    foreach ($window in [InstallerWindowCheck]::Windows(@(OwnedIds $cancelProcess.Id))) {
      $yes = [InstallerWindowCheck]::GetDlgItem($window,6)
      if ($yes -ne [IntPtr]::Zero -and [InstallerWindowCheck]::IsWindowEnabled($yes)) { [InstallerWindowCheck]::Click($yes) }
    }
    Start-Sleep -Milliseconds 150
    $cancelProcess.Refresh()
  } while (-not $cancelProcess.HasExited -and [DateTime]::UtcNow -lt $deadline)
  WaitExit $cancelProcess
  if ((@(InstallationRecords) | ConvertTo-Json -Compress) -ne $beforeRecords) { throw '取消后安装记录发生变化。' }
  for ($index = 0; $index -lt $links.Count; $index++) { if ((FileFingerprint $links[$index]) -ne $beforeLinks[$index]) { throw '取消后快捷方式发生变化。' } }
  if ((FileFingerprint $defaultLibrary) -ne $beforeLibrary) { throw '取消后曲库数据发生变化。' }
  for ($index = 0; $index -lt $programPaths.Count; $index++) { if ((FileFingerprint $programPaths[$index]) -ne $beforePrograms[$index]) { throw '取消后程序文件发生变化。' } }
  Write-Output '向导检查通过：可选择目录，安装开始前取消未改变卸载记录、快捷方式或曲库。'
  if ($CancellationOnly) { return }

  $installProcess = Start-Process -FilePath $installer -ArgumentList @('/S','/currentuser',"/D=$installDir") -WindowStyle Hidden -PassThru
  $started.Add($installProcess)
  WaitExit $installProcess
  if ($installProcess.ExitCode -ne 0) { throw "安装失败：$($installProcess.ExitCode)" }
  $appExe = Join-Path $installDir "$product.exe"
  $helperExe = Join-Path $installDir 'resources/helper/DeltaHarmonicaInput.exe'
  if (-not (Test-Path -LiteralPath $appExe) -or -not (Test-Path -LiteralPath $helperExe)) { throw '自定义目录缺少程序或辅助程序。' }
  if ((FileFingerprint $helperExe) -ne (FileFingerprint (Join-Path $workspace 'helper/DeltaHarmonicaInput.exe'))) { throw '安装的辅助程序不匹配。' }
  $records = @(InstallationRecords)
  Write-Output "预期卸载注册表标识：$uninstallKey"
  Write-Output "预期安装目录：$installDir"
  Write-Output "安装记录：$(ConvertTo-Json -InputObject $records -Depth 3 -Compress)"
  Assert-InstallerRecords -Records $records -ExpectedDirectory $installDir

  if ($beforeLibrary -ne 'missing') { throw '隔离运行器已有曲库，拒绝覆盖。' }
  # Use the installer's normal app-data folder to actually test uninstall retention.
  $env:STUDIO_USER_DATA_DIR = Split-Path -Parent $defaultLibrary
  New-Item -ItemType Directory -Path $env:STUDIO_USER_DATA_DIR -Force | Out-Null
  $fixture = '{"version":1,"scores":[],"hotkeys":{},"settings":{"rootMidi":60,"stopShortcut":"Ctrl+Alt+Shift+F12","outputMode":"sendinput"}}'
  $fixtureFile = Join-Path $env:STUDIO_USER_DATA_DIR 'library.json'
  [System.IO.File]::WriteAllText($fixtureFile, $fixture, [System.Text.UTF8Encoding]::new($false))
  $appProcess = Start-Process -FilePath $appExe -WindowStyle Hidden -PassThru
  $started.Add($appProcess)
  Start-Sleep -Seconds 4
  $appProcess.Refresh()
  $appWindows = @([InstallerWindowCheck]::Windows(@(OwnedIds $appProcess.Id)) | Where-Object { [InstallerWindowCheck]::ClassName($_) -eq 'Chrome_WidgetWin_1' })
  if ($appProcess.HasExited -or $appWindows.Count -eq 0) { throw '安装后的程序无法启动窗口。' }
  [InstallerWindowCheck]::PostMessage($appWindows[0],0x10,[IntPtr]::Zero,[IntPtr]::Zero) | Out-Null
  WaitExit $appProcess 10000
  $uninstaller = Join-Path $installDir "Uninstall $product.exe"
  $uninstallProcess = Start-Process -FilePath $uninstaller -ArgumentList @('/S','/currentuser') -WindowStyle Hidden -PassThru
  $started.Add($uninstallProcess)
  WaitExit $uninstallProcess
  $deadline = [DateTime]::UtcNow.AddSeconds(15)
  while ((Test-Path -LiteralPath $appExe) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 250 }
  if ((Test-Path -LiteralPath $appExe) -or @(InstallationRecords).Count -gt 0) { throw '卸载后仍有程序或卸载记录。' }
  for ($index = 0; $index -lt $links.Count; $index++) { if ((FileFingerprint $links[$index]) -ne $beforeLinks[$index]) { throw '卸载后仍有新增快捷方式。' } }
  if (-not (Test-Path -LiteralPath $fixtureFile) -or [System.IO.File]::ReadAllText($fixtureFile) -ne $fixture) { throw '用户数据未保留。' }
  Write-Output '隔离安装检查通过：自定义目录、当前用户安装、程序启动、辅助程序一致、卸载及用户数据保留。'
} finally {
  $env:STUDIO_USER_DATA_DIR = $previousUserData
  foreach ($process in $started) {
    $process.Refresh()
    if (-not $process.HasExited) { foreach ($owned in @(OwnedIds $process.Id)) { Stop-Process -Id $owned -Force -ErrorAction SilentlyContinue } }
  }
  # Keep test files for diagnostics; never recursively remove a computed path.
}
