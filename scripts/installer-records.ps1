function Normalize-InstallerPath([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path)) { throw '安装目录为空。' }
  return [IO.Path]::GetFullPath($Path.Replace('/', '\')).TrimEnd('\')
}

function Test-InstallerIdentity([string]$KeyName, [string]$DisplayName, [string]$ProductName, [string]$UninstallKey) {
  if (-not [string]::IsNullOrWhiteSpace($UninstallKey)) { return $KeyName -eq $UninstallKey }
  return $DisplayName -eq $ProductName
}

function Get-InstallerRecords([string]$ProductName, [string]$UninstallKey) {
  $subPath = 'Software\Microsoft\Windows\CurrentVersion\Uninstall'
  $seen = @{}
  foreach ($hive in @([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryHive]::LocalMachine)) {
    foreach ($view in @([Microsoft.Win32.RegistryView]::Registry64, [Microsoft.Win32.RegistryView]::Registry32)) {
      $root = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive, $view)
      try {
        $uninstall = $root.OpenSubKey($subPath)
        if ($null -eq $uninstall) { continue }
        try {
          foreach ($name in $uninstall.GetSubKeyNames()) {
            $entry = $uninstall.OpenSubKey($name)
            if ($null -eq $entry) { continue }
            try {
              $displayName = [string]$entry.GetValue('DisplayName')
              if (-not (Test-InstallerIdentity -KeyName $name -DisplayName $displayName -ProductName $ProductName -UninstallKey $UninstallKey)) { continue }
              $command = [string]$entry.GetValue('UninstallString')
              $match = [regex]::Match($command, '^\s*"([^"]+)"')
              $location = [string]$entry.GetValue('InstallLocation')
              if ([string]::IsNullOrWhiteSpace($location) -and $match.Success) {
                $location = [IO.Path]::GetDirectoryName($match.Groups[1].Value)
              }
              # HKCU keys can be shared by both registry views. Count a shared
              # physical key once, but keep conflicting values for validation.
              $identity = "$hive|$($entry.Name)|$location|$command"
              if ($seen.ContainsKey($identity)) { continue }
              $seen[$identity] = $true
              [pscustomobject]@{
                DisplayName = $displayName
                Hive = $hive.ToString()
                View = $view.ToString()
                PSPath = $entry.Name
                InstallLocation = $location
                UninstallString = $command
              }
            } finally { $entry.Dispose() }
          }
        } finally { $uninstall.Dispose() }
      } finally { $root.Dispose() }
    }
  }
}

function Assert-InstallerRecords([object[]]$Records, [string]$ExpectedDirectory) {
  if ($Records.Count -ne 1) { throw "安装记录数量不正确：预期 1 条，实际 $($Records.Count) 条。" }
  if ($Records[0].Hive -ne 'CurrentUser') { throw "安装范围不正确：预期 CurrentUser，实际 $($Records[0].Hive)。" }
  $actual = Normalize-InstallerPath $Records[0].InstallLocation
  $expected = Normalize-InstallerPath $ExpectedDirectory
  if (-not [string]::Equals($actual, $expected, [StringComparison]::OrdinalIgnoreCase)) {
    throw "安装目录不正确：预期 [$expected]，实际 [$actual]。"
  }
}
