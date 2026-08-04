# TodoPay 작업 인수인계

작성일: 2026-07-28 (KST)

이 문서는 다른 Codex 계정이 현재 로컬 작업물과 AWS 운영 환경을 이어서 점검·개발할 수 있도록 작성했다. **실제 비밀번호, PG 연동키, 토큰은 이 문서나 Git에 저장하지 않는다.** AWS Secrets Manager에서만 확인한다.

## 1. 로컬 작업 폴더와 Git 상태

- 로컬 경로: `C:\Users\mirac\Desktop\Projects\todopay`
- 원격 저장소: `https://github.com/SmileonLabs/todopay`
- 현재 워크트리는 대규모 미커밋 변경 사항이 있다. 다른 Codex는 시작 직후 `git status --short`를 확인하고, **`git reset --hard`, `git checkout -- .`, 전체 삭제를 실행하면 안 된다.**
- 최근 커밋: `ed2d74c Published your App`
- 아직 커밋되지 않은 구현에는 PG 연동 기반, Redis/정산 보호, 플랫폼·파트너 화면 및 API, Sellink 독립 서비스 관련 코드가 포함된다.

권장 시작 명령:

```powershell
Set-Location 'C:\Users\mirac\Desktop\Projects\todopay'
git status --short
pnpm.cmd --dir artifacts/api-server run typecheck
pnpm.cmd --dir artifacts/api-server test
```

프런트엔드 빌드는 이제 반드시 모드별 스크립트를 사용한다.

```powershell
pnpm.cmd --dir artifacts/todopay run build:merchant
pnpm.cmd --dir artifacts/todopay run build:partner
pnpm.cmd --dir artifacts/todopay run build:platform
```

`pnpm.cmd --dir artifacts/todopay run build` 는 더 이상 기본 빌드를 하지 않고,
명시적 모드를 요구한다. 잘못된 콘솔을 다른 도메인에 올리는 실수를 막기 위한 안전장치다.

## 2. AWS 접근 방법

- AWS 계정: `746491202681`
- 운영 리전: `ap-northeast-2` (서울)
- AWS CLI 프로필: `AdministratorAccess-746491202681`
- IAM Identity Center SSO 리전: `ap-southeast-2` (시드니) — SSO 인스턴스가 위치한 리전이며, 운영 리전과 달라도 정상이다.

새 계정의 PC에서 AWS CLI 설치 후, 소유자가 기존 IAM Identity Center 사용자에게 필요한 권한을 부여하고 SSO 로그인을 진행해야 한다. 인증 확인:

```powershell
aws sso login --profile AdministratorAccess-746491202681
aws sts get-caller-identity --profile AdministratorAccess-746491202681
```

AWS 작업 명령에는 일관되게 아래 옵션을 넣는다.

```powershell
--region ap-northeast-2 --profile AdministratorAccess-746491202681
```

## 3. 현재 운영 인프라

| 구분 | 현재 구성 |
| --- | --- |
| API | ECS Fargate, 클러스터 `todopay-prod`, 서비스 `api`, 현재 API 태스크 정의 revision 14 |
| API 배포 스택 | CloudFormation `todopay-prod-compute` |
| API 도메인 | `https://api.todopay.io` |
| DB | RDS PostgreSQL (비공개 네트워크) |
| 캐시/분산 제어 | ElastiCache Redis (비공개 네트워크) |
| 웹 | S3 + CloudFront, 도메인별 별도 배포 |
| DNS | Route 53 hosted zone `todopay.io` |

주요 사이트:

- `https://platform.todopay.io/` — TodoPay 운영사 플랫폼 관리자
- `https://partner.todopay.io/` — TodoPay가 가맹점에 제공하는 파트너 관리자
- `https://admin.sellink.todopay.io/` — Sellink의 독립 관리자 서비스. TodoPay API/DB와 직접 공유하지 않음.
- `https://api.todopay.io/` — API 및 PG NOTI 수신

운영 상태 확인:

```powershell
aws ecs describe-services --cluster todopay-prod --services api --region ap-northeast-2 --profile AdministratorAccess-746491202681
aws cloudformation describe-stacks --stack-name todopay-prod-compute --region ap-northeast-2 --profile AdministratorAccess-746491202681
```

## 4. 계정·비밀값 관리

절대 코드, `.env.example`, Git, 채팅에 비밀번호나 PG 키를 넣지 않는다.

- Sellink 파트너 관리자 초기 계정: Secrets Manager `todopay-prod/runtime/sellink-partner-admin`
- 런타임 DB/Redis/세션/PG 설정: CloudFormation `todopay-prod-compute`의 Parameters에 연결된 Secrets Manager ARN을 기준으로 조회한다.
- KPPay 비밀 설정에는 `merchantId`, `virtualAccountKey`, `payoutKey`, `baseUrl` 필드가 있다.

Secret 이름 또는 ARN을 확인하는 안전한 방법:

```powershell
aws cloudformation describe-stacks --stack-name todopay-prod-compute --region ap-northeast-2 --profile AdministratorAccess-746491202681 --query 'Stacks[0].Parameters' --output table
```

## 5. 최근 로그인 장애와 수정 내용

### 증상

`partner.todopay.io`에서 아이디·비밀번호가 맞아도 로그인 실패가 발생했다. 터미널에서 API를 직접 호출하면 성공해 혼동이 있었다.

### 실제 원인

