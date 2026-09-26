. (Join-Path $PSScriptRoot 'installer-records.ps1')
$ErrorActionPreference = 'Stop'
$expected = Join-Path ([IO.Path]::GetTempPath()) 'installer-record-test\口琴谱工作台'
function Record([string]$Hive = 'CurrentUser', [string]$Location = $expected) {
  [pscustomobject]@{ Hive = $Hive; InstallLocation = $Location }
}
function MustFail([object[]]$Records, [string]$Message) {
  try { Assert-InstallerRecords -Records $Records -ExpectedDirectory $expected }
  catch {
    if ($_.Exception.Message -notlike $Message) { throw }
    return
  }
  throw "应当拒绝安装记录：$Message"
}
Assert-InstallerRecords -Records @(Record) -ExpectedDirectory $expected
Assert-InstallerRecords -Records @(Record -Location ($expected.ToUpperInvariant().Replace('\', '/') + '/')) -ExpectedDirectory $expected
MustFail -Records @() -Message '*实际 0 条*'
MustFail -Records @((Record), (Record)) -Message '*实际 2 条*'
MustFail -Records @(Record -Hive 'LocalMachine') -Message '*安装范围不正确*'
MustFail -Records @(Record -Location ($expected + '-other')) -Message '*安装目录不正确*'
MustFail -Records @(Record -Location '') -Message '*安装目录为空*'
Write-Output '安装记录校验通过：规范路径、空记录、重复记录、错误安装范围及错误目录。'

# Reproduce electron-builder's default DisplayName, which includes a version.
$identity = 'test-stable-app-guid'
foreach ($display in @('口琴谱工作台', '口琴谱工作台 0.1.0', '口琴谱工作台 0.2.0-beta.1', '自定义卸载名称')) {
  if (-not (Test-InstallerIdentity -KeyName $identity -DisplayName $display -ProductName '口琴谱工作台' -UninstallKey $identity)) {
    throw "未识别固定注册表标识：$display"
  }
}
if (Test-InstallerIdentity -KeyName 'different-app-guid' -DisplayName '口琴谱工作台' -ProductName '口琴谱工作台' -UninstallKey $identity) {
  throw '错误识别同名的其他应用。'
}
Write-Output '安装标识校验通过：带版本号、预发布版本、自定义名称及同名其他应用。'
