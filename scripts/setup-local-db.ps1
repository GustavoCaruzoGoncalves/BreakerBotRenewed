# Configura PostgreSQL local para o BreakerBot (.env).
# Uso: .\scripts\setup-local-db.ps1
# Será solicitada a senha do superusuário `postgres` (definida na instalação).

$ErrorActionPreference = 'Stop'
$psql = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$sql = Join-Path $root 'scripts\bootstrap-db.sql'

if (-not (Test-Path $psql)) {
  Write-Error "psql não encontrado em $psql. Ajuste a versão do PostgreSQL no script."
}

if (-not $env:POSTGRES_PASSWORD -and -not $env:PGPASSWORD) {
  Write-Host 'Defina POSTGRES_PASSWORD com a senha do usuario postgres (instalacao do PostgreSQL).'
  Write-Host 'Exemplo: $env:POSTGRES_PASSWORD = ''sua_senha''; .\scripts\setup-local-db.ps1'
  exit 1
}

Write-Host 'Rodando bootstrap + schema...'
Push-Location $root
try {
  npx tsx scripts/bootstrap-db.ts
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
