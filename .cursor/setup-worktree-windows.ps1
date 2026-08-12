# Cursor Agents Window / CLI worktree setup for be-monorepo (hono + portless).
# Runs inside the new worktree. ROOT_WORKTREE_PATH = main checkout.
$ErrorActionPreference = 'Stop'

if (-not $env:ROOT_WORKTREE_PATH) {
  throw 'ROOT_WORKTREE_PATH is required'
}

$Root = $env:ROOT_WORKTREE_PATH
# Matches portless.json / `bun hono dev` (`portless run --name hono.be-monorepo`).
$HonoPortlessName = 'hono.be-monorepo'

Write-Host '==> Installing workspace dependencies'
bun install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw "bun install failed ($LASTEXITCODE)" }

Write-Host '==> Syncing hono env files from main checkout'
$HonoDir = 'apps/hono'
New-Item -ItemType Directory -Force -Path $HonoDir | Out-Null

$copied = 0
foreach ($f in @('.env.dev', '.env.prod', '.env.local')) {
  $src = Join-Path (Join-Path $Root $HonoDir) $f
  if (Test-Path $src) {
    Copy-Item $src (Join-Path $HonoDir $f) -Force
    Write-Host "    copied $f"
    $copied++
  }
}

foreach ($envName in @('dev', 'prod')) {
  $target = Join-Path $HonoDir ".env.$envName"
  $example = Join-Path $HonoDir ".env.$envName.example"
  if (-not (Test-Path $target) -and (Test-Path $example)) {
    Copy-Item $example $target -Force
    Write-Host "    seeded .env.$envName from example"
    $copied++
  }
}

if ($copied -eq 0) {
  Write-Host "    warning: no hono env files found in $Root/$HonoDir (copy *.example manually)"
}

Write-Host '==> Checking portless (required for bun hono dev)'
if (-not (Get-Command portless -ErrorAction SilentlyContinue)) {
  Write-Host 'error: portless not on PATH. Install once on the machine:'
  Write-Host '  bun add -g portless'
  Write-Host '  # or: npm install -g portless'
  throw 'portless missing'
}

$honoUrl = $null
try { $honoUrl = (portless get $HonoPortlessName 2>$null | Select-Object -First 1).Trim() } catch {}
if (-not $honoUrl) { $honoUrl = "https://$HonoPortlessName.localhost" }

Write-Host ''
Write-Host 'Worktree setup complete.'
Write-Host "  Hono URL:  $honoUrl"
Write-Host '  Start:     bun hono dev'
Write-Host ''
