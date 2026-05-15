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
const PAGE_BOTTOM = H - 55; // safe drawing area bottom (786px)

function newPage() {
  doc.addPage();
  y = 40;
}

// Ensure at least `needed` px remains on current page; if not, start new page.
function ensureSpace(needed) {
  if (y + needed > PAGE_BOTTOM) newPage();
}

function text(str, opts = {}) {
  const { x = ML, width = CW, font = 'reg', size = 10, color = TEXT, align = 'left', moveDown = 0 } = opts;
  const needed = doc.font(font).fontSize(size).heightOfString(str, { width }) + 4;
  ensureSpace(needed);
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
  // section headers always start on their own page — no overflow check needed
  rect(ML, y, CW, 70, NAVY2, null, 8);
  doc.save().circle(ML + CW - 30, y + 20, 28).fillColor(BLUE).fillOpacity(0.08).fill().restore();
  doc.font('bold').fontSize(8).fillColor(BLUE).text(num, ML + 14, y + 10, { width: CW - 20 });
  doc.font('bold').fontSize(16).fillColor(WHITE).text(title, ML + 14, y + 22, { width: CW - 60 });
  doc.font('reg').fontSize(9).fillColor('#94a3b8').text(desc, ML + 14, y + 44, { width: CW - 60 });
  y += 84;
}

function h3(str) {
  ensureSpace(50);
  y += 16;
  rect(ML, y, 4, 16, BLUE, null);
  doc.font('bold').fontSize(12).fillColor(NAVY2).text(str, ML + 10, y + 1, { width: CW - 10 });
  y = doc.y + 8;
}

function h4(str) {
  ensureSpace(30);
  y += 8;
  doc.font('bold').fontSize(10).fillColor('#334155').text(str, ML, y, { width: CW });
  y = doc.y + 4;
}

function para(str, color = SLATE) {
  const needed = doc.font('reg').fontSize(9.5).heightOfString(str, { width: CW }) + 6;
  ensureSpace(needed);
  doc.font('reg').fontSize(9.5).fillColor(color).text(str, ML, y, { width: CW, lineBreak: true });
  y = doc.y + 6;
}

function infoBox(str, bg = INFO_BG, tc = INFO_TXT, border = '#3b82f6') {
  const measured = doc.font('reg').fontSize(9).heightOfString(str, { width: CW - 40 });
  const bh = measured + 22;
  ensureSpace(bh + 8);
  rect(ML, y, 4, bh, border, null);
  rect(ML + 4, y, CW - 4, bh, bg, null);
  doc.font('reg').fontSize(9).fillColor(tc).text(str, ML + 14, y + 10, { width: CW - 30, lineBreak: true });
  y += bh + 8;
}

function warnBox(str) { infoBox(str, WARN_BG, WARN_TXT, '#eab308'); }
function dangerBox(str) { infoBox(str, DANGER_BG, DANGER_TXT, '#ef4444'); }

