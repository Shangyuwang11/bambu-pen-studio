param([Parameter(Mandatory=$true)][string]$Manifest)
$ErrorActionPreference='Stop'
$job=Get-Content -LiteralPath $Manifest -Raw -Encoding UTF8 | ConvertFrom-Json
$target=[IO.Path]::GetFullPath($job.target)
$source=[IO.Path]::GetFullPath($job.source)
$backup=$target+'.previous'
$staged=$target+'.update-'+[Guid]::NewGuid().ToString('N')
$replaced=$false
try {
 if([IO.Path]::GetExtension($target) -ne '.exe' -or $source -eq $target){throw 'Invalid update target'}
 if((Get-Item -LiteralPath $target -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Update target cannot be a reparse point'}
 if((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne $job.sha256){throw 'Update file checksum mismatch'}
 $old=Get-Process -Id $job.pid -ErrorAction SilentlyContinue
 if($old -and -not $old.WaitForExit(120000)){throw 'Application did not close; existing program was retained'}
 Copy-Item -LiteralPath $source -Destination $staged
 if((Get-FileHash -LiteralPath $staged -Algorithm SHA256).Hash -ne $job.sha256){throw 'Staged checksum mismatch'}
 Copy-Item -LiteralPath $target -Destination $backup -Force
 # Both exact file paths share the verified target directory; no recursive moves.
 Move-Item -LiteralPath $staged -Destination $target -Force
 $replaced=$true
 Start-Process -FilePath $target -WorkingDirectory ([IO.Path]::GetDirectoryName($target)) -WindowStyle Hidden
 @{ok=$true;version=$job.version;at=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath $job.result -Encoding UTF8
} catch {
 if($replaced -and (Test-Path -LiteralPath $backup)){Copy-Item -LiteralPath $backup -Destination $target -Force}
 @{ok=$false;error=$_.Exception.Message;at=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath $job.result -Encoding UTF8
 Add-Type -AssemblyName System.Windows.Forms
 $message=if($job.failureMessage){$job.failureMessage}else{'Update failed. Your existing application and data were kept.'}
 [System.Windows.Forms.MessageBox]::Show(($message+[Environment]::NewLine+$_.Exception.Message),'Bambu Pen Studio') | Out-Null
}
