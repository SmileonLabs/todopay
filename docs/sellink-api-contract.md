# Sellink 연동용 TodoPay API 계약

이 문서는 Sellink 운영 화면이 금융 값을 자체 계산하지 않고 TodoPay의 확정 응답만 사용하기 위한 계약이다.

## 공통 규칙

- Base path: `/external/v1`
- 인증: `X-TodoPay-Api-Key`와 TodoPay에 등록된 호출 IP가 모두 일치해야 한다.
- 날짜: `Asia/Seoul`. `startDate`, `endDate`는 `YYYY-MM-DD`이고 양 끝 날짜를 포함한다.
- 범위: `storeCodes=A001,A002`가 전달되면 해당 코드 범위만 반환한다. 생략하면 API 키 소유 가맹점 전체를 반환한다.
- 목록: `{ page, limit, total, items }`. 기본 `page=1`, `limit=50`, 최대 `limit=100`(일별 통계는 366).
- 금액: KRW 원 단위 정수. 계산 가능한 기간의 거래가 없어서 합계가 0인 경우는 `0`, 원천 정보가 없어 제공할 수 없는 개별 값은 `null`이다.
- 잘못된 날짜는 `400 INVALID_DATE_RANGE`, 366일을 넘는 일별 통계는 `400 DATE_RANGE_TOO_LARGE`이다.

## P0 확정 계약

### `GET /statistics/daily`

응답은 날짜가 없는 날도 포함한 페이지 목록이다.

| 필드                     | 산식                                                                                                 |
| ------------------------ | ---------------------------------------------------------------------------------------------------- |
| `depositAmount`          | 해당 일자 성공 입금의 수수료 전 금액 합계                                                            |
| `feeAmount`              | 해당 일자 성공 입금 수수료 합계                                                                      |
| `withdrawalAmount`       | 해당 일자 생성되고 반려되지 않은 출금 요청 총액(수수료 포함)                                         |
| `netAmount`              | 성공 입금 순액(`originalAmount - fee`) - 출금 요청 총액. 기존 호환 필드이며 `profitAmount`와 다르다. |
| `reserveAmount`          | 해당 일자 원장의 `withdrawal_reserve` 차변 합계                                                      |
| `withdrawalFeeAmount`    | 해당 일자 지급 완료(`paidAt`) 출금 수수료 합계                                                       |
| `actualWithdrawalAmount` | 해당 일자 지급 완료 출금의 실지급액(`amount - fee`) 합계                                             |
| `profitAmount`           | 성공 입금 수수료 + 지급 완료 출금 수수료                                                             |
| `closingBalance`         | 해당 일자 마지막 원장 항목 반영 후 출금 가능 잔액                                                    |

따라서 `profitAmount`와 `netAmount`는 동일 개념이 아니다. `withdrawalAmount`는 수수료를 포함한 요청·예약 총액이고, 실지급액은 `actualWithdrawalAmount`이다.

### `GET /withdrawals`

- 검색 대상: `storeName`, `storeCode`, `trackingNumber` 및 PG 거래 ID.
- 목록 최상위 `totalAmount`: 현재 필터 전체의 출금 요청 총액 합계.
- 최상위 `withdrawalFeeAmount`: 현재 필터 전체 수수료 합계.
- 최상위 `actualWithdrawalAmount`: 현재 필터 중 지급 완료 건의 실지급액 합계.
- 항목 `totalAmount`: 화면의 총금액에 해당하는 수수료 포함 요청 총액.
- 항목 `payoutAmount`: 수수료 차감 후 지급 예정액.
- 항목 `actualWithdrawalAmount`: 지급 완료 전에는 `null`, 완료 후 실지급액.
- `approvedBy`, `storeCode`, `storeName`을 함께 반환한다.

승인 상태:

- `pending`: 승인 대기
- `approved`: 승인 완료
- `rejected`: 반려

지급 상태:

- `unpaid`: 지급 전
- `submitting`: PG 제출 중
- `processing`: PG 처리 중
- `paid`: 지급 완료
- `failed`: 지급 실패
- `unknown`: PG 결과 확인 필요

### `GET /settlements/summary`

필터 범위의 `total`, `creditAmount`, `debitAmount`와 종료일 마감 `closingBalance`를 반환한다. 날짜가 없으면 전체 원장이다.

### `GET /settlements/records`

`id`, `direction`, `transactionType`, `amount`, `originalAmount`, `fee`, `balance`, `trackingNumber`, `storeCode`, `storeName`, `baseDate`, `createdAt`을 반환한다. `balance`는 해당 항목 반영 직후의 누적 원장 잔액이다.

원장 유형:

- `deposit_credit`: 입금 순액 대변
- `withdrawal_reserve`: 출금 요청 총액 차변
- `withdrawal_refund`: 반려·실패한 예약액의 환입 대변

## P1 조회 계약

### `GET /virtual-accounts`

`storeCode`, `storeName`, `memberId`, `memberName`, `bankName`, `accountNumber`, `accountHolder`, `issueId`, `trackId`, `status`, `issuanceStatus`, `createdAt`, `lastDepositAt`, `daysSinceLastDeposit`을 반환한다.

