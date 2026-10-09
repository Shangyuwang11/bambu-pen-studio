param([string]$NodePath='node')
$ErrorActionPreference='Stop'
$testRoot=Join-Path ([IO.Path]::GetTempPath()) ('pen-install-test-'+[Guid]::NewGuid().ToString('N'))
$targetDir=Join-Path $testRoot '中文 空格目录'
New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
$source=Join-Path $testRoot 'new.exe'
$target=Join-Path $targetDir '写字机.exe'
$code='using System;using System.IO;class Program{static void Main(){File.WriteAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"launched.txt"),"new-version");}}'
$cs=Join-Path $testRoot 'stub.cs'
[IO.File]::WriteAllText($cs,$code)
& "$env:WINDIR/Microsoft.NET/Framework64/v4.0.30319/csc.exe" /nologo /target:winexe ("/out:"+$source) $cs
if($LASTEXITCODE -ne 0){throw 'Test stub did not compile'}
[IO.File]::WriteAllText($target,'old-program-fixture')
$waitProcess=Start-Process -FilePath $NodePath -ArgumentList '-e','setTimeout(()=>{},1800)' -WindowStyle Hidden -PassThru
$result=Join-Path $testRoot 'result.json'
$manifest=Join-Path $testRoot 'manifest.json'
$job=@{pid=$waitProcess.Id;target=$target;source=$source;sha256=(Get-FileHash -LiteralPath $source).Hash;version='test';result=$result}
[IO.File]::WriteAllText($manifest,($job | ConvertTo-Json),[Text.UTF8Encoding]::new($false))
$helper=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../desktop/update-helper.ps1'))
& "$env:WINDIR/System32/WindowsPowerShell/v1.0/powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $helper -Manifest $manifest
if(-not ((Get-Content -LiteralPath $result -Raw -Encoding UTF8 | ConvertFrom-Json).ok)){throw 'Update helper failed'}
for($i=0;$i -lt 30 -and -not (Test-Path -LiteralPath (Join-Path $targetDir 'launched.txt'));$i++){Start-Sleep -Milliseconds 100}
if((Get-Content -LiteralPath (Join-Path $targetDir 'launched.txt') -Raw) -ne 'new-version'){throw 'Updated executable was not launched'}
if((Get-Content -LiteralPath ($target+'.previous') -Raw) -ne 'old-program-fixture'){throw 'Previous EXE was not preserved'}
if((Get-FileHash -LiteralPath $target).Hash -ne (Get-FileHash -LiteralPath $source).Hash){throw 'Replacement bytes differ'}
Write-Output ('PASS actual Windows update helper, Unicode/spaces, EXE replacement, previous EXE retained, new app launched: '+$testRoot)
