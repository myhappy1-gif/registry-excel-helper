# 연습용 가짜 등기 그림(PNG)을 만든다. (Windows 기본 기능만 사용, 새 도구 설치 없음)
# 글자는 sample-data/fake-sample.json 의 registryLines 에서 가져온다. (한글이 깨지지 않도록 이 파일에는 한글을 쓰지 않았다.)
# 실행: powershell -ExecutionPolicy Bypass -File scripts/make-register-images.ps1
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$json = Get-Content -Raw -Encoding UTF8 (Join-Path $root 'sample-data/fake-sample.json') | ConvertFrom-Json
$outDir = Join-Path $root 'sample-data/images'
New-Item -ItemType Directory -Force $outDir | Out-Null

$fontName = 'Malgun Gothic'
$count = 0
foreach ($prop in $json.registryLines.PSObject.Properties) {
  $lines = @($prop.Value)
  $lineHeight = 44
  $height = 40 + ($lines.Count * $lineHeight) + 20
  $bmp = New-Object System.Drawing.Bitmap 1300, $height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::White)
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $font = New-Object System.Drawing.Font($fontName, 24, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  $y = 30
  foreach ($line in $lines) {
    $g.DrawString([string]$line, $font, [System.Drawing.Brushes]::Black, 30, $y)
    $y += $lineHeight
  }
  $path = Join-Path $outDir $prop.Name
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose(); $font.Dispose()
  $count++
}
Write-Output "images: $count"
