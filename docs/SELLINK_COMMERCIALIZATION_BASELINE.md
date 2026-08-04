# Sellink 상용화 개발 기준선

작성일: 2026-07-29

## 서비스 경계

- TodoPay는 결제·가상계좌·출금·PG 이벤트·금융 원장의 유일한 원본이다.
- Sellink는 회원 가입 오케스트레이션, 조직 계층, 내부 수수료 배분, 관리자 UI를 담당한다.
- Sellink 금융 화면은 TodoPay BFF만 호출한다. 로컬의 과거 거래 테이블은 신규 조회 원본으로 사용하지 않는다.
- 조직 사용자의 금융 조회 범위는 `integration_mappings`의 `admin_user → store_code` 연결로 결정한다.
- 매핑이 없는 계정은 금융 메뉴와 API가 모두 실패 차단된다.

## 구현 단계

1. 세션 만료 시 전역 401 처리와 로그인 화면 복귀
2. API capability 기반 RBAC와 역할별 메뉴
3. 재귀 조직 범위 강제 및 하위 계정 CRUD 감사 로그
4. 수수료율을 basis point로 정규화하고 DB 트랜잭션 잠금 적용
5. TodoPay 매장코드 매핑과 서버 강제 데이터 범위
6. TodoPay 원장 기반 대시보드/일별 통계
7. TOTP 등록 확인, 암호화 저장, 복구 코드, 고위험 작업 재인증
8. 공통 API 속도 제한, 보안 헤더, 요청 크기 제한
9. 단위·통합·동시성·성능 스모크 테스트

## 운영 배포 전 필수 입력

- `OTP_ENCRYPTION_KEY`: 장기 보관 가능한 고엔트로피 키
- `SESSION_SECRET`, `CORS_ORIGINS`, `REDIS_URL`
- `TODOPAY_API_BASE_URL`, `TODOPAY_API_KEY`, `TODOPAY_WEBHOOK_SECRET`
- 마이그레이션 `005_totp_enrollment.sql`
- 각 Sellink 매장 계정의 TodoPay `store_code` 매핑

## 운영 배포 후 검증

- 역할별 계정으로 보이지 않아야 할 메뉴와 API가 403인지 확인
- 매장 A 계정에서 매장 B의 거래번호 직접 조회가 404/403인지 확인
- 동일 입금 이벤트 재전송 시 원장과 내부 수수료가 한 번만 반영되는지 확인
- OTP 활성 계정의 수수료 변경과 출금 승인에 OTP 재인증이 필요한지 확인
- TodoPay 통계와 Sellink 통계 합계가 동일한지 확인
