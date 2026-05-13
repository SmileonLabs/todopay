import { createWriteStream } from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const PDFDocument = require('/tmp/node_modules/pdfkit');

const FONT_REG = '/tmp/NotoSansKR-Regular.otf';
const FONT_BOLD = '/tmp/NotoSansKR-Bold.otf';
const OUT = '/home/runner/workspace/todopay-admin-guide.pdf';

// ─── Colors ────────────────────────────────────────────────────────────────
const NAVY      = '#0a0f1e';
const NAVY2     = '#0d1b3e';
const BLUE      = '#00d4ff';
const WHITE     = '#ffffff';
const SLATE     = '#475569';
const LIGHT_BG  = '#f8fafc';
const BORDER    = '#e2e8f0';
const TEXT      = '#1e293b';
const MUTED     = '#64748b';
const DANGER_BG = '#fef2f2';
const DANGER_TXT= '#991b1b';
const WARN_BG   = '#fefce8';
const WARN_TXT  = '#854d0e';
const INFO_BG   = '#eff6ff';
const INFO_TXT  = '#1e40af';

const W = 595.28;  // A4 width
const H = 841.89;  // A4 height
const ML = 50;     // margin left
const MR = 50;     // margin right
const CW = W - ML - MR; // content width

const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false });
doc.pipe(createWriteStream(OUT));
doc.registerFont('reg',  FONT_REG);
doc.registerFont('bold', FONT_BOLD);

let y = 0;

// ─── Helpers ────────────────────────────────────────────────────────────────
function newPage() {
  doc.addPage();
  y = 0;
}

function text(str, opts = {}) {
  const { x = ML, width = CW, font = 'reg', size = 10, color = TEXT, align = 'left', moveDown = 0 } = opts;
  doc.font(font).fontSize(size).fillColor(color).text(str, x, y, { width, align, lineBreak: true });
  y = doc.y + moveDown;
}

function rect(rx, ry, rw, rh, fillColor, strokeColor, radius = 0) {
  doc.save();
  if (radius) doc.roundedRect(rx, ry, rw, rh, radius);
  else doc.rect(rx, ry, rw, rh);
  if (fillColor) doc.fillColor(fillColor).fill();
  if (strokeColor) doc.strokeColor(strokeColor).stroke();
  doc.restore();
}

function hline(ly, color = BORDER) {
  doc.save().moveTo(ML, ly).lineTo(W - MR, ly).strokeColor(color).lineWidth(0.5).stroke().restore();
}

function sectionHeader(num, title, desc) {
  rect(ML, y, CW, 70, NAVY2, null, 8);
  // accent dot
  doc.save().circle(ML + CW - 30, y + 20, 28).fillColor(BLUE).fillOpacity(0.08).fill().restore();
  doc.font('bold').fontSize(8).fillColor(BLUE).text(num, ML + 14, y + 10, { width: CW - 20 });
  doc.font('bold').fontSize(16).fillColor(WHITE).text(title, ML + 14, y + 22, { width: CW - 60 });
  doc.font('reg').fontSize(9).fillColor('#94a3b8').text(desc, ML + 14, y + 44, { width: CW - 60 });
  y += 84;
}

function h3(str) {
  y += 16;
  rect(ML, y, 4, 16, BLUE, null);
  doc.font('bold').fontSize(12).fillColor(NAVY2).text(str, ML + 10, y + 1, { width: CW - 10 });
  y = doc.y + 8;
}

function h4(str) {
  y += 8;
  doc.font('bold').fontSize(10).fillColor('#334155').text(str, ML, y, { width: CW });
  y = doc.y + 4;
}

function para(str, color = SLATE) {
  doc.font('reg').fontSize(9.5).fillColor(color).text(str, ML, y, { width: CW, lineBreak: true });
  y = doc.y + 6;
}

function infoBox(str, bg = INFO_BG, tc = INFO_TXT, border = '#3b82f6') {
  const measured = doc.font('reg').fontSize(9).heightOfString(str, { width: CW - 40 });
  const bh = measured + 22;
  rect(ML, y, 4, bh, border, null);
  rect(ML + 4, y, CW - 4, bh, bg, null);
  doc.font('reg').fontSize(9).fillColor(tc).text(str, ML + 14, y + 10, { width: CW - 30, lineBreak: true });
  y += bh + 8;
}

function warnBox(str) { infoBox(str, WARN_BG, WARN_TXT, '#eab308'); }
function dangerBox(str) { infoBox(str, DANGER_BG, DANGER_TXT, '#ef4444'); }

function step(num, title, desc) {
  // circle
  doc.save().circle(ML + 10, y + 8, 10).fillColor(BLUE).fill().restore();
  doc.font('bold').fontSize(8).fillColor(NAVY).text(String(num), ML + 7, y + 4);
  doc.font('bold').fontSize(9.5).fillColor(TEXT).text(title, ML + 24, y, { width: CW - 24 });
  y = doc.y;
  doc.font('reg').fontSize(9).fillColor(MUTED).text(desc, ML + 24, y + 2, { width: CW - 24, lineBreak: true });
  y = doc.y + 8;
}

