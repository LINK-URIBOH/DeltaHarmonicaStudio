$ErrorActionPreference = 'Stop'
$compiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { throw 'Windows .NET Framework 4 C# compiler is required.' }
$source = Join-Path $PSScriptRoot 'DeltaHarmonicaInput.cs'
$target = Join-Path $PSScriptRoot 'DeltaHarmonicaInput.exe'
& $compiler /nologo /target:exe /platform:x64 "/out:$target" "$source"
if ($LASTEXITCODE -ne 0) { throw 'Input helper compilation failed.' }
Write-Output $target
