# AWS development and production deployment

## Fixed production context

- AWS account: `746491202681`
- Workload region: `ap-northeast-2`
- IAM Identity Center region: `ap-southeast-2`
- IAM Identity Center start URL: `https://d-97679d6ba8.awsapps.com/start`
- CLI profile: `AdministratorAccess-746491202681`
- ECS cluster/service: `todopay-prod` / `api`
- Compute stack: `todopay-prod-compute`

Never store passwords, SSO tokens, database URLs, or PG keys in this repository.

## 1. Configure and log in with SSO

This workstation blocks unsigned PowerShell scripts by default. Enable scripts
for the current PowerShell process only, then configure SSO:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\scripts\aws\configure-sso.ps1 -StartUrl 'https://d-97679d6ba8.awsapps.com/start'
```

This does not change the machine or user execution policy.

For later sessions:

```powershell
aws sso login --profile AdministratorAccess-746491202681
```

## 2. Inspect production without changing it

```powershell
.\scripts\aws\status.ps1
```

The script verifies the AWS account before reading CloudFormation, ECS, RDS,
ElastiCache, CloudWatch, and the public API health endpoint. It does not read
secret values.

## 3. API deployment

The first command validates the code, builds and pushes immutable API and
migration images, then creates a CloudFormation change set without executing it:

```powershell
.\scripts\aws\deploy-production.ps1
```

Review the change set in CloudFormation. To perform the production rollout:

```powershell
.\scripts\aws\deploy-production.ps1 -Execute -ConfirmProduction
```

The execution path is deliberately ordered:

1. Verify clean `main`, AWS account, typecheck, and tests.
2. Build and push API and migration images tagged with the Git commit.
3. Update only the migration task definition.
4. Run the migration task and require exit code `0`.
5. Update the API task definition and wait for ECS stability.
6. Require `https://api.todopay.io/api/healthz` to return `status=ok`.

CloudFormation deployment circuit-breaker rollback remains enabled.

## 4. Frontend deployment

Without `-Execute`, the command only builds and displays the resolved
S3/CloudFront targets. The targets below were verified in account
`746491202681` on 2026-08-16:

```powershell
.\scripts\aws\deploy-frontend.ps1 -Mode platform -BucketName 'todopay-platform-admin-746491202681' -DistributionId 'E260V5SLI9ZN94'
.\scripts\aws\deploy-frontend.ps1 -Mode partner -BucketName 'todopay-partner-portal-746491202681' -DistributionId 'E2P2V8L84FOGA7'
.\scripts\aws\deploy-frontend.ps1 -Mode merchant -StackName 'todopay-prod-frontend'
```

The current aliases are `platform.todopay.io`, `partner.todopay.io`, and
`todopay.io`, respectively. Re-check the distribution aliases before every
production deployment.

After reviewing the target, append `-Execute -ConfirmProduction`. Execution
syncs the build to S3 with `--delete` and creates a CloudFront invalidation.

## Rollback

- API: redeploy the previous ECR image tag through the same compute stack.
- ECS deployment failures: the configured deployment circuit breaker rolls back.
- Frontend: rebuild the intended Git commit and sync it to the same bucket.
- Database: migrations must be backward compatible; never rely on an automatic
  destructive schema rollback.