function table(headers, rows, colWidths) {
  const TH = 20;
  const TD = 18;
  const totalW = colWidths.reduce((a, b) => a + b, 0);
  // header
  rect(ML, y, totalW, TH, NAVY2, null, 0);
  let cx = ML;
  headers.forEach((h, i) => {
    doc.font('bold').fontSize(8.5).fillColor(WHITE).text(h, cx + 6, y + 5, { width: colWidths[i] - 8 });
    cx += colWidths[i];
  });
  y += TH;
  // rows
  rows.forEach((row, ri) => {
    const bg = ri % 2 === 0 ? WHITE : LIGHT_BG;
    const rowH = row.reduce((max, cell, ci) => {
      const h = doc.font('reg').fontSize(8.5).heightOfString(String(cell), { width: colWidths[ci] - 8 });
      return Math.max(max, h + 10);
    }, TD);
    rect(ML, y, totalW, rowH, bg, null);
    // bottom border
    doc.save().moveTo(ML, y + rowH).lineTo(ML + totalW, y + rowH).strokeColor(BORDER).lineWidth(0.3).stroke().restore();
    cx = ML;
    row.forEach((cell, ci) => {
      const font = ci === 0 ? 'bold' : 'reg';
      doc.font(font).fontSize(8.5).fillColor('#374151').text(String(cell), cx + 6, y + 5, { width: colWidths[ci] - 8, lineBreak: true });
      cx += colWidths[ci];
    });
    y += rowH;
  });
  y += 10;
}

function card2(title1, body1, title2, body2) {
  const cw = (CW - 10) / 2;
  const h1 = doc.font('reg').fontSize(8.5).heightOfString(body1, { width: cw - 24 }) + 38;
  const h2 = doc.font('reg').fontSize(8.5).heightOfString(body2, { width: cw - 24 }) + 38;
  const ch = Math.max(h1, h2);
  rect(ML, y, cw, ch, LIGHT_BG, BORDER, 6);
  doc.font('bold').fontSize(9).fillColor(TEXT).text(title1, ML + 10, y + 10, { width: cw - 20 });
  doc.font('reg').fontSize(8.5).fillColor(MUTED).text(body1, ML + 10, y + 26, { width: cw - 20, lineBreak: true });
  const x2 = ML + cw + 10;
  rect(x2, y, cw, ch, LIGHT_BG, BORDER, 6);
  doc.font('bold').fontSize(9).fillColor(TEXT).text(title2, x2 + 10, y + 10, { width: cw - 20 });
  doc.font('reg').fontSize(8.5).fillColor(MUTED).text(body2, x2 + 10, y + 26, { width: cw - 20, lineBreak: true });
  y += ch + 10;
}

function card3(items) {
  const cw = (CW - 20) / 3;
  const heights = items.map(it => doc.font('reg').fontSize(8.5).heightOfString(it.body, { width: cw - 20 }) + 38);
  const ch = Math.max(...heights);
  items.forEach((it, i) => {
    const ix = ML + i * (cw + 10);
    rect(ix, y, cw, ch, LIGHT_BG, BORDER, 6);
    doc.font('bold').fontSize(9).fillColor(TEXT).text(it.title, ix + 10, y + 10, { width: cw - 20 });
    doc.font('reg').fontSize(8.5).fillColor(MUTED).text(it.body, ix + 10, y + 26, { width: cw - 20, lineBreak: true });
  });
  y += ch + 10;
}

// ═══════════════════════════════════════════════════════
// COVER PAGE
// ═══════════════════════════════════════════════════════
newPage();

// background
rect(0, 0, W, H, NAVY, null);

// glow circle top right
doc.save().circle(W - 40, 60, 180).fillColor(BLUE).fillOpacity(0.05).fill().restore();

// glow circle bottom left
doc.save().circle(60, H - 80, 130).fillColor(BLUE).fillOpacity(0.04).fill().restore();

// accent line
rect(ML, H / 2 - 80, 3, 160, BLUE, null);

// Logo
doc.font('bold').fontSize(42).fillColor(BLUE).text('TODO PAY', ML + 20, H / 2 - 130, { width: CW, align: 'center' });
doc.font('reg').fontSize(11).fillColor('#64748b').text('FINANCIAL OPERATIONS', ML, H / 2 - 78, { width: CW, align: 'center', characterSpacing: 4 });

// divider
doc.save().moveTo(W / 2 - 40, H / 2 - 48).lineTo(W / 2 + 40, H / 2 - 48).strokeColor(BLUE).lineWidth(1).stroke().restore();

// Title
doc.font('bold').fontSize(22).fillColor(WHITE).text('관리자 전체 기능 가이드', ML, H / 2 - 30, { width: CW, align: 'center' });
doc.font('reg').fontSize(10).fillColor('#64748b').text('Administrator Complete Function Guide · v1.0', ML, H / 2 + 6, { width: CW, align: 'center' });

// bottom
doc.font('reg').fontSize(8).fillColor('#334155').text('© 2026 TodoPay Financial Operations · CONFIDENTIAL', ML, H - 40, { width: CW, align: 'center' });


// ═══════════════════════════════════════════════════════
// TABLE OF CONTENTS
// ═══════════════════════════════════════════════════════
newPage();
y = 50;
doc.font('bold').fontSize(18).fillColor(NAVY2).text('목차', ML, y);
y = doc.y + 4;
hline(y, BLUE);
doc.save().moveTo(ML, y - 1).lineTo(ML + 80, y - 1).strokeColor(BLUE).lineWidth(2).stroke().restore();
y += 16;

