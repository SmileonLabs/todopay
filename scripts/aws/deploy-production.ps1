[CmdletBinding()]
param(
  [string]$Profile = 'AdministratorAccess-746491202681',
  [string]$Region = 'ap-northeast-2',
  [string]$ExpectedAccountId = '746491202681',
  [string]$EnvironmentName = 'todopay-prod',
  [string]$ComputeStack = 'todopay-prod-compute',
  [string]$ImageTag = '',
  [switch]$Execute,
  [switch]$ConfirmProduction
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $repoRoot

function Invoke-Native {
  param([Parameter(Mandatory = $true)][string]$Command, [Parameter(Mandatory = $true)][string[]]$Arguments)
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Command failed with exit code $LASTEXITCODE." }
}

function Invoke-AwsJson {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)
  $raw = & aws @Arguments --profile $Profile --region $Region --output json
  if ($LASTEXITCODE -ne 0) { throw "AWS command failed: aws $($Arguments -join ' ')" }
  return (($raw -join "`n") | ConvertFrom-Json)
}

function Get-ImageRepository([string]$Image) {
  if ($Image -match '^(.+?)(?::[^/:]+|@sha256:.+)$') { return $Matches[1] }
  throw "Cannot determine ECR repository from image: $Image"
}

function Invoke-DockerLogin {
  param(
    [Parameter(Mandatory = $true)][string]$Registry,
    [Parameter(Mandatory = $true)][string]$ProfileName,
    [Parameter(Mandatory = $true)][string]$AwsRegion
  )

  if ($Registry -notmatch '^[a-z0-9.-]+$' -or
      $ProfileName -notmatch '^[A-Za-z0-9+=,.@_-]+$' -or
      $AwsRegion -notmatch '^[a-z0-9-]+$') {
    throw 'Unsafe ECR login argument.'
  }

  if ($env:OS -eq 'Windows_NT') {
    # Windows PowerShell 5.1 re-encodes native pipelines. cmd.exe preserves
    # the ASCII ECR token byte-for-byte and never exposes it as an argument.
    $command = "aws ecr get-login-password --profile $ProfileName --region $AwsRegion | docker login --username AWS --password-stdin $Registry"
    Invoke-Native cmd.exe @('/d', '/s', '/c', $command)
    return
  }

  # Copy the AWS process' raw stdout bytes directly into Docker's stdin on
  # other hosts as well, avoiding shell-specific pipeline transformations.
  $awsStartInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $awsStartInfo.FileName = 'aws'
  $awsStartInfo.Arguments = "ecr get-login-password --profile `"$ProfileName`" --region `"$AwsRegion`""
  $awsStartInfo.UseShellExecute = $false
  $awsStartInfo.RedirectStandardOutput = $true
  $awsStartInfo.RedirectStandardError = $true

  $dockerStartInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $dockerStartInfo.FileName = 'docker'
  $dockerStartInfo.Arguments = "login --username AWS --password-stdin `"$Registry`""
  $dockerStartInfo.UseShellExecute = $false
  $dockerStartInfo.RedirectStandardInput = $true
  $dockerStartInfo.RedirectStandardOutput = $true
  $dockerStartInfo.RedirectStandardError = $true

  $awsProcess = [System.Diagnostics.Process]::Start($awsStartInfo)
  $dockerProcess = [System.Diagnostics.Process]::Start($dockerStartInfo)
  $awsProcess.StandardOutput.BaseStream.CopyTo($dockerProcess.StandardInput.BaseStream)
  $dockerProcess.StandardInput.Close()
  $awsError = $awsProcess.StandardError.ReadToEnd()
  $dockerOutput = $dockerProcess.StandardOutput.ReadToEnd()
  $dockerError = $dockerProcess.StandardError.ReadToEnd()
  $awsProcess.WaitForExit()
  $dockerProcess.WaitForExit()

  if ($awsProcess.ExitCode -ne 0) {
    if ($awsError) { Write-Error $awsError.TrimEnd() }
    throw 'Could not obtain ECR login password.'
  }
  if ($dockerOutput) { Write-Host $dockerOutput.TrimEnd() }
  if ($dockerProcess.ExitCode -ne 0) {
    if ($dockerError) { Write-Error $dockerError.TrimEnd() }
    throw 'Docker ECR login failed.'
  }
}

function Deploy-ComputeStack {
  param(
    [Parameter(Mandatory = $true)][object[]]$CurrentParameters,
    [Parameter(Mandatory = $true)][string]$ApiImage,
    [Parameter(Mandatory = $true)][string]$MigrationImage,
    [Parameter(Mandatory = $true)][string]$ChangeSetName,
    [switch]$PreviewOnly
  )
  $overrides = foreach ($parameter in $CurrentParameters) {
    $value = switch ($parameter.ParameterKey) {
      'ApiImage' { $ApiImage }
      'MigrationImage' { $MigrationImage }
      default { [string]$parameter.ParameterValue }
    }
    "$($parameter.ParameterKey)=$value"
  }
  $args = @(
    'cloudformation', 'deploy',
    '--template-file', 'infra/aws/compute.yaml',
    '--stack-name', $ComputeStack,
    '--capabilities', 'CAPABILITY_IAM',
    '--parameter-overrides'
  ) + $overrides + @(
    '--change-set-name', $ChangeSetName,
    '--no-fail-on-empty-changeset',
    '--profile', $Profile,
    '--region', $Region
  )
  if ($PreviewOnly) { $args += '--no-execute-changeset' }
  Invoke-Native aws $args
}

if ($Execute -and -not $ConfirmProduction) {
  throw 'Production execution requires both -Execute and -ConfirmProduction.'
}

$branch = (git branch --show-current).Trim()
if ($branch -ne 'main') { throw "Production deployment requires main; current branch is $branch." }
if (-not [string]::IsNullOrWhiteSpace((git status --porcelain))) {
  throw 'Production deployment requires a clean Git worktree.'
}

$identity = Invoke-AwsJson @('sts', 'get-caller-identity')
if ($identity.Account -ne $ExpectedAccountId) {
  throw "Refusing to deploy to account $($identity.Account); expected $ExpectedAccountId."
}

if ([string]::IsNullOrWhiteSpace($ImageTag)) {
  $ImageTag = (git rev-parse --short=12 HEAD).Trim()
}
if ($ImageTag -notmatch '^[A-Za-z0-9_.-]{1,128}$') { throw 'Invalid Docker image tag.' }

Write-Host 'Running required validation...'
Invoke-Native pnpm.cmd @('run', 'typecheck')
Invoke-Native pnpm.cmd @('--filter', '@workspace/api-server', 'test')

$stack = Invoke-AwsJson @('cloudformation', 'describe-stacks', '--stack-name', $ComputeStack)
$currentParameters = @($stack.Stacks[0].Parameters)
$currentApiImage = [string](($currentParameters | Where-Object ParameterKey -eq 'ApiImage').ParameterValue)
$currentMigrationImage = [string](($currentParameters | Where-Object ParameterKey -eq 'MigrationImage').ParameterValue)
$apiRepository = Get-ImageRepository $currentApiImage
$migrationRepository = Get-ImageRepository $currentMigrationImage
$apiImage = "${apiRepository}:$ImageTag"
$migrationImage = "${migrationRepository}:$ImageTag"
$registry = ([uri]"https://$apiRepository").Host

Write-Host "Building $apiImage"
Invoke-Native docker @('build', '--target', 'runtime', '--tag', $apiImage, '.')
Write-Host "Building $migrationImage"
Invoke-Native docker @('build', '--target', 'migration', '--tag', $migrationImage, '.')

$loginAttempts = 3
for ($attempt = 1; $attempt -le $loginAttempts; $attempt++) {
  try {
    Invoke-DockerLogin -Registry $registry -ProfileName $Profile -AwsRegion $Region
    break
  } catch {
    if ($attempt -eq $loginAttempts) { throw }
    Write-Warning "ECR login attempt $attempt failed; retrying in 5 seconds."
    Start-Sleep -Seconds 5
  }
}
Invoke-Native docker @('push', $apiImage)
Invoke-Native docker @('push', $migrationImage)

$suffix = (Get-Date -Format 'yyyyMMdd-HHmmss')
if (-not $Execute) {
  $changeSet = "todopay-preview-$suffix"
  Deploy-ComputeStack -CurrentParameters $currentParameters -ApiImage $apiImage -MigrationImage $migrationImage -ChangeSetName $changeSet -PreviewOnly
  Write-Host "Created non-executed production change set: $changeSet"
  Write-Host 'Review it in CloudFormation. Re-run with -Execute -ConfirmProduction to deploy.'
  exit 0
}

# Phase 1: publish only the migration task definition, then run it to completion.
Deploy-ComputeStack -CurrentParameters $currentParameters -ApiImage $currentApiImage -MigrationImage $migrationImage -ChangeSetName "todopay-migration-$suffix"

$service = Invoke-AwsJson @('ecs', 'describe-services', '--cluster', $EnvironmentName, '--services', 'api')
$network = $service.services[0].networkConfiguration.awsvpcConfiguration
$networkJson = @{
  awsvpcConfiguration = @{
    subnets = @($network.subnets)
    securityGroups = @($network.securityGroups)
    assignPublicIp = [string]$network.assignPublicIp
  }
} | ConvertTo-Json -Compress -Depth 5
$task = Invoke-AwsJson @(
  'ecs', 'run-task', '--cluster', $EnvironmentName,
  '--task-definition', "$EnvironmentName-migration",
  '--launch-type', 'FARGATE', '--count', '1',
  '--network-configuration', $networkJson
)
if ($task.failures.Count -gt 0 -or $task.tasks.Count -ne 1) { throw 'Migration task failed to start.' }
$taskArn = [string]$task.tasks[0].taskArn
Invoke-Native aws @('ecs', 'wait', 'tasks-stopped', '--cluster', $EnvironmentName, '--tasks', $taskArn, '--profile', $Profile, '--region', $Region)
$stoppedTask = Invoke-AwsJson @('ecs', 'describe-tasks', '--cluster', $EnvironmentName, '--tasks', $taskArn)
$migrationContainer = $stoppedTask.tasks[0].containers | Where-Object name -eq 'migrate'
if ($migrationContainer.exitCode -ne 0) {
  throw "Migration failed with exit code $($migrationContainer.exitCode): $($migrationContainer.reason)"
}

# Phase 2: roll the API only after the migration succeeds.
Deploy-ComputeStack -CurrentParameters $currentParameters -ApiImage $apiImage -MigrationImage $migrationImage -ChangeSetName "todopay-api-$suffix"
Invoke-Native aws @('ecs', 'wait', 'services-stable', '--cluster', $EnvironmentName, '--services', 'api', '--profile', $Profile, '--region', $Region)
$health = Invoke-RestMethod -Uri 'https://api.todopay.io/api/healthz' -TimeoutSec 30
if ($health.status -ne 'ok') { throw 'Production health endpoint did not return status=ok.' }
Write-Host "Production deployment complete: $apiImage"