- 검색: 계좌번호, `issueId`, `trackId`, 판매점 코드·명, 구매자명. 예금주는 현재 원천 데이터가 없어 `accountHolder=null`이다.
- `unfundedOnly=true`: 성공 입금 이력이 없는 계좌만 반환한다.
- `lastDepositAt`: 해당 구매자의 마지막 성공 입금 시각.
- `daysSinceLastDeposit`: 서울 날짜 기준 경과 일수. 입금 이력이 없으면 `null`.
- 계좌 상태는 `active`, `revoked`; 발급 상태는 `requesting`, `awaiting_verification`, `issued`, `failed`, `cancelled`, `expired`이다.

### `GET /members`

기존 필드와 함께 `storeCode`, `storeName`, `birthdate`, `shoppingMallId`, `withdrawalAccount`, `virtualAccountStatus`, `virtualAccountUpdatedAt`을 반환한다. 현재 회원 원천 스키마에 없는 `shoppingMallId`, `withdrawalAccount`는 `null`이다.

### `GET /balance`, `GET /balance/records`

- `availableBalance`: 현재 원장 출금 가능 잔액.
- `holdingAmount`: 반려되지 않았고 아직 지급 완료·실패 처리되지 않은 출금 요청 총액.
- `/balance/records`는 `/settlements/records`와 같은 거래별 충전금 원장을 반환한다.

### `GET /transactions`

`storeCode`, `storeName`, `memberName`, `depositorName`, `fromAccountMasked`, `toAccountMasked`, `runningBalance`를 반환한다. 원천 데이터가 없는 `depositorName`, 거래와 원장 잔액을 확정 연결할 수 없는 `runningBalance`는 `null`이며 Sellink는 `-`로 표시한다. 계좌번호는 목록에서 마스킹 값만 제공한다.

## 금융 쓰기 및 가상계좌 작업

다음 공식 경로는 계약을 예약했지만 현재 운영 권한과 PG 기능이 활성화되지 않았다.

- `POST /withdrawals`
- `POST /withdrawals/{id}/approve`
- `POST /withdrawals/{id}/reject`
- `POST /withdrawals/{id}/payout` (최초 실행과 재시도)
- `POST /transactions/{trackingNumber}/confirm-purchase`
- `POST /balance/adjustments`
- `POST /virtual-accounts`
- `POST /members/{id}/virtual-account/reissue`
- `POST /virtual-accounts/{id}/revoke`

모든 요청은 8~128자의 `Idempotency-Key`가 필수다. 키가 없으면 `400 IDEMPOTENCY_KEY_REQUIRED`이다. 현재는 실제 금융 상태를 변경하지 않고 `501 PROVIDER_CAPABILITY_UNAVAILABLE`과 `retryable=false`, 감사 추적용 `auditId`를 반환한다. 이 응답은 실패로 처리해야 하며 자동 재시도하지 않는다.

향후 활성화 조건은 merchant별 쓰기 scope, 상태 전이 검증, 요청·응답 영구 멱등 저장, PG 기능 확인, 감사 로그 및 Webhook 전달 검증이다. 계획된 Webhook 이벤트는 `withdrawal.requested`, `withdrawal.approved`, `withdrawal.rejected`, `withdrawal.payout.processing`, `withdrawal.paid`, `withdrawal.failed`, `transaction.purchase_confirmed`, `balance.adjusted`, `virtual_account.issued`, `virtual_account.revoked`이며 활성화 전에는 발송되지 않는다.

활성화 후 금융 Webhook의 공통 본문은 아래 형식으로 고정한다. `data`에는 리소스별 `id`, `trackingNumber`, `storeCode`, `status`, 관련 KRW 정수 금액과 `occurredAt`이 들어가며, 제공 불가 필드는 `null`이다.

```json
{
  "id": "evt_unique_id",
  "type": "withdrawal.paid",
  "createdAt": "2026-08-19T05:00:00.000Z",
  "data": {
    "id": 123,
    "trackingNumber": "WD-...",
    "storeCode": "STORE_001",
    "status": "paid",
    "totalAmount": 100000,
    "fee": 1000,
    "actualWithdrawalAmount": 99000,
    "occurredAt": "2026-08-19T05:00:00.000Z"
  }
}
```

전송 헤더는 `X-TodoPay-Event-Id`, `X-TodoPay-Event-Type`, `X-TodoPay-Timestamp`, `X-TodoPay-Signature: v1=<hex>`이다. 서명은 merchant 전용 secret으로 `HMAC-SHA256(timestamp + "." + eventId + "." + rawBody)`를 계산한다. 수신 측은 이벤트 ID를 멱등 키로 저장하고 서명·타임스탬프를 검증한 뒤 2xx를 반환해야 한다. TodoPay는 30초부터 지수형 간격으로 최대 10회 전송하고, 모두 실패하면 `dead` 상태로 운영자 재처리 대상이 된다.

## 주요 오류 코드

| HTTP | 코드                              | 처리                                       |
| ---: | --------------------------------- | ------------------------------------------ |
|  400 | `INVALID_DATE_RANGE`              | 날짜 수정 후 재호출                        |
|  400 | `DATE_RANGE_TOO_LARGE`            | 기간을 366일 이하로 분할                   |
|  400 | `INVALID_FILTER`                  | 필터 값 수정                               |
|  400 | `IDEMPOTENCY_KEY_REQUIRED`        | 유효한 키를 넣어 재호출                    |
|  401 | `UNAUTHORIZED` 또는 인증 오류     | API 키와 허용 IP 확인                      |
|  404 | 리소스별 not found                | 매장 범위와 식별자 확인                    |
|  501 | `PROVIDER_CAPABILITY_UNAVAILABLE` | 기능 활성화 전 호출 금지, 자동 재시도 금지 |
