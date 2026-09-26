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
