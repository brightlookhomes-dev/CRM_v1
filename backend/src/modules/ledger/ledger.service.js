import ExcelJS from 'exceljs';
import { db } from '../../config/database.js';
import { round2 } from '../../utils/helpers.js';
import { requireProjectAccess } from '../../services/projectAccess.js';

const label = (s) => (s ? String(s).replace(/_/g, ' ').toLowerCase().replace(/^\w|\s\w/g, (c) => c.toUpperCase()) : '');

const describe = (e) => {
  if (e.kind === 'VENDOR_PAYMENT') return `${e.vendor} — Invoice ${e.invoice}`;
  if (e.entry_type === 'REFUND') return `Refund to customer (${e.reference})`;
  if (e.entry_type === 'REVERSAL') return `Reversal (${e.reference})`;
  return `Customer payment${e.payment_type ? ` — ${label(e.payment_type)}` : ''} (Inv ${e.invoice_number ?? '—'})`;
};

/** Bank-statement style ledger: credits = customer payments in, debits = vendor bills paid / refunds out. */
export async function getLedger(user, projectId, { from, to } = {}) {
  const project = await requireProjectAccess(db, user, projectId, { roles: ['ADMIN'] });
  const { rows } = await db.query(
    `select * from (
       select 'CUSTOMER_PAYMENT' as kind, cp.id, cp.payment_date as entry_date, cp.created_at as ts,
              case when cp.amount > 0 then cp.amount else 0 end as credit,
              case when cp.amount < 0 then -cp.amount else 0 end as debit,
              cp.payment_method as mode, cp.reference_number as reference, cp.entry_type, cp.payment_type, cp.invoice_number,
              null::text as category, null::text as vendor, null::text as invoice
         from customer_payments cp where cp.project_id = $1
       union all
       select 'VENDOR_PAYMENT', b.id, b.paid_at::date, b.paid_at, 0, b.amount, b.payment_mode, b.payment_reference,
              null, null, null, b.category, b.vendor_name, b.invoice_number
         from vendor_bills b where b.project_id = $1 and b.status = 'PAID'
     ) e order by entry_date, ts, id`, [projectId]);

  let balance = 0; let opening = 0; let credit = 0; let debit = 0;
  const out = [];
  for (const e of rows) {
    balance = round2(balance + Number(e.credit) - Number(e.debit));
    if (from && e.entry_date < from) opening = balance;
    if ((from && e.entry_date < from) || (to && e.entry_date > to)) continue;
    credit = round2(credit + Number(e.credit)); debit = round2(debit + Number(e.debit));
    out.push({
      id: e.id, date: e.entry_date, kind: e.kind, description: describe(e), reference: e.reference ?? '',
      mode: e.mode ?? '', category: e.kind === 'VENDOR_PAYMENT' ? (e.category || 'Uncategorised') : '',
      credit: Number(e.credit), debit: Number(e.debit), balance,
    });
  }
  return { project: { name: project.name, code: project.project_code }, period: { from: from ?? null, to: to ?? null }, openingBalance: opening, rows: out, totals: { credit, debit, closingBalance: out.length ? out[out.length - 1].balance : opening } };
}

const INR = String.raw`[>=10000000]"₹"##\,##\,##\,##0.00;[>=100000]"₹"##\,##\,##0.00;"₹"##,##0.00`; // Indian digit grouping (lakh/crore)
const BORDER = { style: 'thin', color: { argb: 'FFD9D9D9' } };
const BOX = { top: BORDER, left: BORDER, bottom: BORDER, right: BORDER };
const toDate = (d) => new Date(`${d}T00:00:00Z`);

/** Formatted Excel workbook: title block, styled header, real date/number cells, totals row. */
export async function toXlsx(ledger) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Brightlook Homes CRM';
  const ws = wb.addWorksheet('Ledger', { views: [{ state: 'frozen', ySplit: 5 }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  ws.columns = [{ width: 14 }, { width: 46 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 22 }, { width: 18 }];

  ws.mergeCells('A1:G1');
  ws.getCell('A1').value = 'Brightlook Homes — Project Ledger';
  ws.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FF171717' } };
  ws.mergeCells('A2:G2');
  ws.getCell('A2').value = `${ledger.project.name} (${ledger.project.code})`;
  ws.getCell('A2').font = { bold: true, size: 12 };
  ws.mergeCells('A3:G3');
  const { from, to } = ledger.period;
  ws.getCell('A3').value = `Statement period: ${from || 'Beginning'} to ${to || 'Today'}   |   Generated: ${new Date().toISOString().slice(0, 10)}`;
  ws.getCell('A3').font = { size: 10, color: { argb: 'FF746F69' } };

  const head = ws.getRow(5);
  head.values = ['Date', 'Description', 'Amount (Credit)', 'Mode of payment', 'Debit (Amount)', 'Category', 'Balance'];
  head.height = 24;
  head.eachCell((c, i) => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF20B9D4' } };
    c.alignment = { vertical: 'middle', horizontal: [3, 5, 7].includes(i) ? 'right' : 'left', wrapText: true };
    c.border = BOX;
  });

  const styleRow = (row, { bold = false, fill } = {}) => {
    row.eachCell({ includeEmpty: true }, (c, i) => {
      c.border = BOX;
      c.font = { bold, size: 10 };
      c.alignment = { vertical: 'top', horizontal: [3, 5, 7].includes(i) ? 'right' : 'left', wrapText: i === 2 };
      if ([3, 5, 7].includes(i)) c.numFmt = INR;
      if (fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
    });
  };

  if (ledger.openingBalance) {
    const r = ws.addRow(['', 'Opening balance', null, '', null, '', ledger.openingBalance]);
    styleRow(r, { bold: true, fill: 'FFF7F5F0' });
  }
  for (const e of ledger.rows) {
    const desc = e.reference ? `${e.description}
Ref: ${e.reference}` : e.description;
    const r = ws.addRow([toDate(e.date), desc, e.credit || null, label(e.mode), e.debit || null, e.category, e.balance]);
    styleRow(r);
    r.getCell(1).numFmt = 'dd-mmm-yyyy';
    r.getCell(3).font = { size: 10, color: { argb: 'FF198754' } };
    r.getCell(5).font = { size: 10, color: { argb: 'FFDC3545' } };
    if (e.balance < 0) r.getCell(7).font = { size: 10, bold: true, color: { argb: 'FFDC3545' } };
  }
  const first = ledger.openingBalance ? 6 : 5;
  const last = ws.rowCount;
  const total = ws.addRow(['', 'Total', { formula: `SUM(C${first + 1}:C${last})`, result: ledger.totals.credit }, '', { formula: `SUM(E${first + 1}:E${last})`, result: ledger.totals.debit }, 'Closing balance', ledger.totals.closingBalance]);
  styleRow(total, { bold: true, fill: 'FFE4F6FA' });
  return wb.xlsx.writeBuffer();
}
