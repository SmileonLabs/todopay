[CmdletBinding()]
param(
  [string]$Profile = 'AdministratorAccess-746491202681',
  [string]$Region = 'ap-northeast-2',
  [string]$ExpectedAccountId = '746491202681',
  [string]$EnvironmentName = 'todopay-prod'
)

$ErrorActionPreference = 'Stop'

function Invoke-AwsJson {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)
  $raw = & aws @Arguments --profile $Profile --region $Region --output json
  if ($LASTEXITCODE -ne 0) { throw "AWS command failed: aws $($Arguments -join ' ')" }
  if ([string]::IsNullOrWhiteSpace(($raw -join "`n"))) { return $null }
  return (($raw -join "`n") | ConvertFrom-Json)
}

$identity = Invoke-AwsJson @('sts', 'get-caller-identity')
if ($identity.Account -ne $ExpectedAccountId) {
  throw "Refusing to inspect account $($identity.Account); expected $ExpectedAccountId."
}

Write-Host "AWS account $($identity.Account), region $Region"
Write-Host "Caller: $($identity.Arn)"

$stacks = Invoke-AwsJson @(
  'cloudformation', 'describe-stacks',
  '--query', "Stacks[?starts_with(StackName, '$EnvironmentName')].[StackName,StackStatus,LastUpdatedTime]"
)
Write-Host "`nCloudFormation stacks"
$stacks | ForEach-Object {
  [pscustomobject]@{ Stack = $_[0]; Status = $_[1]; LastUpdated = $_[2] }
} | Format-Table -AutoSize

$service = Invoke-AwsJson @(
  'ecs', 'describe-services', '--cluster', $EnvironmentName, '--services', 'api'
)
if (-not $service.services -or $service.failures.Count -gt 0) {
  throw "ECS service $EnvironmentName/api was not found."
}
$svc = $service.services[0]
Write-Host "`nECS API service"
[pscustomobject]@{
  Status = $svc.status
  Desired = $svc.desiredCount
  Running = $svc.runningCount
  Pending = $svc.pendingCount
  TaskDefinition = $svc.taskDefinition
  LatestDeployment = $svc.deployments[0].rolloutState
} | Format-List

$database = Invoke-AwsJson @(
  'rds', 'describe-db-instances', '--db-instance-identifier', "$EnvironmentName-postgres",
  '--query', 'DBInstances[0].{Status:DBInstanceStatus,Engine:Engine,Version:EngineVersion,MultiAZ:MultiAZ,BackupRetention:BackupRetentionPeriod,DeletionProtection:DeletionProtection}'
)
Write-Host 'RDS PostgreSQL'
$database | Format-List

$redis = Invoke-AwsJson @(
  'elasticache', 'describe-replication-groups', '--replication-group-id', "$EnvironmentName-redis",
  '--query', 'ReplicationGroups[0].{Status:Status,MultiAZ:MultiAZ,AutomaticFailover:AutomaticFailover,TransitEncryption:TransitEncryptionEnabled,AtRestEncryption:AtRestEncryptionEnabled}'
)
Write-Host 'ElastiCache Redis'
$redis | Format-List

$alarms = Invoke-AwsJson @(
  'cloudwatch', 'describe-alarms', '--alarm-name-prefix', $EnvironmentName,
  '--query', 'MetricAlarms[].[AlarmName,StateValue]'
)
Write-Host 'CloudWatch alarms'
$alarms | ForEach-Object {
  [pscustomobject]@{ Alarm = $_[0]; State = $_[1] }
} | Format-Table -AutoSize

try {
  $health = Invoke-RestMethod -Uri 'https://api.todopay.io/api/healthz' -TimeoutSec 15
  Write-Host "Public API health: $($health.status)"
} catch {
  Write-Warning "Public API health check failed: $($_.Exception.Message)"
}

if ($svc.runningCount -ne $svc.desiredCount -or $svc.pendingCount -ne 0) {
  throw 'ECS service is not at the desired steady state.'
}
