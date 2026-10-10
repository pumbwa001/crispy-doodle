$root = (Resolve-Path $PSScriptRoot).Path
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:8765/")

try {
  $listener.Start()
  $url = "http://127.0.0.1:8765/index.Html"
  Write-Output "Light Speed is running at $url"
  Write-Output "Keep this window open while using the app. Press Ctrl+C to stop."
  Start-Process $url

  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $response = $context.Response

    try {
      $relativePath = [Uri]::UnescapeDataString($context.Request.Url.AbsolutePath.TrimStart("/"))
      if ([string]::IsNullOrWhiteSpace($relativePath)) {
        $relativePath = "index.Html"
      }

      $filePath = [IO.Path]::GetFullPath((Join-Path $root $relativePath))
      $rootPrefix = $root.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
      if (!$filePath.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase) -or
        !(Test-Path -LiteralPath $filePath -PathType Leaf)) {
        $response.StatusCode = 404
        continue
      }

      $response.ContentType = switch ([IO.Path]::GetExtension($filePath).ToLowerInvariant()) {
        ".html" { "text/html; charset=utf-8" }
        ".js" { "text/javascript; charset=utf-8" }
        ".css" { "text/css; charset=utf-8" }
        ".svg" { "image/svg+xml" }
        ".wasm" { "application/wasm" }
        ".gz" { "application/gzip" }
        default { "application/octet-stream" }
      }
      $bytes = [IO.File]::ReadAllBytes($filePath)
      $response.ContentLength64 = $bytes.Length
      $response.OutputStream.Write($bytes, 0, $bytes.Length)
    } catch {
      Write-Warning "Could not serve $($context.Request.Url.AbsolutePath): $($_.Exception.Message)"
      $response.StatusCode = 500
    } finally {
      $response.Close()
    }
  }
} finally {
  $listener.Stop()
  $listener.Close()
}