API의 CORS 허용 목록에 `https://partner.todopay.io`가 빠져 있었다. 브라우저는 `Origin: https://partner.todopay.io`를 전송하므로 API가 인증 처리 전에 500으로 거부했다. 터미널 직접 호출은 Origin이 없어서 성공했던 것이다.

### 조치 및 검증

- CloudFormation 스택 파라미터 `CorsOrigins`에 `https://partner.todopay.io`를 추가해 revision 14로 배포했다.
- 재발 방지를 위해 `infra/aws/compute.yaml`의 기본값도 수정했다.
- `Origin: https://partner.todopay.io`를 포함한 `POST https://partner.todopay.io/api/auth/login`을 실제로 호출해 HTTP 200 및 `Access-Control-Allow-Origin`을 확인했다.

관련 코드:

- `artifacts/api-server/src/app.ts` — CORS 처리
- `infra/aws/compute.yaml` — `CorsOrigins`
- `artifacts/todopay/src/pages/login.tsx` — 상대 경로 `/api/auth/login` 호출

## 6. 개발 단계에서 임시로 완화된 설정

운영 전환에 따라 관리자 로그인 무차별 대입 방어를 다시 활성화했다.

```yaml
ADMIN_LOGIN_RATE_LIMIT_ENABLED: "true"
```

위치는 `infra/aws/compute.yaml`이며, 코드 조건은 `artifacts/api-server/src/routes/auth.ts`에 있다.

코결 운영 승인 및 PayKey Echo 검증 후 실제 PG 호출 스위치를 활성화했다.

```yaml
PAYMENT_PROVIDER_ENABLED: "true"
```

2026-07-28 기준 ECS 태스크 정의 `todopay-prod-api:21`에서 적용됐으며,
가상계좌 발급·지급이체는 운영자 작업이 있어야만 실행된다.

## 7. PG(KPPay / 코리아결제시스템) 구현 현황

제공 문서:

- `pdf\코리아결제시스템_가상계좌출금정보 등록_API_연동가이드_인증O(ver2.0).pdf`
- `pdf\지급대행_API_연동가이드(ver1.3).pdf`

구현된 핵심:

- 가상계좌 발급 클라이언트 및 API
- 지급 요청 경로와 상태 보호
- 입금/출금 NOTI 웹훅 수신 경로
- NOTI 송신 IP `112.175.152.181` 검증
- 중복 NOTI·잔액 반전의 원자성 보호, 감사 로그 및 Redis 기반 제어

코결 등록·승인 완료 및 확인된 운영 정보:

1. 코결 운영 테스트는 별도 테스트 환경 없이 운영 환경에서 진행한다.
2. 아래 NOTI URL 등록이 완료됐다.
   - 입금: `https://api.todopay.io/api/webhooks/kp-pay/virtual-account`
   - 출금: `https://api.todopay.io/api/webhooks/kp-pay/payout`
3. 지급 허용 IP `43.202.129.164/32`, `3.36.170.247/32` 등록이 완료됐다.
4. 가상계좌·지급대행 PayKey Echo가 각각 HTTP 200, 결과코드 `0000`으로 확인됐다.
5. 남은 작업은 통제된 소액 테스트에서 가상계좌 발급, 입금 NOTI, 출금 요청,
   출금 성공/실패 NOTI 및 중복 NOTI를 순서대로 검증하는 것이다.

## 8. 서비스 구조 원칙

- `platform.todopay.io`: TodoPay 운영사가 모든 가맹점·API 자격증명·운영을 관리한다.
- `partner.todopay.io`: 각 가맹점에게 제공하는 TodoPay 파트너 관리자다. 로그인 사용자에게 연결된 가맹점 범위만 볼 수 있어야 한다.
- `admin.sellink.todopay.io`: Sellink가 자체적으로 운영하는 독립 관리자다. API 계약으로 연동해야 하며, TodoPay 운영 DB에 직접 연결하면 안 된다.
- Sellink 관련 과거 실험용 BFF/중간 구조는 폐기 방향으로 정리됐고, 현재 `admin.sellink.todopay.io`는 Git 최신 소스를 기반으로 복구된 독립 서비스다. 삭제·재구성 전에는 반드시 CloudFront/S3/Route53 대상과 실제 서비스 트래픽을 확인한다.

## 9. 다음 우선순위

1. 현재 미커밋 변경을 기능 단위로 검토·테스트하고 안전하게 커밋/원격 반영한다.
2. `platform`, `partner`, `api`, Sellink 독립 관리자의 권한 분리·회귀 테스트를 자동화한다.
3. PG 운영 연동 테스트를 실행한다. 실거래 활성화는 마지막 단계다.
4. 운영 오픈 전 로그인 rate limit, 비밀번호 정책, 관리자 MFA/접근제한, CloudWatch 알림, DB 백업·복구 점검을 완료한다.

## 10. 배포 시 주의

- `infra/aws/compute.yaml`만 수정했다고 자동 배포되지는 않는다. CloudFormation `update-stack`과 ECS rollout 완료를 확인해야 한다.
- CloudFormation 파라미터는 기존 값을 유지해야 한다. Parameter를 누락해 기본값으로 덮어쓰면 PG/DB/Redis 연결 또는 CORS가 깨질 수 있다.
- 배포 후에는 반드시 `api` ECS 서비스의 `runningCount=desiredCount`, ALB target health, 도메인별 브라우저 기능을 확인한다.
- PG 키, 비밀번호, 세션 키, DB URL은 명령 출력·로그·커밋에 노출하지 않는다.
