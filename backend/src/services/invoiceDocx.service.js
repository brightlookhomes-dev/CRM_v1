import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AlignmentType, BorderStyle, Document, ImageRun, Packer, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, VerticalAlign, WidthType,
} from 'docx';
import { company } from '../config/company.js';
import { round2 } from '../utils/helpers.js';

const LOGO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../assets/brightlook-logo.png');
const FONT = 'Arial';

const indian = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const western2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const westernTrim = new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** Payment amount is GST-inclusive: grand total = amount, subtotal = amount / 1.18. */
export function splitGst(grandTotal) {
  const total = round2(grandTotal);
  const subTotal = round2(total / (1 + company.gstRatePercent / 100));
  const gst = round2(total - subTotal);
  const cgst = Math.floor((gst / 2) * 100) / 100;
  const sgst = round2(gst - cgst);
  return { subTotal, cgst, sgst, gst, total };
}

const ddmmyyyy = (d) => {
  const [y, m, day] = String(d).slice(0, 10).split('-');
  return `${day}/ ${m} / ${y}`;
};

const run = (text, o = {}) => new TextRun({ text, font: FONT, size: (o.size ?? 10) * 2, bold: o.bold });
const para = (children, o = {}) => new Paragraph({ children: [].concat(children), alignment: o.align, spacing: { before: o.before ?? 0, after: o.after ?? 0, line: o.line }, });
const NONE = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const noBorders = { top: NONE, bottom: NONE, left: NONE, right: NONE };
const LINE = { style: BorderStyle.SINGLE, size: 4, color: 'D9D9D9' };
const boxBorders = { top: LINE, bottom: LINE, left: LINE, right: LINE };

const cell = (children, width, o = {}) => new TableCell({
  children: [].concat(children), width: { size: width, type: WidthType.DXA }, borders: o.borders ?? boxBorders, verticalAlign: VerticalAlign.CENTER,
  shading: o.fill ? { type: ShadingType.CLEAR, color: 'auto', fill: o.fill } : undefined,
  margins: { top: 90, bottom: 90, left: 110, right: 110 },
});

const label = (l, v) => para([run(`${l} `, { bold: true, size: 11 }), run(v, { size: 11 })], { before: 20 });

export async function buildInvoiceDocx(inv) {
  const W = 10200; // usable width in twips (A4 with ~0.6" margins)
  const logo = fs.existsSync(LOGO) ? fs.readFileSync(LOGO) : null;

  const header = new Table({
    width: { size: W, type: WidthType.DXA }, columnWidths: [W / 2, W / 2], borders: { ...noBorders, insideHorizontal: NONE, insideVertical: NONE },
    rows: [new TableRow({ children: [
      cell(logo ? para(new ImageRun({ type: 'png', data: logo, transformation: { width: 230, height: 102 } })) : para(run('')), W / 2, { borders: noBorders }),
      cell([
        para(run('TAX INVOICE', { bold: true, size: 17 }), { align: AlignmentType.RIGHT, after: 200 }),
        para(run(`Invoice No: ${inv.invoiceNumber}`, { size: 11 }), { align: AlignmentType.RIGHT }),
        para(run(`Invoice Date: ${ddmmyyyy(inv.invoiceDate)}`, { size: 11 }), { align: AlignmentType.RIGHT }),
      ], W / 2, { borders: noBorders }),
    ] })],
  });

  const colW = [1190, 5690, 3320];
  const services = new Table({
    width: { size: W, type: WidthType.DXA }, columnWidths: colW,
    rows: [
      new TableRow({ children: ['S.No', 'Description', 'Amount ( ₹ )'].map((t, i) => cell(para(run(t, { size: 11 }), { align: AlignmentType.CENTER }), colW[i], { fill: 'EBEBEB' })) }),
      new TableRow({ children: [
        cell(para(run('1', { size: 11 })), colW[0]),
        cell(para(run(inv.description, { size: 9 })), colW[1]),
        cell(para(run(western2.format(inv.subTotal), { size: 11 }), { align: AlignmentType.CENTER }), colW[2]),
      ] }),
      new TableRow({ children: colW.map((w) => cell(para(run('')), w)) }),
    ],
  });

  const tw = [2800, 3200];
  const totalsRows = [
    ['Sub Total', `₹${indian.format(inv.subTotal)}`], [`CGST @ ${company.gstRatePercent / 2}%`, indian.format(inv.cgst)],
    [`SGST @ ${company.gstRatePercent / 2}%`, indian.format(inv.sgst)], [`Total GST @${company.gstRatePercent}%`, indian.format(inv.gst)],
    ['Grand Total', westernTrim.format(inv.total)],
  ];
  const totals = new Table({
    width: { size: tw[0] + tw[1], type: WidthType.DXA }, columnWidths: tw, alignment: AlignmentType.RIGHT,
    rows: totalsRows.map(([k, v]) => new TableRow({ children: [cell(para(run(k, { size: 11 })), tw[0]), cell(para(run(v, { size: 11 }), { align: AlignmentType.CENTER }), tw[1])] })),
  });

  const footer = new Table({
    width: { size: W, type: WidthType.DXA }, columnWidths: [W / 2, W / 2], borders: { ...noBorders, insideHorizontal: NONE, insideVertical: NONE },
    rows: [new TableRow({ children: [
      cell([para(run('Account Details', { bold: true, size: 11 }), { after: 80 }), ...company.bank.lines.map((l) => para(run(l, { size: 11 }), { before: 20 }))], W / 2, { borders: noBorders }),
      cell([para(run(`For ${company.name}`, { size: 11 }), { before: 330, after: 160 }), para(run('Authorized Signatory', { size: 11 }))], W / 2, { borders: noBorders }),
    ] })],
  });

  const doc = new Document({
    creator: company.name, title: `Tax Invoice ${inv.invoiceNumber}`,
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 700, bottom: 700, left: 850, right: 850 } } },
      children: [
        header,
        para(run(company.name, { bold: true, size: 12 }), { before: 240 }),
        para(run(company.tagline, { size: 12 })),
        para(run(''), { before: 100 }),
        label('GSTIN:', company.gstin), label('Address:', company.address), label('Email:', company.email),
        para(run('Bill To', { bold: true, size: 11 }), { before: 260 }),
        para(run(`Client Name: ${inv.clientName}`, { size: 11 }), { before: 40 }),
        para(run(`Project Address: ${inv.projectAddress}`, { size: 11 }), { before: 60 }),
        para(run('Description of Services', { bold: true, size: 11 }), { before: 360, after: 120 }),
        services,
        para(run(''), { before: 160 }),
        totals,
        para(run(''), { before: 240 }),
        footer,
      ],
    }],
  });
  return Packer.toBuffer(doc);
}
