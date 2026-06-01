param(
  [string]$ExcelPath = "C:\Users\Abhinand\Downloads\SNS_CRM.xlsx",
  [string]$Table = "crm_accounts",
  [string]$ChannelsTable = "crm_channels",
  [string]$CompetitorsTable = "crm_competitors",
  [switch]$Reset,
  [switch]$ResetCompetitors,
  [switch]$DryRun
)

$bundled = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
$py = if (Test-Path $bundled) { $bundled } else { "python" }

if (-not $env:SUPABASE_URL) {
  Write-Error "Set SUPABASE_URL before running."
  exit 2
}

if (-not $env:SUPABASE_SERVICE_ROLE_KEY -and -not $env:SUPABASE_ANON_KEY) {
  Write-Error "Set SUPABASE_SERVICE_ROLE_KEY (recommended) or SUPABASE_ANON_KEY before running."
  exit 2
}

$args = @(
  "scripts/import_excel_to_supabase.py",
  "--excel", $ExcelPath,
  "--table", $Table,
  "--channels-table", $ChannelsTable,
  "--competitors-table", $CompetitorsTable
)

if ($DryRun) { $args += "--dry-run" }
if ($Reset) { $args += "--reset" }
if ($ResetCompetitors) { $args += "--reset-competitors" }

& $py @args
exit $LASTEXITCODE