const tocItems = [
  { num: '01', title: '시스템 개요', subs: ['플랫폼 소개', '관리자 계층 구조', '기본 접속 정보'] },
  { num: '02', title: '로그인 및 내 계정', subs: ['관리자 로그인', '내 계정 관리', 'OTP 설정'] },
  { num: '03', title: '대시보드', subs: ['오늘의 현황 카드', '월간 통계'] },
  { num: '04', title: '하부 조직 관리 (사용자 관리)', subs: ['계정 생성', '권한 관리', '비밀번호 초기화'] },
  { num: '05', title: '수수료 설정', subs: ['수수료 계층 구조', '설정 방법', '마진 계산'] },
  { num: '06', title: '회원 관리', subs: ['회원 등록', '가상계좌 발급', '상태 관리'] },
  { num: '07', title: '입출금 내역 (거래 내역)', subs: ['입금 확인 처리', '거래 내역 조회'] },
  { num: '08', title: '출금 관리', subs: ['출금 승인 / 반려', '출금 현황'] },
  { num: '09', title: '충전금액 관리', subs: ['잔액 현황', '수동 입력', '이력 조회'] },
  { num: '10', title: '일자별 통계', subs: ['통계 차트', '일별 데이터 테이블'] },
  { num: '11', title: '공지사항', subs: ['공지 작성', '핀 고정 및 관리'] },
  { num: '12', title: '역할별 메뉴 접근 권한 요약', subs: [] },
];

tocItems.forEach(item => {
  // section row
  rect(ML, y, CW, 22, LIGHT_BG, null, 3);
  doc.font('bold').fontSize(9.5).fillColor(NAVY2).text(`${item.num}. ${item.title}`, ML + 10, y + 6, { width: CW - 60 });
  y += 22;
  // sub rows
  item.subs.forEach(sub => {
    doc.font('reg').fontSize(8.5).fillColor(MUTED).text(`    · ${sub}`, ML + 20, y + 2, { width: CW - 40 });
    y += 14;
  });
  y += 4;
});


// ═══════════════════════════════════════════════════════
// SECTION 01 — 시스템 개요
// ═══════════════════════════════════════════════════════
newPage();
y = 40;
sectionHeader('SECTION 01', '시스템 개요', '플랫폼 소개 · 관리자 계층 구조 · 기본 접속 정보');

h3('1.1 플랫폼 소개');
para('TodoPay는 가상계좌 발급 및 입/출금 관리를 위한 다단계 핀테크 어드민 플랫폼입니다. 슈퍼어드민부터 매장까지 5단계 계층 구조로 운영되며, 각 계층은 하위 조직을 관리하고 수수료를 배정합니다. 회원(구매자)은 각 매장에 소속되어 가상계좌를 통해 입출금 요청을 합니다.');
y += 4;
card3([
  { title: '가상계좌 발급', body: '회원별 전용 가상계좌를 발급하여 입금 추적 및 자동 매핑 처리' },
  { title: '입출금 관리', body: '입금 확인, 출금 승인/반려, 수수료 자동 계산 및 정산' },
  { title: '다단계 조직', body: '5단계 계층 관리자 구조로 하위 조직 생성 및 권한 제어' },
]);
card3([
  { title: '수수료 배정', body: '계층별 수수료 설정, 마진 자동 계산, 상한선 검증' },
  { title: '통계 & 리포트', body: '일자별 거래량, 수수료 현황, 잔액 변동 추이 시각화' },
  { title: '보안 & OTP', body: '역할 기반 접근 제어, OTP 이중 인증 옵션 지원' },
]);

h3('1.2 관리자 계층 구조');
const roles = [
  { label: '슈퍼어드민 (Superadmin)', color: '#7c3aed', desc: '전체 시스템 최고 관리자 · 모든 기능 접근 가능' },
  { label: '본사 (HQ)',               color: NAVY2,     desc: '총판 관리 및 수수료 배정', border: BLUE },
  { label: '총판 (Distributor)',       color: '#0369a1', desc: '대리점 관리 및 수수료 배정' },
  { label: '대리점 (Agency)',          color: '#0891b2', desc: '매장 관리 및 수수료 배정' },
  { label: '매장 (Store)',             color: '#0f766e', desc: '회원 관리 · 실제 수수료 적용 단위' },
  { label: '회원 (Member)',            color: '#e2e8f0', desc: '가상계좌 입출금 이용자 (관리자 아님)' },
];
const boxW = 200, boxH = 22;
const bx = ML + (CW - boxW) / 2;
roles.forEach((r, i) => {
  rect(bx, y, boxW, boxH, r.color, r.border || null, 5);
  const tc = r.color === '#e2e8f0' ? '#475569' : WHITE;
  doc.font('bold').fontSize(9).fillColor(tc).text(r.label, bx, y + 6, { width: boxW, align: 'center' });
  doc.font('reg').fontSize(7.5).fillColor(MUTED).text(r.desc, bx + boxW + 10, y + 7, { width: CW - boxW - 10 - (CW - boxW) / 2 });
  y += boxH;
  if (i < roles.length - 1) {
    doc.font('bold').fontSize(10).fillColor(BLUE).text('▼', bx, y, { width: boxW, align: 'center' });
    y += 14;
  }
});