function step(num, title, desc) {
  const descH = doc.font('reg').fontSize(9).heightOfString(desc, { width: CW - 24 });
  ensureSpace(descH + 30);
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

  // Pre-calculate all row heights
  const rowHeights = rows.map(row =>
    row.reduce((max, cell, ci) => {
      const h = doc.font('reg').fontSize(8.5).heightOfString(String(cell), { width: colWidths[ci] - 8 });
      return Math.max(max, h + 10);
    }, TD)
  );
  const totalH = TH + rowHeights.reduce((a, b) => a + b, 0) + 10;

  // If the whole table fits on remaining page, draw it; otherwise start new page
  // For very tall tables, we still start a new page and let it overflow naturally
  ensureSpace(Math.min(totalH, PAGE_BOTTOM - 80));

  rect(ML, y, totalW, TH, NAVY2, null, 0);
  let cx = ML;
  headers.forEach((h, i) => {
    doc.font('bold').fontSize(8.5).fillColor(WHITE).text(h, cx + 6, y + 5, { width: colWidths[i] - 8 });
    cx += colWidths[i];
  });
  y += TH;
  rows.forEach((row, ri) => {
    const rowH = rowHeights[ri];
    // Mid-table page break: if a row won't fit, move to new page and redraw header
    if (y + rowH > PAGE_BOTTOM) {
      newPage();
      rect(ML, y, totalW, TH, NAVY2, null, 0);
      let hx = ML;
      headers.forEach((h, i) => {
        doc.font('bold').fontSize(8.5).fillColor(WHITE).text(h, hx + 6, y + 5, { width: colWidths[i] - 8 });
        hx += colWidths[i];
      });
      y += TH;
    }
    const bg = ri % 2 === 0 ? WHITE : LIGHT_BG;
    rect(ML, y, totalW, rowH, bg, null);
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
  ensureSpace(ch + 10);
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
  ensureSpace(ch + 10);
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

rect(0, 0, W, H, NAVY, null);
doc.save().circle(W - 40, 60, 180).fillColor(BLUE).fillOpacity(0.05).fill().restore();
doc.save().circle(60, H - 80, 130).fillColor(BLUE).fillOpacity(0.04).fill().restore();
rect(ML, H / 2 - 80, 3, 160, BLUE, null);

doc.font('bold').fontSize(42).fillColor(BLUE).text('TODO PAY', ML + 20, H / 2 - 130, { width: CW, align: 'center' });
doc.font('reg').fontSize(11).fillColor('#64748b').text('FINANCIAL OPERATIONS', ML, H / 2 - 78, { width: CW, align: 'center', characterSpacing: 4 });
doc.save().moveTo(W / 2 - 40, H / 2 - 48).lineTo(W / 2 + 40, H / 2 - 48).strokeColor(BLUE).lineWidth(1).stroke().restore();
doc.font('bold').fontSize(22).fillColor(WHITE).text('관리자 전체 기능 가이드', ML, H / 2 - 30, { width: CW, align: 'center' });
doc.font('reg').fontSize(10).fillColor('#64748b').text('Administrator Complete Function Guide · v1.1', ML, H / 2 + 6, { width: CW, align: 'center' });
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
  { num: '03', title: '대시보드', subs: ['오늘의 현황 카드', '월간 통계', '메뉴 구성'] },
  { num: '04', title: '하부 조직 관리 (사용자 관리)', subs: ['계정 생성', '권한 관리', '비밀번호 초기화'] },
  { num: '05', title: '수수료 설정', subs: ['수수료 종류', '계층 구조 및 마진 계산', '설정 방법'] },
  { num: '06', title: '회원 관리', subs: ['회원 등록', '가상계좌 발급', '상태 관리'] },
  { num: '07', title: '거래 내역 (구매 처리)', subs: ['구매 확인 처리', '수수료 계산 흐름', '거래 내역 조회'] },
  { num: '08', title: '출금 관리 (매장 출금)', subs: ['출금 신청 흐름', '승인 / 반려', '출금 가능 시간'] },
  { num: '09', title: '잔액 관리', subs: ['매장 잔액 (Store)', '수수료 수익 잔액', '수동 입력'] },
  { num: '10', title: '일자별 통계', subs: ['통계 차트', '일별 데이터 테이블'] },
  { num: '11', title: '공지사항', subs: ['공지 작성', '핀 고정 및 관리'] },
  { num: '12', title: '역할별 메뉴 접근 권한 요약', subs: [] },
];

tocItems.forEach(item => {
  rect(ML, y, CW, 22, LIGHT_BG, null, 3);
  doc.font('bold').fontSize(9.5).fillColor(NAVY2).text(`${item.num}. ${item.title}`, ML + 10, y + 6, { width: CW - 60 });
  y += 22;
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
para('TodoPay는 가상계좌 기반 구매 처리 및 매장 정산 관리를 위한 다단계 핀테크 어드민 플랫폼입니다. 슈퍼어드민부터 매장까지 5단계 계층 구조로 운영되며, 회원이 가상계좌로 구매금액을 전액 입금하면 매장이 플랫폼 이용 수수료를 부담하고, 수수료 차감 후의 순 금액이 매장 잔액에 적립됩니다. 매장은 적립된 잔액을 출금 신청하여 정산받습니다.');
y += 4;
card3([
  { title: '가상계좌 발급', body: '회원별 전용 가상계좌를 발급하여 구매 입금 자동 추적 및 매핑' },
  { title: '구매 확인 처리', body: '관리자가 입금 확인 후 수수료 차감 → 매장 잔액 자동 적립' },
  { title: '다단계 조직', body: '5단계 계층 관리자 구조로 하위 조직 생성 및 권한 제어' },
]);
card3([
  { title: '수수료 계층 배분', body: '입금수수료(정액) + 이용수수료율(%)로 계층별 마진 자동 정산' },
  { title: '매장 출금 관리', body: '매장이 적립 잔액에서 출금 신청 → 관리자 승인 후 익일 정산' },
  { title: '통계 & 리포트', body: '일자별 구매액, 수수료, 매장 잔액 변동 추이 시각화' },
]);

h3('1.2 관리자 계층 구조');
const roles = [
  { label: '슈퍼어드민 (Superadmin)', color: '#7c3aed', desc: '전체 시스템 최고 관리자 · 모든 기능 접근 가능' },
  { label: '본사 (HQ)',               color: NAVY2,     desc: '총판 관리 및 이용수수료율 배정', border: BLUE },
  { label: '총판 (Distributor)',       color: '#0369a1', desc: '대리점 관리 및 이용수수료율 배정' },
  { label: '대리점 (Agency)',          color: '#0891b2', desc: '매장 관리 및 이용수수료율 배정' },
  { label: '매장 (Store)',             color: '#0f766e', desc: '회원 관리 · 구매 확인 처리 · 출금 신청 단위' },
  { label: '회원 (Member)',            color: '#e2e8f0', desc: '가상계좌로 구매금액 입금 이용자 (관리자 아님)' },
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
rect(ML, y, CW, 100, NAVY, null, 6);
doc.font('bold').fontSize(8).fillColor('#64748b').text('# 관리자 로그인 페이지', ML + 14, y + 10);
doc.font('reg').fontSize(8.5).fillColor(BLUE).text('URL          https://[도메인]/login', ML + 14, y + 22, { width: CW - 28 });
doc.save().moveTo(ML + 14, y + 36).lineTo(ML + CW - 14, y + 36).strokeColor('#1e293b').lineWidth(0.4).stroke().restore();
doc.font('bold').fontSize(8).fillColor('#64748b').text('# 테스트 계정', ML + 14, y + 42);
doc.font('reg').fontSize(8.5).fillColor(BLUE).text('슈퍼어드민   superadmin / admin1234', ML + 14, y + 54, { width: CW - 28 });
doc.font('reg').fontSize(8.5).fillColor(BLUE).text('본사         hq01 / test1234', ML + 14, y + 66, { width: CW - 28 });
doc.font('reg').fontSize(8.5).fillColor(BLUE).text('총판         dist01 / test1234          대리점  agency01 / test1234          매장  store01 / test1234', ML + 14, y + 78, { width: CW - 28 });
y += 112;
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
  ],
  [130, 220, 145]
);

h3('2.3 OTP 설정 (/otp)');
para('구매 확인 및 출금 처리 시 OTP 인증을 요구하도록 설정할 수 있습니다. 설정은 자신의 계정에만 적용됩니다.');
card2(
  '구매 OTP (depositOtpEnabled)',
  '활성화 시 구매 확인 처리 전 OTP 코드 입력이 필요합니다.',
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
  { title: '오늘 구매액', body: '당일 구매 확인 완료된 거래의 총 원금액 (수수료 차감 전)' },
  { title: '오늘 출금액', body: '당일 승인 완료된 매장 출금 요청의 총 금액' },
  { title: '오늘 수수료', body: '당일 발생한 수수료 합계 (입금수수료 + 이용수수료)' },
]);
card3([
  { title: '대기 중 출금', body: '현재 승인 대기 중인 매장 출금 요청 건수 및 금액' },
  { title: '활성 가상계좌', body: '현재 활성 상태인 회원 가상계좌 수' },
  { title: '총 회원 수', body: '플랫폼에 등록된 전체 회원 수' },
]);

h3('3.2 월간 통계');
para('이번 달 누적 구매액, 출금액, 수수료를 요약하여 표시합니다.');
infoBox('ℹ️ 대시보드 데이터는 실시간으로 반영됩니다. 구매 확인 또는 출금 승인 처리 즉시 수치가 업데이트됩니다.');

h3('3.3 메뉴 구성 전체 목록');
table(
  ['메뉴명', '경로', '설명'],
  [
    ['대시보드', '/dashboard', '오늘의 현황 및 월간 요약 통계'],
    ['출금 관리', '/withdrawals', '매장 출금 요청 승인·반려 처리'],
    ['거래 내역', '/transactions', '구매 확인 처리 및 거래 내역 조회'],
    ['잔액 관리', '/balances', '수수료 수익 잔액 현황 및 수동 입력'],
    ['회원 관리', '/members', '회원 생성·조회·상태 관리'],
    ['하부 조직 관리', '/users', '관리자 계정 생성 및 권한 설정'],
    ['수수료 설정', '/fees', '계층별 수수료 배정'],
    ['일자별 통계', '/statistics', '일자별 거래 차트 및 데이터'],
    ['공지사항', '/notices', '공지 작성·수정·삭제'],
    ['OTP 설정', '/otp', '구매/출금 OTP 인증 설정'],
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
    ['재무 (Finance)', '구매 확인·출금 처리 및 정산 관련 기능 접근'],
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
sectionHeader('SECTION 05', '수수료 설정', '수수료 종류 · 계층 배분 구조 · 설정 방법');

h3('5.1 수수료 종류');
para('TodoPay의 수수료는 모두 매장이 플랫폼 이용 대가로 부담합니다. 회원은 구매금액을 전액 입금하며, 수수료는 매장 잔액에서 차감됩니다. 세 가지 유형이 독립적으로 설정됩니다.');
table(
  ['수수료 종류', '단위', '설명 (부담 주체: 매장)', '적용 시점'],
  [
    ['입금수수료', '원 (정액)', '구매 1건당 매장이 부담하는 고정 수수료. 구매금액에서 차감 후 순 금액이 매장 잔액 적립', '구매 확인 처리 시'],
    ['이용수수료율', '% (비율)', '구매금액 × 요율 만큼 매장이 부담. 계층별 마진으로 자동 배분', '구매 확인 처리 시'],
    ['출금수수료', '원 (정액)', '매장 출금 1건당 매장이 부담하는 고정 수수료. 실지급액에서 차감', '매장 출금 신청 시'],
  ],
  [110, 75, 205, 105]
);
infoBox('ℹ️ 수수료는 매장이 이 서비스를 이용하는 대가로 부담합니다. 회원은 구매금액을 그대로 입금하며, 매장에 적립되는 금액은 구매금액 − 수수료 합계입니다. 매장에 수수료가 설정되지 않은 경우 0원/0%가 적용됩니다.');

h3('5.2 이용수수료율 계층 배분 구조');
para('이용수수료율은 하위 계층으로 갈수록 높아지는 구조입니다. 매장이 플랫폼 이용 대가로 부담하는 요율은 매장(Store)에 설정된 이용수수료율이며, 각 계층은 자신의 상위보다 낮게 설정할 수 없습니다. 구매 확인 시 하위 요율과 상위 요율의 차이(마진)가 각 상위 계층의 수익으로 자동 배분됩니다.');

const nodes = [
  { label: '본사 설정', val: '1.0%', color: NAVY2, tc: BLUE },
  { label: '총판 설정', val: '1.5%', color: '#0369a1', tc: WHITE },
  { label: '대리점 설정', val: '2.0%', color: '#0891b2', tc: WHITE },
  { label: '매장 설정', val: '3.0%', color: '#0f766e', tc: WHITE },
  { label: '매장 부담', val: '3.0%', color: '#7c3aed', tc: WHITE },
];
const nodeW = 85, nodeH = 36, nodeGap = 14;
const totalFW = nodes.length * nodeW + (nodes.length - 1) * nodeGap;
let fx = ML + (CW - totalFW) / 2;
nodes.forEach((n, i) => {
  rect(fx, y, nodeW, nodeH, n.color, null, 6);
  doc.font('reg').fontSize(7).fillColor(n.tc === WHITE ? '#94a3b8' : n.tc).text(n.label, fx, y + 6, { width: nodeW, align: 'center' });
  doc.font('bold').fontSize(10).fillColor(n.tc).text(n.val, fx, y + 17, { width: nodeW, align: 'center' });
  if (i < nodes.length - 1) {
    doc.font('bold').fontSize(10).fillColor(BLUE).text('→', fx + nodeW, y + 12, { width: nodeGap, align: 'center' });
  }
  fx += nodeW + nodeGap;
});
y += nodeH + 14;

h4('수수료 부담 및 마진 배분 예시 (구매금액 100,000원, 입금수수료 500원, 매장 이용수수료율 3%)');
para('회원은 100,000원 전액 입금. 매장이 수수료 3,500원(입금수수료 500원 + 이용수수료 3,000원)을 부담하며, 매장 잔액에는 96,500원이 적립됩니다. 이용수수료 3,000원은 아래와 같이 각 상위 계층에 자동 배분됩니다.', SLATE);
table(
  ['수익 계층', '설정 요율', '마진율 계산', '배분 수익'],
  [
    ['대리점', '2.0%', '매장(3%) − 대리점(2%) = 1.0%', '100,000 × 1.0% = 1,000원 자동 배분'],
    ['총판', '1.5%', '대리점(2%) − 총판(1.5%) = 0.5%', '100,000 × 0.5% = 500원 자동 배분'],
    ['본사', '1.0%', '총판(1.5%) − 본사(1%) = 0.5%', '100,000 × 0.5% = 500원 자동 배분'],
    ['본사(최상위)', '—', '본사 요율 1.0% 잔여', '100,000 × 1.0% = 1,000원 귀속'],
  ],
  [80, 80, 160, 175]
);
infoBox('ℹ️ 매장 잔액 적립 계산식:\n매장 적립액 = 구매금액 − 입금수수료 − (구매금액 × 매장 이용수수료율)\n= 100,000 − 500 − 3,000 = 96,500원\n\n수수료 부담 주체는 매장입니다. 회원은 구매금액을 그대로 입금합니다.');

h3('5.3 수수료 설정 방법');
step(1, '수수료 설정 메뉴 이동', '좌측 메뉴에서 "수수료 설정"을 클릭합니다.');
step(2, '대상 역할 탭 선택', '상단 탭(본사/총판/대리점/매장)에서 수수료를 설정할 역할을 선택합니다.');
step(3, '수수료 입력', '입금수수료(원), 이용수수료율(%), 출금수수료(원)를 각 항목에 입력합니다. 상위 계층의 이용수수료율(하한선)이 함께 표시되며, 이보다 낮게 설정 시 오류가 반환됩니다. 하위 계층 요율 ≥ 상위 계층 요율이어야 합니다.');
step(4, '저장', '저장 즉시 적용됩니다. 이미 처리된 거래에는 소급 적용되지 않습니다.');
dangerBox('🚫 하위 계정에 상위보다 낮은 이용수수료율 설정 시 서버에서 오류를 반환하며 저장되지 않습니다.');


// ═══════════════════════════════════════════════════════
// SECTION 06 — 회원 관리
// ═══════════════════════════════════════════════════════
newPage();
y = 40;
sectionHeader('SECTION 06', '회원 관리', '회원 등록 · 가상계좌 발급 · 상태 관리');

h3('6.1 회원 등록');
para('회원은 두 가지 방법으로 등록됩니다. 회원은 특정 매장에 소속되며, 등록 즉시 전용 가상계좌가 발급됩니다.');
card2(
  '방법 1 · 관리자 직접 등록',
  '회원 관리 메뉴 → "회원 추가" 버튼 → 이름, 연락처, 매장코드 입력 후 저장. 등록 완료 즉시 가상계좌가 자동 발급됩니다.',
  '방법 2 · 셀프 등록 링크',
  '회원 관리 메뉴의 "등록 링크 복사" 버튼으로 링크를 복사해 회원에게 전달. 회원이 직접 정보를 입력하고 매장코드로 소속 매장에 등록합니다.'
);

h3('6.2 가상계좌 발급');
para('회원 등록 시 전용 가상계좌(은행명 + 계좌번호)가 자동 발급됩니다. 회원은 이 계좌번호로 구매금액을 입금합니다. 재발급이 필요한 경우 아래와 같이 처리합니다.');
step(1, '회원 목록에서 대상 회원 선택', '회원 관리 페이지에서 가상계좌를 재발급할 회원을 찾습니다.');
step(2, '"가상계좌 재발급" 버튼 클릭', '해당 회원 행의 재발급 버튼을 클릭합니다. 이전 가상계좌는 즉시 비활성화됩니다.');
warnBox('⚠️ 가상계좌 재발급 시 기존 계좌번호로 입금된 금액은 자동 매핑되지 않으므로 주의하세요.');

h3('6.3 회원 상태 관리');
table(
  ['상태', '설명', '처리'],
  [
    ['활성 (Active)', '정상 이용 가능 상태', '구매 요청 및 로그인 허용'],
    ['비활성 (Inactive)', '일시 이용 중지 상태', '구매 요청 차단, 로그인 차단'],
  ],
  [130, 200, 165]
);
para('회원 목록의 상태 토글 버튼으로 즉시 활성/비활성 전환이 가능합니다.');

h3('6.4 회원 정보 수정 및 삭제');
table(
  ['기능', '설명', '주의사항'],
  [
    ['정보 수정', '이름, 연락처, 생년월일 수정 가능', '수정 즉시 반영'],
    ['삭제', '회원 계정 완전 삭제 및 가상계좌 비활성화', '복구 불가 · 거래 내역은 유지'],
  ],
  [120, 230, 145]
);


// ═══════════════════════════════════════════════════════
// SECTION 07 — 거래 내역 (구매 처리)
// ═══════════════════════════════════════════════════════
newPage();
y = 40;
sectionHeader('SECTION 07', '거래 내역 (구매 처리)', '구매 확인 처리 · 수수료 계산 흐름 · 거래 조회');

h3('7.1 구매 확인 처리 흐름');
para('회원이 가상계좌로 구매금액을 입금하면 "대기 중" 상태로 목록에 표시됩니다. 실제 입금 확인 후 처리해야 매장 잔액에 반영됩니다.');
step(1, '거래 내역 메뉴 이동', '좌측 메뉴에서 "거래 내역"을 클릭합니다. 상태 필터를 "대기 중"으로 설정하면 미처리 건만 확인됩니다.');
step(2, '실제 입금 확인', '은행 또는 가상계좌 시스템에서 해당 금액이 실제로 입금되었는지 확인합니다.');
step(3, '"구매 확인" 버튼 클릭', '확인 버튼을 누르면 수수료가 자동 계산되고 순 금액이 매장 잔액에 적립됩니다.');
step(4, '계층별 수수료 자동 배분', '이용수수료의 각 계층 마진 금액이 해당 관리자의 수수료 수익 잔액에 자동 기록됩니다.');

h3('7.2 구매 확인 시 수수료 계산 (부담 주체: 매장)');
infoBox('회원은 구매금액 100,000원을 가상계좌로 전액 입금합니다.\n매장이 플랫폼 이용 수수료를 부담하며, 수수료 차감 후 순 금액이 매장 잔액에 적립됩니다.\n\n[예시] 입금수수료 500원, 이용수수료율 2% 설정 시\n  입금수수료:   500원 (정액, 매장 부담)\n  이용수수료:   100,000 × 2% = 2,000원 (비율, 매장 부담)\n  총 수수료:    2,500원\n  매장 적립액:  100,000 − 2,500 = 97,500원');

h3('7.3 거래 내역 조회 및 필터');
table(
  ['필터', '설명'],
  [
    ['거래 유형', '구매(입금) / 출금 유형별 필터링'],
    ['처리 상태', '대기 중 / 완료 / 실패 상태별 필터링'],
    ['날짜 범위', '시작일~종료일 지정으로 기간 조회'],
    ['조직 필터', '총판/대리점/매장별 하위 거래 필터링 (역할 권한 범위 내)'],
    ['검색', '추적 번호 또는 계좌번호로 검색'],
  ],
  [150, 345]
);

h3('7.4 거래 상태 구분');
table(
  ['상태', '설명'],
  [
    ['대기 중 (Pending)', '회원이 구매 요청했지만 아직 관리자 확인 전'],
    ['확인 완료 (Success)', '관리자가 구매 확인 처리 완료, 매장 잔액에 적립됨'],
    ['실패 (Failed)', '처리 중 오류 발생'],
  ],
  [160, 335]
);
para('각 거래 행에서 원래 금액(수수료 차감 전), 매장 적립액, 총 수수료를 확인할 수 있습니다. 거래 목록에서 소속 매장/대리점/총판/본사 계층 정보도 함께 표시됩니다.');


// ═══════════════════════════════════════════════════════
// SECTION 08 — 출금 관리 (매장 출금)
// ═══════════════════════════════════════════════════════
newPage();
y = 40;
sectionHeader('SECTION 08', '출금 관리 (매장 출금)', '매장 출금 신청 흐름 · 승인/반려 · 출금 가능 시간');

h3('8.1 매장 출금 흐름');
para('매장(Store) 계정만 출금을 신청할 수 있습니다. 구매 확인으로 적립된 잔액 내에서만 출금이 가능하며, 출금 신청 즉시 잔액이 차감됩니다.');
step(1, '매장 로그인 후 출금 신청', '매장 계정으로 로그인 → 출금 관리 메뉴에서 "출금 신청" 클릭 → 금액·계좌 정보 입력 후 신청');
step(2, '잔액 차감 및 대기', '신청 즉시 해당 금액이 매장 잔액에서 차감되고 "대기 중" 상태로 등록됩니다. 출금 가능 시간(익일 10:00 KST)이 자동 설정됩니다.');
step(3, '관리자 검토 및 승인', '상위 관리자가 출금 내역을 확인하고 승인 처리합니다. 출금 가능 시간 이후에만 승인할 수 있습니다.');
step(4, '실지급', '승인 완료 후 입력된 계좌번호로 실제 지급 처리합니다.');

infoBox('ℹ️ 출금 가능 시간: 신청 다음 날 오전 10:00 (KST 기준)\n출금 가능 시간 이전에는 승인 버튼이 비활성화됩니다.\n\n출금수수료는 매장이 부담합니다. 매장이 신청한 출금금액에서 수수료를 차감한 금액이 실제로 지급됩니다.\n예) 출금 신청 50,000원, 출금수수료 500원 → 실지급 49,500원 (500원은 매장 부담)');

h3('8.2 출금 승인 / 반려');
table(
  ['처리', '설명', '효과'],
  [
    ['승인', '출금 가능 시간 이후 승인 처리', '출금 승인 상태로 변경, 수수료 수익 잔액 기록'],
    ['반려', '반려 사유 입력 후 반려 처리', '차감된 잔액이 매장에 복원됨'],
  ],
  [80, 230, 185]
);
warnBox('⚠️ 반려 시 잔액이 복원되므로, 실제 입금이 이루어진 후에는 반려를 사용하지 마세요.');

h3('8.3 출금 상태 구분');
table(
  ['상태', '설명', '처리 가능 액션'],
  [
    ['대기 중 (Pending)', '신청 완료, 관리자 검토 대기', '출금 가능 시간 이후 승인 / 반려'],
    ['승인 (Approved)', '관리자 승인 완료', '없음 (처리 완료)'],
    ['반려 (Rejected)', '관리자 반려, 잔액 복원됨', '없음 (처리 완료)'],
  ],
  [140, 200, 155]
);

h3('8.4 출금 현황 요약');
card3([
  { title: '대기 건수 / 금액', body: '현재 승인 대기 중인 매장 출금 요청의 건수와 총 금액' },
  { title: '승인 건수 / 금액', body: '처리 완료된 승인 요청의 누적 건수와 금액' },
  { title: '오늘 지급 금액', body: '당일 지급 완료 처리된 출금 총액' },
]);


// ═══════════════════════════════════════════════════════
// SECTION 09 — 잔액 관리
// ═══════════════════════════════════════════════════════
newPage();
y = 40;
sectionHeader('SECTION 09', '잔액 관리', '매장 잔액 · 수수료 수익 잔액 · 수동 입력');

h3('9.1 잔액 종류');
para('TodoPay의 잔액은 계정 역할에 따라 두 가지 유형으로 구분됩니다.');
card2(
  '매장 잔액 (Store Balance)',
  '매장(Store) 계정 전용. 구매 확인 시 자동 적립, 출금 신청 시 차감됩니다. 잔액 관리 메뉴에서 현재 잔액과 대기 중 출금 금액을 확인할 수 있습니다.',
  '수수료 수익 잔액',
  '본사·총판·대리점 계정의 이용수수료 마진 수익 내역입니다. 구매 확인 시 각 계층의 마진이 자동 기록되며, 잔액 관리 메뉴에서 이력을 조회할 수 있습니다.'
);

h3('9.2 매장 잔액 현황 (매장 계정)');
card3([
  { title: '현재 잔액', body: '구매 적립 누계 − 출금 신청 누계 = 현재 보유 잔액' },
  { title: '대기 금액', body: '승인 완료됐지만 아직 지급 전인 출금 금액' },
  { title: '가용 잔액', body: '현재 잔액에서 대기 금액을 제외한 실제 출금 가능 금액' },
]);

h3('9.3 수수료 수익 잔액 이력 (비 매장 계정)');
table(
  ['이력 유형', '발생 시점', '방향'],
  [
    ['이용수수료 수당', '구매 확인 처리 시 마진 자동 배분', '수입 (+)'],
    ['출금 수수료 기록', '매장 출금 승인 처리 시', '수입 (+)'],
    ['수동 조정', '잔액 관리 수동 입력 시', '수입/지출'],
  ],
  [160, 200, 135]
);

h3('9.4 수동 입력 (슈퍼어드민 전용)');
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
dangerBox('🚫 수동 입력은 잔액에 즉시 반영되며 취소가 불가합니다. 금액과 분류를 반드시 재확인 후 처리하세요. 슈퍼어드민만 사용 가능합니다.');


// ═══════════════════════════════════════════════════════
// SECTION 10 — 일자별 통계
// ═══════════════════════════════════════════════════════
newPage();
y = 40;
sectionHeader('SECTION 10', '일자별 통계', '거래량 추이 차트 · 일별 데이터 테이블');

h3('10.1 통계 차트');
para('일자별 통계 페이지는 기간 내 거래 데이터를 시각화하여 트렌드를 파악합니다. 역할에 따라 자신의 관리 범위 내 데이터만 표시됩니다.');
card2(
  '구매 금액 추이',
  '날짜별 구매(입금) 금액을 라인 차트로 표시. 구매량 변동 흐름 파악에 유용합니다.',
  '거래 건수 추이',
  '날짜별 구매/출금 건수를 차트로 표시. 거래 빈도 및 피크 타임 확인에 유용합니다.'
);

h3('10.2 날짜 범위 설정');
para('기본 조회 기간은 최근 30일입니다. 달력 UI를 통해 시작일과 종료일을 직접 설정할 수 있습니다.');

h3('10.3 일별 데이터 테이블');
table(
  ['컬럼', '설명'],
  [
    ['날짜', '해당 날짜 (YYYY-MM-DD)'],
    ['구매 건수', '확인 완료된 구매 거래 수'],
    ['구매 금액', '확인 완료된 구매 총액 (원금 기준)'],
    ['출금 건수', '승인 완료된 매장 출금 거래 수'],
    ['출금 금액', '승인 완료된 매장 출금 총액'],
    ['수수료', '해당 일 발생 총 수수료 (입금수수료 + 이용수수료)'],
    ['순 금액', '구매액 − 출금액 (수수료 차감 후)'],
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
  ['대시보드',              '✓','✓','✓','✓','✓'],
  ['거래 내역 조회',        '✓','✓','✓','✓','✓'],
  ['구매 확인 처리',        '✓','✓','✓','✓','✓'],
  ['출금 승인/반려',        '✓','✓','✓','✓','—'],
  ['매장 출금 신청',        '—','—','—','—','✓'],
  ['잔액 관리 조회',        '✓','✓','✓','✓','✓'],
  ['잔액 수동 입력',        '✓','—','—','—','—'],
  ['회원 관리',             '✓','✓','✓','✓','✓'],
  ['하부 조직 관리',        '✓','✓','✓','✓','—'],
  ['수수료 설정',           '✓','✓','✓','✓','—'],
  ['수수료 조회',           '✓','✓','✓','✓','✓'],
  ['일자별 통계',           '✓','✓','✓','✓','✓'],
  ['공지사항',              '✓','✓','✓','✓','✓'],
  ['OTP 설정',              '✓','✓','✓','✓','✓'],
  ['내 계정',               '✓','✓','✓','✓','✓'],
  ['전체 사용자 조회',      '✓','—','—','—','—'],
];

const pcw = [175, 70, 60, 60, 65, 65];
const pcTotal = pcw.reduce((a, b) => a + b, 0);
const roleColors = ['#7c3aed', NAVY2, '#0369a1', '#0891b2', '#0f766e'];
const roleLabels = ['슈퍼어드민', '본사', '총판', '대리점', '매장'];

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

rect(ML, y, CW, 50, LIGHT_BG, BORDER, 6);
doc.font('bold').fontSize(9).fillColor(NAVY2).text('문의 및 지원', ML + 14, y + 10);
doc.font('reg').fontSize(8.5).fillColor(MUTED).text('이 문서에 대한 문의사항은 슈퍼어드민 또는 시스템 운영팀에 문의하세요.', ML + 14, y + 24, { width: CW - 28 });
doc.font('reg').fontSize(7.5).fillColor('#94a3b8').text('© 2026 TodoPay Financial Operations · Administrator Guide v1.1 · CONFIDENTIAL', ML + 14, y + 38, { width: CW - 28 });

doc.end();
doc.on('finish', () => console.log('✅ PDF generated:', OUT));
doc.on('error', e => { console.error('❌ error:', e.message); process.exit(1); });
