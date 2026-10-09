param([string]$ElectronRuntime)
$ErrorActionPreference='Stop'
$taskRoot=[System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$buildRoot=[System.IO.Path]::GetFullPath((Join-Path $taskRoot 'build'))
New-Item -ItemType Directory -Force -Path $buildRoot | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $taskRoot 'dist') | Out-Null
$expectedBuildRoot=[System.IO.Path]::GetFullPath((Join-Path $taskRoot 'build'))
if(-not $buildRoot.Equals($expectedBuildRoot,[System.StringComparison]::OrdinalIgnoreCase)){throw 'Unexpected build script directory'}
if((Get-Item -LiteralPath $buildRoot -Force).Attributes -band [System.IO.FileAttributes]::ReparsePoint){throw 'Build root cannot be a reparse point'}
function Assert-BuildPath([string]$candidate){
 $absolute=[System.IO.Path]::GetFullPath($candidate)
 if(-not $absolute.StartsWith($buildRoot+[System.IO.Path]::DirectorySeparatorChar,[System.StringComparison]::OrdinalIgnoreCase)){throw 'Build target is outside the intended build root'}
 if(Test-Path -LiteralPath $absolute){
  $resolved=(Resolve-Path -LiteralPath $absolute).ProviderPath
  if(-not $resolved.StartsWith($buildRoot+[System.IO.Path]::DirectorySeparatorChar,[System.StringComparison]::OrdinalIgnoreCase)){throw 'Resolved build target is outside the intended build root'}
  if((Get-Item -LiteralPath $absolute -Force).Attributes -band [System.IO.FileAttributes]::ReparsePoint){throw 'Build target cannot be a reparse point'}
 }
 return $absolute
}
$source=$taskRoot
$runtime=if($ElectronRuntime){[System.IO.Path]::GetFullPath($ElectronRuntime)}else{Join-Path $taskRoot "node_modules/electron/dist"}
$compiler=Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
foreach($required in @('index.html','package.json','sketch-refinement.js','sketch-refinement-core.js','sketch-refinement-input.js','desktop/Launcher.cs','desktop/printer.cer','desktop/icon.ico','desktop/icon.png')){
 if(-not (Test-Path -LiteralPath (Join-Path $source $required) -PathType Leaf)){throw ('Missing release file: '+$required)}
}
if((Get-Content -LiteralPath (Join-Path $source 'package.json') -Raw | ConvertFrom-Json).version -ne '0.20.0'){throw 'Source package version is not 0.20.0'}
if(-not (Test-Path -LiteralPath (Join-Path $runtime 'electron.exe') -PathType Leaf)){throw 'Electron runtime is missing'}
if(-not (Test-Path -LiteralPath $compiler -PathType Leaf)){throw 'Windows C# compiler is missing'}
$package=Assert-BuildPath (Join-Path $buildRoot 'desktop-package')
if(Test-Path -LiteralPath $package){Remove-Item -LiteralPath $package -Recurse -Force}
New-Item -ItemType Directory -Force -Path $package | Out-Null
Copy-Item -Path (Join-Path $runtime '*') -Destination $package -Recurse -Force
$electron=Assert-BuildPath (Join-Path $package 'electron.exe')
$renamedElectron=Assert-BuildPath (Join-Path $package 'A1PenStudio.App.exe')
if(Test-Path -LiteralPath $renamedElectron){throw 'Unexpected existing application executable'}
Rename-Item -LiteralPath $electron -NewName 'A1PenStudio.App.exe'
$appFolder=Assert-BuildPath (Join-Path $package 'resources/app')
New-Item -ItemType Directory -Force -Path $appFolder | Out-Null
Get-ChildItem -LiteralPath $source -File | Where-Object { $_.Extension -in '.js','.css' -or $_.Name -in 'index.html','GUIDE.html','DESKTOP-GUIDE.html','README.md','package.json' } | Copy-Item -Destination $appFolder
Copy-Item -LiteralPath (Join-Path $source 'assets') -Destination $appFolder -Recurse
foreach($folder in @('bridge','desktop')){
 $destination=Assert-BuildPath (Join-Path $appFolder $folder)
 New-Item -ItemType Directory -Force -Path $destination | Out-Null
 Get-ChildItem -LiteralPath (Join-Path $source $folder) -File | Where-Object { $_.Extension -eq '.cjs' -or $_.Name -in 'printer.cer','icon.ico','icon.png','NOTICE.md' } | Copy-Item -Destination $destination
}
$manifest=@(Get-ChildItem -LiteralPath $appFolder -File -Recurse | ForEach-Object { [System.IO.Path]::GetRelativePath($appFolder,$_.FullName).Replace('\','/') })
$privatePattern='bundled-printer|\.dpapi$|(^|/)(tests?|examples?|experiments?|node_modules|__pycache__|\.git)(/|$)|AUDIT|workspace\.json|printer\.enc|connection-log|\.(test|spec)\.[cm]?js$'
if($manifest | Where-Object { $_ -match $privatePattern }){throw 'Private/test files found in application package'}
@{version='0.20.0';files=$manifest;bundledCredentials=$false;testsIncluded=$false} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $taskRoot 'dist/package-files.json') -Encoding utf8
$payload=Assert-BuildPath (Join-Path $buildRoot 'desktop-payload.zip')
Add-Type -AssemblyName System.IO.Compression.FileSystem
if(Test-Path -LiteralPath $payload){Remove-Item -LiteralPath $payload}
[System.IO.Compression.ZipFile]::CreateFromDirectory($package,$payload,[System.IO.Compression.CompressionLevel]::Optimal,$false)
$hash=(Get-FileHash -Algorithm SHA256 -LiteralPath $payload).Hash.ToLowerInvariant()
$launcher=(Get-Content -LiteralPath (Join-Path $source 'desktop/Launcher.cs') -Raw).Replace('@@BUILD@@',$hash)
$launcherPath=Assert-BuildPath (Join-Path $buildRoot 'Launcher.Build.cs')
[System.IO.File]::WriteAllText($launcherPath,$launcher,[System.Text.UTF8Encoding]::new($false))
$output=Join-Path $taskRoot 'dist/Bambu Pen Studio 0.20.0.exe'
& $compiler /nologo /target:winexe /platform:x64 /optimize+ /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll ('/win32icon:'+(Join-Path $source 'desktop/icon.ico')) ('/resource:'+$payload+',A1PenStudio.Payload') ('/out:'+$output) $launcherPath
if($LASTEXITCODE -ne 0){throw 'EXE compilation failed'}
$runtimeVersion=(Get-Content -LiteralPath (Join-Path $runtime 'version') -Raw).Trim()
$buildInfo=Join-Path $taskRoot 'dist/build-info.json'
[pscustomobject]@{version='0.20.0';electron=$runtimeVersion;exe=$output;size=(Get-Item -LiteralPath $output).Length;sha256=(Get-FileHash -LiteralPath $output).Hash;payloadHash=$hash} | ConvertTo-Json | Set-Content -LiteralPath $buildInfo -Encoding utf8
Get-Content -LiteralPath $buildInfo