h3('1.3 기본 접속 정보');
rect(ML, y, CW, 88, NAVY, null, 6);
doc.font('bold').fontSize(8).fillColor('#64748b').text('# 관리자 로그인 페이지', ML + 14, y + 10);
doc.font('reg').fontSize(8.5).fillColor(BLUE).text('URL          https://[도메인]/login', ML + 14, y + 22, { width: CW - 28 });
doc.save().moveTo(ML + 14, y + 36).lineTo(ML + CW - 14, y + 36).strokeColor('#1e293b').lineWidth(0.4).stroke().restore();
doc.font('bold').fontSize(8).fillColor('#64748b').text('# 기본 테스트 계정', ML + 14, y + 42);
doc.font('reg').fontSize(8.5).fillColor(BLUE).text('슈퍼어드민  superadmin / admin1234', ML + 14, y + 54, { width: CW - 28 });
doc.font('reg').fontSize(8.5).fillColor(BLUE).text('본사          hq_manager / password1       총판  distributor1 / password1       매장  store1 / password1', ML + 14, y + 66, { width: CW - 28 });
y += 98;
warnBox('⚠️ 운영 환경에서는 반드시 초기 비밀번호를 변경하세요. 기본 계정 정보 노출 시 보안 사고로 이어질 수 있습니다.');


// ═══════════════════════════════════════════════════════
// SECTION 02 — 로그인 및 내 계정
// ═══════════════════════════════════════════════════════
newPage();
y = 40;
sectionHeader('SECTION 02', '로그인 및 내 계정', '관리자 인증 · 프로필 관리 · OTP 보안 설정');

h3('2.1 관리자 로그인');
step(1, '로그인 페이지 접속', '브라우저에서 관리자 URL에 접속합니다. 로그인 성공 시 자동으로 대시보드로 이동합니다.');
step(2, '아이디 / 비밀번호 입력', '상위 관리자로부터 부여받은 아이디와 비밀번호를 입력합니다.');
step(3, 'OTP 인증 (활성화된 경우)', 'OTP가 활성화된 계정은 인증 앱(Google Authenticator 등)의 6자리 코드를 추가 입력해야 합니다.');

h3('2.2 내 계정 관리 (/profile)');
table(
  ['기능', '설명', '제한 사항'],
  [
    ['이름 수정', '자신의 표시 이름을 변경합니다', '본인만 가능'],
    ['비밀번호 변경', '현재 비밀번호 확인 후 새 비밀번호로 변경', '최소 6자 이상'],
    ['내 정보 조회', '역할, 권한, 상위 계정 정보 확인', '조회만 가능'],
    ['계정 삭제', '본인 계정 삭제 (복구 불가)', '자기 자신 삭제 불가'],
  ],
  [130, 220, 145]
);

h3('2.3 OTP 설정 (/otp)');
para('입금 확인 및 출금 처리 시 OTP 인증을 요구하도록 설정할 수 있습니다. 설정은 자신의 계정에만 적용됩니다.');
card2(
  '입금 OTP (depositOtpEnabled)',
  '활성화 시 입금 확인 처리 전 OTP 코드 입력이 필요합니다.',
  '출금 OTP (withdrawalOtpEnabled)',
  '활성화 시 출금 승인/반려 처리 전 OTP 코드 입력이 필요합니다.'
);
infoBox('ℹ️ OTP를 활성화하려면 Google Authenticator 등 TOTP 호환 인증 앱이 필요합니다. QR 코드 또는 시크릿 키로 앱에 등록하세요.');


// ═══════════════════════════════════════════════════════
// SECTION 03 — 대시보드
// ═══════════════════════════════════════════════════════
newPage();
y = 40;
sectionHeader('SECTION 03', '대시보드', '실시간 플랫폼 현황 · 오늘의 통계 · 월간 요약');

h3('3.1 오늘의 현황 카드');
para('대시보드 상단에는 오늘의 주요 지표를 한눈에 확인할 수 있는 요약 카드가 표시됩니다.');
card3([
  { title: '오늘 입금액', body: '당일 확인 완료된 입금 거래의 총 금액' },
  { title: '오늘 출금액', body: '당일 승인 완료된 출금 요청의 총 금액' },
  { title: '오늘 수수료', body: '당일 발생한 수수료 합계 (매장 수수료율 기준)' },
]);
card3([
  { title: '대기 중 출금', body: '현재 승인 대기 중인 출금 요청 건수 및 금액' },
  { title: '활성 가상계좌', body: '현재 활성 상태인 가상계좌 수' },
  { title: '총 회원 수', body: '플랫폼에 등록된 전체 회원 수' },
]);

h3('3.2 월간 통계');
para('이번 달 누적 입금액, 출금액, 수수료를 요약하여 표시합니다. 전월 대비 증감률도 함께 확인할 수 있습니다.');
infoBox('ℹ️ 대시보드 데이터는 실시간으로 반영됩니다. 입금 확인 또는 출금 승인 처리 즉시 수치가 업데이트됩니다.');

h3('3.3 메뉴 구성 전체 목록');
table(
  ['메뉴명', '경로', '설명'],
  [
    ['대시보드', '/dashboard', '오늘의 현황 및 월간 요약 통계'],
    ['출금 관리', '/withdrawals', '출금 요청 승인·반려 처리'],
    ['입출금 내역', '/transactions', '입금 확인 처리 및 거래 내역 조회'],
    ['충전금액 관리', '/balances', '잔액 현황 및 수동 입력'],
    ['회원 관리', '/members', '회원 생성·조회·상태 관리'],
    ['하부 조직 관리', '/users', '관리자 계정 생성 및 권한 설정'],
    ['수수료 설정', '/fees', '계층별 수수료 배정'],
    ['일자별 통계', '/statistics', '일자별 거래 차트 및 데이터'],
    ['공지사항', '/notices', '공지 작성·수정·삭제'],
    ['OTP 설정', '/otp', '입출금 OTP 인증 설정'],
    ['내 계정', '/profile', '프로필 및 비밀번호 관리'],
  ],
  [120, 100, 275]
);


