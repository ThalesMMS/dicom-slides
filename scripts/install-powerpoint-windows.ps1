[CmdletBinding()]
param(
    [ValidateSet("Web", "DesktopGuide")]
    [string]$Mode = "Web",

    [string]$ManifestSource = "https://raw.githubusercontent.com/ThalesMMS/dicom-slides/main/powerpoint/manifest.xml",

    [string]$DownloadDirectory = (Join-Path ([Environment]::GetFolderPath("UserProfile")) "Downloads"),

    [switch]$NoOpen,

    [switch]$Uninstall
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$AddinId = "3c8d5463-e606-4e35-86de-515114b31089"
$ExpectedSourceUrl = "https://thalesmms.github.io/dicom-slides/powerpoint/content.html"
$ExpectedManifestSha256 = "376053c2827a2b08ebfcd5eba762eb884f49e3793311349ed7076b9ccc93c9d3"
$ManifestFileName = "dicom-slides-manifest.xml"
$PowerPointWebUrl = "https://powerpoint.cloud.microsoft/"
$WindowsDesktopGuideUrl = "https://learn.microsoft.com/en-us/office/dev/add-ins/testing/create-a-network-shared-folder-catalog-for-task-pane-and-content-add-ins"
$RunningOnWindows = [Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT

function Fail-Installer {
    param([string]$Message)
    throw "DICOM Slides installer: $Message"
}

function Get-ValidatedManifest {
    param([string]$Path)

    try {
        $ManifestHash = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($ManifestHash -ne $ExpectedManifestSha256) {
            Fail-Installer "the downloaded file is not a valid DICOM Slides manifest."
        }
        [xml]$ManifestXml = Get-Content -LiteralPath $Path -Raw
        $Namespace = New-Object System.Xml.XmlNamespaceManager($ManifestXml.NameTable)
        $Namespace.AddNamespace("o", "http://schemas.microsoft.com/office/appforoffice/1.1")
        $IdNode = $ManifestXml.SelectSingleNode("/o:OfficeApp/o:Id", $Namespace)
        $SourceNode = $ManifestXml.SelectSingleNode("/o:OfficeApp/o:DefaultSettings/o:SourceLocation", $Namespace)
        $HostNode = $ManifestXml.SelectSingleNode("/o:OfficeApp/o:Hosts/o:Host", $Namespace)
        if ($null -eq $IdNode -or $null -eq $SourceNode -or $null -eq $HostNode) {
            Fail-Installer "the downloaded file is not a valid DICOM Slides manifest."
        }
        if ($IdNode.InnerText.Trim() -ne $AddinId `
                -or $SourceNode.GetAttribute("DefaultValue") -ne $ExpectedSourceUrl `
                -or $HostNode.GetAttribute("Name") -ne "Presentation") {
            Fail-Installer "the downloaded file is not a valid DICOM Slides manifest."
        }
        return $ManifestXml
    }
    catch {
        if ($_.Exception.Message -like "DICOM Slides installer:*") {
            throw
        }
        Fail-Installer "the downloaded file is not a valid DICOM Slides manifest."
    }
}

function Test-ReparsePoint {
    param([System.IO.FileSystemInfo]$Item)
    return [bool]($Item.Attributes -band [System.IO.FileAttributes]::ReparsePoint)
}

if ([string]::IsNullOrWhiteSpace($DownloadDirectory)) {
    Fail-Installer "the download directory is empty."
}
$DownloadDirectory = [System.IO.Path]::GetFullPath($DownloadDirectory)
if ($DownloadDirectory -eq [System.IO.Path]::GetPathRoot($DownloadDirectory)) {
    Fail-Installer "unsafe download directory: $DownloadDirectory"
}

if (Test-Path -LiteralPath $DownloadDirectory) {
    $DownloadItem = Get-Item -LiteralPath $DownloadDirectory
    if (-not $DownloadItem.PSIsContainer -or (Test-ReparsePoint $DownloadItem)) {
        Fail-Installer "the download path must be a regular directory: $DownloadDirectory"
    }
}
else {
    New-Item -ItemType Directory -Path $DownloadDirectory | Out-Null
}

$TargetManifest = Join-Path $DownloadDirectory $ManifestFileName

if ($Uninstall) {
    if (-not (Test-Path -LiteralPath $TargetManifest)) {
        Write-Output "No prepared DICOM Slides manifest was found in $DownloadDirectory."
        exit 0
    }
    $TargetItem = Get-Item -LiteralPath $TargetManifest
    if ($TargetItem.PSIsContainer -or (Test-ReparsePoint $TargetItem)) {
        Fail-Installer "refusing to remove an unexpected manifest path: $TargetManifest"
    }
    $null = Get-ValidatedManifest -Path $TargetManifest
    Remove-Item -LiteralPath $TargetManifest -Force
    Write-Output "Removed the prepared DICOM Slides manifest. Other downloads were preserved."
    Write-Output "Remove the add-in from PowerPoint separately if it was already uploaded."
    exit 0
}

$TemporaryDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("dicom-slides-install-" + [Guid]::NewGuid().ToString("N"))
$TemporaryManifest = Join-Path $TemporaryDirectory "manifest.xml"
$StagedManifest = Join-Path $DownloadDirectory ("." + $ManifestFileName + "." + [Guid]::NewGuid().ToString("N") + ".tmp")

try {
    New-Item -ItemType Directory -Path $TemporaryDirectory | Out-Null
    if (Test-Path -LiteralPath $ManifestSource -PathType Leaf) {
        $SourceItem = Get-Item -LiteralPath $ManifestSource
        if (Test-ReparsePoint $SourceItem) {
            Fail-Installer "manifest source must be an HTTPS URL or a regular local file."
        }
        Copy-Item -LiteralPath $ManifestSource -Destination $TemporaryManifest
    }
    else {
        $ManifestUri = $null
        if (-not [Uri]::TryCreate($ManifestSource, [UriKind]::Absolute, [ref]$ManifestUri) `
                -or $ManifestUri.Scheme -ne "https") {
            Fail-Installer "manifest source must be an HTTPS URL or a regular local file."
        }
        Invoke-WebRequest -UseBasicParsing -Uri $ManifestUri -OutFile $TemporaryManifest
    }

    $null = Get-ValidatedManifest -Path $TemporaryManifest
    $WasPrepared = Test-Path -LiteralPath $TargetManifest
    if ($WasPrepared) {
        $TargetItem = Get-Item -LiteralPath $TargetManifest
        if ($TargetItem.PSIsContainer -or (Test-ReparsePoint $TargetItem)) {
            Fail-Installer "refusing to replace an unexpected manifest path: $TargetManifest"
        }
    }

    Copy-Item -LiteralPath $TemporaryManifest -Destination $StagedManifest
    Move-Item -LiteralPath $StagedManifest -Destination $TargetManifest -Force

    if ($WasPrepared) {
        Write-Output "Updated DICOM Slides manifest at $TargetManifest. Other downloads were preserved."
    }
    else {
        Write-Output "Prepared DICOM Slides manifest at $TargetManifest. Other downloads were preserved."
    }
}
finally {
    if (Test-Path -LiteralPath $StagedManifest -PathType Leaf) {
        Remove-Item -LiteralPath $StagedManifest -Force
    }
    if (Test-Path -LiteralPath $TemporaryManifest -PathType Leaf) {
        Remove-Item -LiteralPath $TemporaryManifest -Force
    }
    if (Test-Path -LiteralPath $TemporaryDirectory -PathType Container) {
        Remove-Item -LiteralPath $TemporaryDirectory -Force
    }
}

if ($Mode -eq "Web") {
    Write-Output "Finish in PowerPoint for the web: Home > Add-ins > More Settings > Upload My Add-in."
    Write-Output "Choose $TargetManifest when PowerPoint asks for the manifest."
    if (-not $NoOpen -and $RunningOnWindows) {
        Start-Process $PowerPointWebUrl
    }
}
else {
    Write-Output "Windows desktop sideloading requires a trusted add-in catalog and may require administrator approval."
    Write-Output "The manifest is ready at $TargetManifest. Follow the Microsoft desktop guide that will open next."
    if (-not $NoOpen -and $RunningOnWindows) {
        Start-Process $WindowsDesktopGuideUrl
    }
}
