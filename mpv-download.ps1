Param(
    [Parameter( Mandatory = $true)]
    $cwd = "TEST"
)

$Path="$cwd\mpv-bootstrapper.zip"

echo $Path

Invoke-WebRequest -UserAgent "Wget" -Uri 'https://newcontinuum.dl.sourceforge.net/project/mpv-player-windows/bootstrapper.zip' -OutFile $Path

7z e "$cwd\mpv-bootstrapper.zip" -y -o"$cwd\mpv\"

cd "$cwd\mpv"

& (".\updater.ps1")