// ═══════════════════════════════════════════════════════
// SECTION 04 — 하부 조직 관리
// ═══════════════════════════════════════════════════════
newPage();
y = 40;
sectionHeader('SECTION 04', '하부 조직 관리 (사용자 관리)', '관리자 계정 생성 · 권한 설정 · 비밀번호 초기화');

h3('4.1 계정 생성');
para('자신의 바로 아래 단계 역할의 관리자 계정을 생성할 수 있습니다. 슈퍼어드민은 모든 역할을 생성 가능합니다.');
table(
  ['내 역할', '생성 가능한 하위 역할'],
  [
    ['슈퍼어드민', '본사·총판·대리점·매장 전체 생성 가능'],
    ['본사 (HQ)', '총판 계정 생성'],
    ['총판 (Distributor)', '대리점 계정 생성'],
    ['대리점 (Agency)', '매장 계정 생성'],
    ['매장 (Store)', '하위 계정 생성 불가'],
  ],
  [180, 315]
);
step(1, '하부 조직 관리 메뉴 이동', '좌측 사이드바에서 "하부 조직 관리"를 클릭합니다.');
step(2, '"새 계정 추가" 버튼 클릭', '우측 상단의 추가 버튼을 눌러 계정 생성 폼을 엽니다.');
step(3, '정보 입력 후 저장', '아이디, 이름, 비밀번호, 역할을 입력하고 저장합니다. 생성된 계정의 아이디/비밀번호를 해당 담당자에게 전달하세요.');

h3('4.2 권한 관리');
para('각 관리자 계정에 세부 권한을 부여할 수 있습니다. 권한 변경은 상위 관리자만 가능합니다.');
table(
  ['권한 유형', '설명'],
  [
    ['읽기 전용 (Read-only)', '조회만 가능, 데이터 수정 불가'],
    ['관리자 (Admin)', '전체 관리 기능 사용 가능'],
    ['재무 (Finance)', '입출금 처리 및 정산 관련 기능 접근'],
  ],
  [190, 305]
);
warnBox('⚠️ 자기 자신의 권한을 변경하거나, 자기 계정을 삭제하는 것은 불가합니다.');

h3('4.3 비밀번호 초기화');
para('하위 관리자의 비밀번호를 직접 초기화할 수 있습니다. 사용자 목록에서 해당 계정의 "비밀번호 초기화" 버튼을 클릭하고 새 비밀번호(최소 6자)를 입력합니다. 본인 계정 비밀번호는 내 계정 페이지에서 변경합니다.');


// ═══════════════════════════════════════════════════════
// SECTION 05 — 수수료 설정
// ═══════════════════════════════════════════════════════
newPage();
y = 40;
sectionHeader('SECTION 05', '수수료 설정', '계층별 수수료 배정 · 상한선 검증 · 마진 계산');

h3('5.1 수수료 계층 구조');
para('수수료는 상위 계층이 하위 계층에 배정하는 방식으로 동작합니다. 하위 계층은 상위에서 배정받은 수수료 이하로만 설정할 수 있으며, 실제 회원에게 적용되는 수수료는 매장 수수료율입니다.');

// fee flow
const nodes = [
  { label: '본사 배정', val: '1.0%', color: NAVY2, tc: BLUE },
  { label: '총판 설정', val: '0.5%', color: '#0369a1', tc: WHITE },
  { label: '대리점 설정', val: '0.3%', color: '#0891b2', tc: WHITE },
  { label: '매장 설정', val: '0.2%', color: '#0f766e', tc: WHITE },
  { label: '회원 납부', val: '0.2%', color: '#7c3aed', tc: WHITE },
];
const nodeW = 80, nodeH = 36, nodeGap = 20;
const totalFW = nodes.length * nodeW + (nodes.length - 1) * nodeGap;
let fx = ML + (CW - totalFW) / 2;
nodes.forEach((n, i) => {
  rect(fx, y, nodeW, nodeH, n.color, null, 6);
  doc.font('reg').fontSize(7).fillColor(n.tc === WHITE ? '#94a3b8' : n.tc).text(n.label, fx, y + 6, { width: nodeW, align: 'center' });
  doc.font('bold').fontSize(11).fillColor(n.tc).text(n.val, fx, y + 16, { width: nodeW, align: 'center' });
  if (i < nodes.length - 1) {
    doc.font('bold').fontSize(10).fillColor(BLUE).text('→', fx + nodeW, y + 12, { width: nodeGap, align: 'center' });
  }
  fx += nodeW + nodeGap;
});
y += nodeH + 14;

h3('5.2 수수료 설정 방법');
step(1, '수수료 설정 메뉴 이동', '좌측 메뉴에서 "수수료 설정"을 클릭합니다.');
step(2, '대상 역할 탭 선택', '상단 탭(본사/총판/대리점/매장)에서 수수료를 설정할 역할을 선택합니다.');
step(3, '수수료 입력', '각 계정 행의 입금/출금 수수료 입력란에 % 값을 입력합니다. 상위 배정 수수료(상한선)가 표시되며, 초과 시 저장이 거부됩니다.');
step(4, '저장', '저장 버튼을 클릭하면 즉시 적용됩니다. 변경 시 이미 처리된 거래의 수수료에는 소급 적용되지 않습니다.');

h3('5.3 마진 계산');
table(
  ['항목', '설명', '예시'],
  [
    ['상위 배정 (상한)', '상위 계층에서 배정한 최대 수수료', '1.0%'],
    ['내 설정', '하위에 배정하는 수수료', '0.5%'],
    ['마진', '상위배정 − 내설정 = 내 수익', '0.5%'],
  ],
  [150, 245, 100]
);
infoBox('ℹ️ 수수료를 미설정한 계층이 있으면 상한선 검증이 생략됩니다. 운영 전 전체 계층의 수수료를 반드시 설정하세요.');
dangerBox('🚫 하위 계정에 상위보다 높은 수수료 설정 시 서버에서 오류를 반환하며 저장되지 않습니다.');


// ═══════════════════════════════════════════════════════
// SECTION 06 — 회원 관리
// ═══════════════════════════════════════════════════════
newPage();
y = 40;
sectionHeader('SECTION 06', '회원 관리', '회원 등록 · 가상계좌 발급 · 상태 관리');

h3('6.1 회원 등록');
para('회원은 두 가지 방법으로 등록됩니다.');
card2(
  '방법 1 · 관리자 직접 등록',
  '회원 관리 메뉴 → "회원 추가" 버튼 → 이름, 연락처, 은행 계좌 정보 입력 후 저장. 등록 완료 즉시 가상계좌가 자동 발급됩니다.',
  '방법 2 · 셀프 등록 링크',
  '회원 관리 메뉴의 "등록 링크 복사" 버튼으로 링크를 복사해 회원에게 전달. 회원이 직접 정보를 입력하고 등록합니다.'
);

h3('6.2 가상계좌 발급');
para('회원 등록 시 전용 가상계좌가 자동 발급됩니다. 기존 계좌 폐기 후 재발급이 필요한 경우 아래와 같이 처리합니다.');
step(1, '회원 목록에서 대상 회원 선택', '회원 관리 페이지에서 가상계좌를 재발급할 회원을 찾습니다.');
step(2, '"가상계좌 재발급" 버튼 클릭', '해당 회원 행의 재발급 버튼을 클릭합니다. 이전 가상계좌는 즉시 비활성화됩니다.');
warnBox('⚠️ 가상계좌 재발급 시 기존 계좌번호로 입금된 금액은 자동 매핑되지 않으므로 주의하세요.');

h3('6.3 회원 상태 관리');
table(
  ['상태', '설명', '처리'],
  [
    ['활성 (Active)', '정상 이용 가능 상태', '입출금 요청 허용'],
    ['비활성 (Inactive)', '일시 이용 중지 상태', '입출금 요청 차단, 로그인 차단'],
  ],
  [130, 200, 165]
);
para('회원 목록의 상태 토글 버튼으로 즉시 활성/비활성 전환이 가능합니다.');

h3('6.4 회원 정보 수정 및 삭제');
table(
  ['기능', '설명', '주의사항'],
  [
    ['정보 수정', '이름, 연락처, 은행 계좌 정보 수정 가능', '수정 즉시 반영'],
    ['삭제', '회원 계정 완전 삭제', '복구 불가 · 거래 내역은 유지'],
  ],
  [120, 230, 145]
);


// ═══════════════════════════════════════════════════════
// SECTION 07 — 입출금 내역
// ═══════════════════════════════════════════════════════
newPage();
y = 40;
sectionHeader('SECTION 07', '입출금 내역 (거래 내역)', '입금 확인 처리 · 거래 조회 · 수수료 확인');

h3('7.1 입금 확인 처리');
para('회원이 가상계좌로 입금 요청을 하면 "대기 중 입금" 목록에 표시됩니다. 실제 입금 확인 후 처리해야 회원 잔액에 반영됩니다.');
step(1, '입출금 내역 메뉴 이동', '좌측 메뉴에서 "입출금 내역"을 클릭합니다. 상단에 대기 중 입금 목록이 표시됩니다.');
step(2, '실제 입금 확인', '은행 또는 가상계좌 시스템에서 해당 금액이 실제로 입금되었는지 확인합니다.');
step(3, '"입금 확인" 버튼 클릭', '확인 버튼을 누르면 수수료가 자동 차감되고 순 금액이 회원 잔액에 반영됩니다.');
infoBox('ℹ️ 입금 처리 시 매장에 설정된 입금 수수료율이 자동 적용됩니다.\n예) 입금액 100,000원, 수수료 0.2% → 수수료 200원 차감 → 순 입금 99,800원');

h3('7.2 거래 내역 조회');
table(
  ['필터', '설명'],
  [
    ['거래 유형', '입금 / 출금 유형별 필터링'],
    ['날짜 범위', '시작일~종료일 지정으로 기간 조회'],
    ['검색', '추적 번호 또는 계좌번호로 검색'],
  ],
  [150, 345]
);
para('각 거래 행에서 원래 금액(수수료 차감 전), 순 금액, 적용된 수수료를 확인할 수 있습니다.');

h3('7.3 거래 상태 구분');
table(
  ['상태', '설명'],
  [
    ['대기 중 (Pending)', '회원이 입금 요청했지만 아직 관리자 확인 전'],
    ['확인 완료 (Confirmed)', '관리자가 입금 확인 처리 완료, 잔액에 반영됨'],
  ],
  [160, 335]
);


// ═══════════════════════════════════════════════════════
// SECTION 08 — 출금 관리
// ═══════════════════════════════════════════════════════
newPage();
y = 40;
sectionHeader('SECTION 08', '출금 관리', '출금 요청 승인/반려 · 현황 조회');

h3('8.1 출금 승인 / 반려');
para('회원이 출금 요청을 제출하면 관리자 검토 후 승인 또는 반려할 수 있습니다. 대기 중 건수가 사이드바 배지로 표시됩니다.');
step(1, '출금 관리 메뉴 이동', '좌측 메뉴의 "출금 관리"를 클릭합니다. 대기 중인 출금 요청 건수가 배지로 표시됩니다.');
step(2, '요청 내용 확인', '출금 금액, 회원 정보, 출금 계좌 정보, 요청 시각을 확인합니다.');
step(3, '승인 또는 반려 처리', '승인 시: 수수료 차감 후 잔액에서 출금 금액이 차감됩니다. 반려 시: 반려 사유를 입력하면 이력에 기록됩니다.');
infoBox('ℹ️ 출금 처리 시 매장에 설정된 출금 수수료율이 자동 적용됩니다.\n예) 출금 요청 50,000원, 수수료 0.1% → 수수료 50원 차감 → 실 지급 49,950원');

h3('8.2 출금 상태 구분');
table(
  ['상태', '설명', '처리 가능 액션'],
  [
    ['대기 중 (Pending)', '회원이 출금 요청, 관리자 검토 대기', '승인 / 반려'],
    ['승인 (Approved)', '관리자가 승인 완료, 잔액 차감됨', '없음 (처리 완료)'],
    ['반려 (Rejected)', '관리자가 반려, 사유 기록', '없음 (처리 완료)'],
  ],
  [140, 200, 155]
);

h3('8.3 출금 현황 요약');
card3([
  { title: '대기 건수 / 금액', body: '현재 승인 대기 중인 요청의 건수와 총 금액' },
  { title: '승인 건수 / 금액', body: '처리 완료된 승인 요청의 누적 건수와 금액' },
  { title: '반려 건수', body: '반려 처리된 요청 건수 (날짜 필터 적용 가능)' },
]);
para('상단 요약 카드에서 대기 중, 승인된 현황을 한눈에 확인하고, 날짜 및 상태별 필터로 내역을 상세 조회할 수 있습니다.');


// ═══════════════════════════════════════════════════════
// SECTION 09 — 충전금액 관리
// ═══════════════════════════════════════════════════════
newPage();
y = 40;
sectionHeader('SECTION 09', '충전금액 관리', '잔액 현황 · 수동 입력 · 이력 조회');

h3('9.1 잔액 현황');
card3([
  { title: '현재 잔액', body: '현재 시점의 총 누적 잔액' },
  { title: '대기 금액', body: '승인되었으나 아직 지급 처리되지 않은 출금 금액' },
  { title: '가용 잔액', body: '현재 잔액 − 대기 금액 = 실제 사용 가능 금액' },
]);

h3('9.2 수동 입력');
para('외부 입금, 정산 오류 정정 등 수동으로 잔액을 조정해야 할 경우 "수동 입력" 기능을 사용합니다.');
table(
  ['분류', '설명'],
  [
    ['충전 (Charge)', '잔액 증가 처리 — 외부 입금을 수동으로 반영할 때'],
    ['조정 (Adjustment)', '오류 정정 등 잔액을 수동 보정할 때'],
    ['지급 (Payment)', '잔액 차감 처리 — 외부 지급을 수동으로 반영할 때'],
  ],
  [150, 345]
);
dangerBox('🚫 수동 입력은 잔액에 즉시 반영되며 취소가 불가합니다. 금액과 분류를 반드시 재확인 후 처리하세요.');

h3('9.3 잔액 이력 조회');
para('충전금액 관리 하단에는 모든 잔액 변동 이력이 시간 순으로 표시됩니다. 각 이력에는 변동 유형, 금액, 처리 후 잔액이 기록됩니다.');
table(
  ['이력 유형', '발생 시점'],
  [
    ['입금 확인', '입출금 내역에서 입금 확인 처리 시'],
    ['출금 승인', '출금 관리에서 출금 승인 처리 시'],
    ['수동 조정', '충전금액 관리의 수동 입력 처리 시'],
  ],
  [170, 325]
);


// ═══════════════════════════════════════════════════════
// SECTION 10 — 일자별 통계
// ═══════════════════════════════════════════════════════
newPage();
y = 40;
sectionHeader('SECTION 10', '일자별 통계', '거래량 추이 차트 · 일별 데이터 테이블');

h3('10.1 통계 차트');
para('일자별 통계 페이지는 기간 내 거래 데이터를 시각화하여 트렌드를 파악합니다.');
card2(
  '거래 금액 추이',
  '날짜별 입금액/출금액을 라인 차트로 표시. 금액 변동 흐름 파악에 유용합니다.',
  '거래 건수 추이',
  '날짜별 입금/출금 건수를 차트로 표시. 거래 빈도 및 피크 타임 확인에 유용합니다.'
);

h3('10.2 날짜 범위 설정');
para('기본 조회 기간은 최근 30일입니다. 달력 UI를 통해 시작일과 종료일을 직접 설정할 수 있습니다.');

h3('10.3 일별 데이터 테이블');
table(
  ['컬럼', '설명'],
  [
    ['날짜', '해당 날짜 (YYYY-MM-DD)'],
    ['입금 건수', '확인 완료된 입금 거래 수'],
    ['입금 금액', '확인 완료된 입금 총액'],
    ['출금 건수', '승인 완료된 출금 거래 수'],
    ['출금 금액', '승인 완료된 출금 총액'],
    ['수수료', '해당 일 발생 총 수수료'],
    ['순 금액', '입금 − 출금 − 수수료'],
  ],
  [160, 335]
);


// ═══════════════════════════════════════════════════════
// SECTION 11 — 공지사항
// ═══════════════════════════════════════════════════════
newPage();
y = 40;
sectionHeader('SECTION 11', '공지사항', '공지 작성 · 핀 고정 · 수정 및 삭제');

h3('11.1 공지 작성');
step(1, '공지사항 메뉴 이동', '좌측 메뉴에서 "공지사항"을 클릭합니다.');
step(2, '"새 공지 작성" 클릭', '우측 상단 버튼을 클릭하여 작성 폼을 엽니다.');
step(3, '제목과 내용 입력 후 저장', '"상단 고정" 옵션을 체크하면 목록 최상단에 고정됩니다. 저장 즉시 목록에 반영됩니다.');

h3('11.2 공지 관리 기능');
table(
  ['기능', '설명'],
  [
    ['상단 고정 (핀)', '공지를 목록 최상단에 고정 표시. 중요 공지에 사용'],
    ['수정', '작성된 공지의 제목/내용 수정. 수정 즉시 반영'],
    ['삭제', '공지 영구 삭제 (복구 불가)'],
  ],
  [160, 335]
);
infoBox('ℹ️ 상단 고정 공지가 여러 개인 경우 최신 순으로 정렬됩니다. 과도한 고정은 일반 공지 가독성을 저하시킬 수 있습니다.');


// ═══════════════════════════════════════════════════════
// SECTION 12 — 역할별 접근 권한 요약
// ═══════════════════════════════════════════════════════
newPage();
y = 40;
sectionHeader('SECTION 12', '역할별 메뉴 접근 권한 요약', '슈퍼어드민 · 본사 · 총판 · 대리점 · 매장별 기능 범위');

const permRows = [
  ['대시보드',          '✓','✓','✓','✓','✓'],
  ['입출금 내역 조회',  '✓','✓','✓','✓','✓'],
  ['입금 확인 처리',    '✓','✓','✓','✓','✓'],
  ['출금 승인/반려',    '✓','✓','✓','✓','✓'],
  ['충전금액 관리',     '✓','✓','✓','✓','✓'],
  ['회원 관리',         '✓','✓','✓','✓','✓'],
  ['하부 조직 관리',    '✓','✓','✓','✓','—'],
  ['수수료 설정',       '✓','✓','✓','✓','✓'],
  ['본사 수수료 조회',  '✓','—','—','—','—'],
  ['일자별 통계',       '✓','✓','✓','✓','✓'],
  ['공지사항',          '✓','✓','✓','✓','✓'],
  ['OTP 설정',          '✓','✓','✓','✓','✓'],
  ['내 계정',           '✓','✓','✓','✓','✓'],
  ['하위 계정 생성',    '✓','✓','✓','✓','—'],
  ['전체 사용자 조회',  '✓','—','—','—','—'],
];
// custom table with colored header roles
const pcw = [175, 70, 60, 60, 65, 65]; // col widths sum = 495
const pcTotal = pcw.reduce((a, b) => a + b, 0);
const roleColors = ['#7c3aed', NAVY2, '#0369a1', '#0891b2', '#0f766e'];
const roleLabels = ['슈퍼어드민', '본사', '총판', '대리점', '매장'];

// header row
rect(ML, y, pcTotal, 24, NAVY2, null);
doc.font('bold').fontSize(8.5).fillColor(WHITE).text('메뉴 / 기능', ML + 6, y + 7, { width: pcw[0] - 8 });
let hx = ML + pcw[0];
roleLabels.forEach((rl, i) => {
  doc.save().rect(hx, y, pcw[i + 1], 24).fillColor(roleColors[i]).fillOpacity(0.85).fill().restore();
  doc.font('bold').fontSize(8).fillColor(WHITE).text(rl, hx, y + 8, { width: pcw[i + 1], align: 'center' });
  hx += pcw[i + 1];
});
y += 24;

permRows.forEach((row, ri) => {
  const bg = ri % 2 === 0 ? WHITE : LIGHT_BG;
  rect(ML, y, pcTotal, 18, bg, null);
  doc.save().moveTo(ML, y + 18).lineTo(ML + pcTotal, y + 18).strokeColor(BORDER).lineWidth(0.3).stroke().restore();
  doc.font('reg').fontSize(8.5).fillColor(TEXT).text(row[0], ML + 6, y + 4, { width: pcw[0] - 8 });
  let cx2 = ML + pcw[0];
  for (let i = 1; i < 6; i++) {
    const val = row[i];
    const color = val === '✓' ? '#16a34a' : '#dc2626';
    doc.font('bold').fontSize(9).fillColor(color).text(val, cx2, y + 4, { width: pcw[i], align: 'center' });
    cx2 += pcw[i];
  }
  y += 18;
});
y += 16;

// footer
rect(ML, y, CW, 50, LIGHT_BG, BORDER, 6);
doc.font('bold').fontSize(9).fillColor(NAVY2).text('문의 및 지원', ML + 14, y + 10);
doc.font('reg').fontSize(8.5).fillColor(MUTED).text('이 문서에 대한 문의사항은 슈퍼어드민 또는 시스템 운영팀에 문의하세요.', ML + 14, y + 24, { width: CW - 28 });
doc.font('reg').fontSize(7.5).fillColor('#94a3b8').text('© 2026 TodoPay Financial Operations · Administrator Guide v1.0 · CONFIDENTIAL', ML + 14, y + 38, { width: CW - 28 });

doc.end();
doc.on('finish', () => console.log('✅ PDF generated:', OUT));
doc.on('error', e => { console.error('❌ error:', e.message); process.exit(1); });
