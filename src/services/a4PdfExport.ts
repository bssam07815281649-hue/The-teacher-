// Pure TypeScript RTL Arabic A4 PDF Generator using high-DPI HTML5 Canvas -> PDF-1.4
// Zero window.open dependency and 100% faithful Arabic shaping & RTL table alignment.

export interface A4TableColumn {
  label: string;
  maxScoreLabel?: string;
}

export interface A4TableRow {
  studentName: string;
  cells: string[]; // Rendered strings: numeric '0', '-', 'غائب', 'معفى', etc.
  extraSummary?: string;
}

export interface A4ExportOptions {
  schoolName: string;
  directorate: string;
  academicYear: string;
  sectionLabel: string;
  subjectLabel: string;
  subtitle?: string;
  columns: A4TableColumn[];
  rows: A4TableRow[];
}

export interface A4PdfExportResult {
  previewPages: string[];
  pdfBlob: Blob;
  fileName: string;
}

const A4_PX_W = 1240;
const A4_PX_H = 1754;
const ROWS_PER_PAGE = 26;

function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const b64 = dataUrl.split(',')[1] || '';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

// Build a standard PDF-1.4 document embedding high-res JPEG A4 pages (595.28 x 841.89 pt)
function buildPdfFromJpegs(
  pages: { bytes: Uint8Array; width: number; height: number }[]
): Blob {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let cursor = 0;

  const pushBytes = (arr: Uint8Array) => {
    chunks.push(arr);
    cursor += arr.length;
  };
  const pushStr = (str: string) => pushBytes(encoder.encode(str));

  pushStr('%PDF-1.4\n%\xFF\xFF\xFF\xFF\n');

  const pageCount = pages.length;
  const pageObjIds: number[] = [];
  let nextObjId = 3; // 1 = Catalog, 2 = Pages

  // Pre-allocate object IDs for each page: (pageObj, contentObj, imgObj)
  const pageMeta = pages.map((p) => {
    const pageId = nextObjId++;
    const contentId = nextObjId++;
    const imgId = nextObjId++;
    pageObjIds.push(pageId);
    return { ...p, pageId, contentId, imgId };
  });

  // Obj 1: Catalog
  offsets[1] = cursor;
  pushStr('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  // Obj 2: Pages
  offsets[2] = cursor;
  pushStr(`2 0 obj\n<< /Type /Pages /Kids [${pageObjIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageCount} >>\nendobj\n`);

  const PT_W = 595.28;
  const PT_H = 841.89;

  for (const pm of pageMeta) {
    // Page object
    offsets[pm.pageId] = cursor;
    pushStr(
      `${pm.pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PT_W} ${PT_H}] /Resources << /XObject << /Im0 ${pm.imgId} 0 R >> >> /Contents ${pm.contentId} 0 R >>\nendobj\n`
    );

    // Content stream drawing image full-bleed on A4
    const streamStr = `q\n${PT_W} 0 0 ${PT_H} 0 0 cm\n/Im0 Do\nQ\n`;
    offsets[pm.contentId] = cursor;
    pushStr(`${pm.contentId} 0 obj\n<< /Length ${streamStr.length} >>\nstream\n${streamStr}endstream\nendobj\n`);

    // Image XObject
    offsets[pm.imgId] = cursor;
    pushStr(
      `${pm.imgId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${pm.width} /Height ${pm.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${pm.bytes.length} >>\nstream\n`
    );
    pushBytes(pm.bytes);
    pushStr('\nendstream\nendobj\n');
  }

  const xrefOffset = cursor;
  const totalObjs = nextObjId;
  pushStr(`xref\n0 ${totalObjs}\n`);
  pushStr('0000000000 65535 f \n');
  for (let id = 1; id < totalObjs; id++) {
    const off = offsets[id] ?? 0;
    pushStr(`${String(off).padStart(10, '0')} 00000 n \n`);
  }
  pushStr(`trailer\n<< /Size ${totalObjs} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

  const parts = chunks.map((c) => {
    const ab = new ArrayBuffer(c.byteLength);
    new Uint8Array(ab).set(c);
    return ab;
  });
  return new Blob(parts, { type: 'application/pdf' });
}

function drawFittedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number
) {
  let clean = text || '';
  if (ctx.measureText(clean).width <= maxWidth) {
    ctx.fillText(clean, x, y);
    return;
  }
  while (clean.length > 1 && ctx.measureText(clean + '…').width > maxWidth) {
    clean = clean.slice(0, -1);
  }
  ctx.fillText(clean + '…', x, y);
}

export function generateMatchingA4Pdf(options: A4ExportOptions): A4PdfExportResult {
  const totalPages = Math.max(1, Math.ceil(options.rows.length / ROWS_PER_PAGE));
  const previewPages: string[] = [];
  const pdfJpegs: { bytes: Uint8Array; width: number; height: number }[] = [];

  for (let p = 0; p < totalPages; p++) {
    const canvas = document.createElement('canvas');
    canvas.width = A4_PX_W;
    canvas.height = A4_PX_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('تعذر إنشاء مساحة الرسم لملف PDF.');

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, A4_PX_W, A4_PX_H);

    // Outer clean border
    const margin = 52;
    ctx.strokeStyle = '#CBD5E1';
    ctx.lineWidth = 2;
    ctx.strokeRect(margin, margin, A4_PX_W - margin * 2, A4_PX_H - margin * 2);

    // Header band
    ctx.fillStyle = '#EEEAFF';
    ctx.fillRect(margin + 1, margin + 1, A4_PX_W - margin * 2 - 2, 138);
    ctx.fillStyle = '#653CF5';
    ctx.fillRect(margin + 1, margin + 1, A4_PX_W - margin * 2 - 2, 10);

    ctx.direction = 'rtl';
    ctx.textBaseline = 'middle';

    // Right side school metadata
    ctx.fillStyle = '#171A36';
    ctx.textAlign = 'right';
    ctx.font = 'bold 28px "Cairo", "IBM Plex Sans Arabic", sans-serif';
    ctx.fillText(options.schoolName || 'المدرسة الذكية', A4_PX_W - margin - 24, margin + 52);

    ctx.fillStyle = '#475569';
    ctx.font = '600 19px "IBM Plex Sans Arabic", "Cairo", sans-serif';
    ctx.fillText(
      `${options.directorate}  |  العام الدراسي: ${options.academicYear}`,
      A4_PX_W - margin - 24,
      margin + 96
    );

    // Left side subject/section metadata
    ctx.textAlign = 'left';
    ctx.fillStyle = '#4320D9';
    ctx.font = 'bold 22px "Cairo", "IBM Plex Sans Arabic", sans-serif';
    ctx.fillText(options.subjectLabel, margin + 24, margin + 52);

    ctx.fillStyle = '#334155';
    ctx.font = '600 18px "IBM Plex Sans Arabic", "Cairo", sans-serif';
    ctx.fillText(options.sectionLabel, margin + 24, margin + 96);

    let tableTop = margin + 158;
    if (options.subtitle) {
      ctx.textAlign = 'right';
      ctx.fillStyle = '#475569';
      ctx.font = '17px "IBM Plex Sans Arabic", "Cairo", sans-serif';
      ctx.fillText(options.subtitle, A4_PX_W - margin - 14, tableTop + 14);
      tableTop += 38;
    }

    // RTL Table columns layout (Right to Left):
    // [Seq #] | [Student Name] | [Col 1] | [Col 2] ... | [Extra Summary if any]
    const tableW = A4_PX_W - margin * 2 - 28;
    const tableLeft = margin + 14;
    const tableRight = tableLeft + tableW;

    const seqW = 58;
    const hasExtra = options.rows.some((r) => Boolean(r.extraSummary));
    const extraW = hasExtra ? 120 : 0;
    const colCount = Math.max(1, options.columns.length);
    const nameW = Math.max(250, Math.min(340, tableW * 0.28));
    const remainingW = tableW - seqW - nameW - extraW;
    const scoreColW = remainingW / colCount;

    const headerH = 66;
    const rowH = 44;

    // Draw table header
    ctx.fillStyle = '#171A36';
    ctx.fillRect(tableLeft, tableTop, tableW, headerH);

    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.font = 'bold 17px "Cairo", "IBM Plex Sans Arabic", sans-serif';

    // Seq header (far right)
    let cursorRight = tableRight;
    ctx.fillText('ت', cursorRight - seqW / 2, tableTop + headerH / 2);
    cursorRight -= seqW;
    ctx.beginPath();
    ctx.moveTo(cursorRight, tableTop);
    ctx.lineTo(cursorRight, tableTop + headerH);
    ctx.stroke();

    // Name header
    ctx.fillText('اسم الطالب', cursorRight - nameW / 2, tableTop + headerH / 2);
    cursorRight -= nameW;
    ctx.beginPath();
    ctx.moveTo(cursorRight, tableTop);
    ctx.lineTo(cursorRight, tableTop + headerH);
    ctx.stroke();

    // Score columns from right to left
    for (let c = 0; c < options.columns.length; c++) {
      const col = options.columns[c];
      ctx.font = 'bold 15px "Cairo", "IBM Plex Sans Arabic", sans-serif';
      drawFittedText(
        ctx,
        col.label || `عمود ${c + 1}`,
        cursorRight - scoreColW / 2,
        tableTop + (col.maxScoreLabel ? 22 : headerH / 2),
        scoreColW - 10
      );
      if (col.maxScoreLabel) {
        ctx.fillStyle = '#CBD5E1';
        ctx.font = '13px "IBM Plex Mono", monospace';
        ctx.fillText(`(${col.maxScoreLabel})`, cursorRight - scoreColW / 2, tableTop + 46);
        ctx.fillStyle = '#FFFFFF';
      }
      cursorRight -= scoreColW;
      ctx.beginPath();
      ctx.moveTo(cursorRight, tableTop);
      ctx.lineTo(cursorRight, tableTop + headerH);
      ctx.stroke();
    }

    if (hasExtra) {
      ctx.font = 'bold 15px "Cairo", "IBM Plex Sans Arabic", sans-serif';
      ctx.fillText('السعي / الملخص', cursorRight - extraW / 2, tableTop + headerH / 2);
    }

    // Draw rows
    const pageRows = options.rows.slice(p * ROWS_PER_PAGE, (p + 1) * ROWS_PER_PAGE);
    pageRows.forEach((row, idx) => {
      const globalIdx = p * ROWS_PER_PAGE + idx + 1;
      const y = tableTop + headerH + idx * rowH;

      ctx.fillStyle = idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC';
      ctx.fillRect(tableLeft, y, tableW, rowH);
      ctx.strokeStyle = '#CBD5E1';
      ctx.strokeRect(tableLeft, y, tableW, rowH);

      let rx = tableRight;
      // Seq #
      ctx.fillStyle = '#475569';
      ctx.textAlign = 'center';
      ctx.font = '600 15px "IBM Plex Mono", monospace';
      ctx.fillText(String(globalIdx), rx - seqW / 2, y + rowH / 2);
      rx -= seqW;
      ctx.beginPath();
      ctx.moveTo(rx, y);
      ctx.lineTo(rx, y + rowH);
      ctx.stroke();

      // Student name (RTL right-aligned with padding)
      ctx.fillStyle = '#0F172A';
      ctx.textAlign = 'right';
      ctx.font = '600 16px "IBM Plex Sans Arabic", "Cairo", sans-serif';
      drawFittedText(ctx, row.studentName, rx - 12, y + rowH / 2, nameW - 22);
      rx -= nameW;
      ctx.beginPath();
      ctx.moveTo(rx, y);
      ctx.lineTo(rx, y + rowH);
      ctx.stroke();

      // Cells
      ctx.textAlign = 'center';
      for (let c = 0; c < options.columns.length; c++) {
        const val = row.cells[c] ?? '-';
        if (val === 'غائب') {
          ctx.fillStyle = '#B91C1C';
          ctx.font = 'bold 15px "IBM Plex Sans Arabic", sans-serif';
        } else if (val === 'معفى') {
          ctx.fillStyle = '#4320D9';
          ctx.font = 'bold 15px "IBM Plex Sans Arabic", sans-serif';
        } else if (val === '-') {
          ctx.fillStyle = '#94A3B8';
          ctx.font = '16px "IBM Plex Mono", monospace';
        } else {
          ctx.fillStyle = '#0F172A';
          ctx.font = 'bold 16px "IBM Plex Mono", monospace';
        }
        drawFittedText(ctx, val, rx - scoreColW / 2, y + rowH / 2, scoreColW - 8);
        rx -= scoreColW;
        ctx.beginPath();
        ctx.moveTo(rx, y);
        ctx.lineTo(rx, y + rowH);
        ctx.stroke();
      }

      if (hasExtra) {
        ctx.fillStyle = '#4320D9';
        ctx.font = 'bold 16px "IBM Plex Mono", monospace';
        drawFittedText(ctx, row.extraSummary || '-', rx - extraW / 2, y + rowH / 2, extraW - 10);
      }
    });

    // Footer
    ctx.fillStyle = '#64748B';
    ctx.font = '15px "IBM Plex Sans Arabic", "Cairo", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(
      `تاريخ الإصدار: ${new Date().toLocaleDateString('ar-IQ')}`,
      A4_PX_W - margin - 20,
      A4_PX_H - margin - 24
    );
    ctx.textAlign = 'left';
    ctx.fillText(`صفحة ${p + 1} من ${totalPages}`, margin + 20, A4_PX_H - margin - 24);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    previewPages.push(dataUrl);
    pdfJpegs.push({
      bytes: dataUrlToUint8Array(dataUrl),
      width: A4_PX_W,
      height: A4_PX_H,
    });
  }

  const pdfBlob = buildPdfFromJpegs(pdfJpegs);
  const safeSubject = (options.subjectLabel || 'grades').replace(/[^\p{L}\p{N}_-]+/gu, '_');
  const fileName = `سجل_${safeSubject}_${new Date().toISOString().slice(0, 10)}.pdf`;

  return { previewPages, pdfBlob, fileName };
}

export interface StudentCodePrintEntry {
  fullName: string;
  code: string;
}

export interface StudentCodesA4Options {
  schoolName: string;
  directorate: string;
  academicYear: string;
  sectionLabel: string;
  students: StudentCodePrintEntry[];
}

const CODES_PER_PAGE = 20; // 2 columns x 10 rows per A4 sheet

export function generateStudentCodesA4Pdf(options: StudentCodesA4Options): A4PdfExportResult {
  const list = options.students || [];
  const totalPages = Math.max(1, Math.ceil(list.length / CODES_PER_PAGE));
  const previewPages: string[] = [];
  const pdfJpegs: { bytes: Uint8Array; width: number; height: number }[] = [];

  for (let p = 0; p < totalPages; p++) {
    const canvas = document.createElement('canvas');
    canvas.width = A4_PX_W;
    canvas.height = A4_PX_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('تعذر إنشاء مساحة الرسم لطباعة الأكواد.');

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, A4_PX_W, A4_PX_H);

    const margin = 46;
    ctx.strokeStyle = '#CBD5E1';
    ctx.lineWidth = 2;
    ctx.strokeRect(margin, margin, A4_PX_W - margin * 2, A4_PX_H - margin * 2);

    // Header Band
    ctx.fillStyle = '#EEEAFF';
    ctx.fillRect(margin + 1, margin + 1, A4_PX_W - margin * 2 - 2, 118);
    ctx.fillStyle = '#653CF5';
    ctx.fillRect(margin + 1, margin + 1, A4_PX_W - margin * 2 - 2, 10);

    ctx.direction = 'rtl';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = '#171A36';
    ctx.textAlign = 'right';
    ctx.font = 'bold 26px "Cairo", "IBM Plex Sans Arabic", sans-serif';
    ctx.fillText(options.schoolName || 'المدرسة الذكية', A4_PX_W - margin - 22, margin + 44);

    ctx.fillStyle = '#475569';
    ctx.font = '600 17px "IBM Plex Sans Arabic", "Cairo", sans-serif';
    ctx.fillText(
      `${options.directorate}  |  العام الدراسي: ${options.academicYear}`,
      A4_PX_W - margin - 22,
      margin + 84
    );

    ctx.textAlign = 'left';
    ctx.fillStyle = '#4320D9';
    ctx.font = 'bold 21px "Cairo", "IBM Plex Sans Arabic", sans-serif';
    ctx.fillText('بطاقات أكواد دخول الطلبة', margin + 22, margin + 44);

    ctx.fillStyle = '#334155';
    ctx.font = '600 17px "IBM Plex Sans Arabic", "Cairo", sans-serif';
    ctx.fillText(`${options.sectionLabel} (20 طالب / ورقة)`, margin + 22, margin + 84);

    // 2 Columns x 10 Rows grid for exactly 20 cards per A4 page
    const gridTop = margin + 136;
    const gridBottom = A4_PX_H - margin - 46;
    const gridLeft = margin + 18;
    const gridW = A4_PX_W - margin * 2 - 36;
    const gridH = gridBottom - gridTop;

    const cols = 2;
    const rows = 10;
    const gapX = 18;
    const gapY = 12;
    const cardW = (gridW - gapX) / cols;
    const cardH = (gridH - gapY * (rows - 1)) / rows;

    const pageItems = list.slice(p * CODES_PER_PAGE, (p + 1) * CODES_PER_PAGE);

    for (let i = 0; i < pageItems.length; i++) {
      const item = pageItems[i];
      const globalNum = p * CODES_PER_PAGE + i + 1;
      const rowIdx = Math.floor(i / cols);
      // RTL order: even i (0,2,4...) on right column, odd i on left column
      const colFromRight = i % cols;
      const x = colFromRight === 0 ? gridLeft + cardW + gapX : gridLeft;
      const y = gridTop + rowIdx * (cardH + gapY);

      // Card background & dashed cut border
      ctx.save();
      ctx.fillStyle = '#FAFAFF';
      ctx.fillRect(x, y, cardW, cardH);
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = '#94A3B8';
      ctx.lineWidth = 1.4;
      ctx.strokeRect(x, y, cardW, cardH);
      ctx.restore();

      // Right accent strip
      ctx.fillStyle = '#653CF5';
      ctx.fillRect(x + cardW - 8, y + 1, 7, cardH - 2);

      // Sequence number circle
      ctx.fillStyle = '#EEEAFF';
      ctx.beginPath();
      ctx.arc(x + cardW - 34, y + 28, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#4320D9';
      ctx.textAlign = 'center';
      ctx.font = 'bold 15px "IBM Plex Mono", monospace';
      ctx.fillText(String(globalNum), x + cardW - 34, y + 29);

      // Student Name (RTL right-aligned top line)
      ctx.fillStyle = '#171A36';
      ctx.textAlign = 'right';
      ctx.font = 'bold 19px "Cairo", "IBM Plex Sans Arabic", sans-serif';
      drawFittedText(ctx, item.fullName, x + cardW - 58, y + 29, cardW - 76);

      // Section label subtle
      ctx.fillStyle = '#64748B';
      ctx.textAlign = 'right';
      ctx.font = '600 13px "IBM Plex Sans Arabic", "Cairo", sans-serif';
      drawFittedText(ctx, options.sectionLabel, x + cardW - 22, y + cardH - 28, cardW * 0.45);

      // Prominent Code Box on left side of card bottom
      const codeBoxW = Math.min(230, cardW * 0.48);
      const codeBoxH = 40;
      const codeBoxX = x + 16;
      const codeBoxY = y + cardH - codeBoxH - 12;

      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(codeBoxX, codeBoxY, codeBoxW, codeBoxH);
      ctx.strokeStyle = '#653CF5';
      ctx.lineWidth = 1.8;
      ctx.strokeRect(codeBoxX, codeBoxY, codeBoxW, codeBoxH);

      ctx.save();
      ctx.direction = 'ltr';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#4320D9';
      ctx.font = 'bold 20px "IBM Plex Mono", monospace';
      ctx.fillText(item.code, codeBoxX + codeBoxW / 2, codeBoxY + codeBoxH / 2 + 1);
      ctx.restore();
    }

    // Footer
    ctx.fillStyle = '#64748B';
    ctx.font = '14px "IBM Plex Sans Arabic", "Cairo", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(
      `سجل الطالب الذكي · إجمالي البطاقات: ${list.length} · تاريخ الطباعة: ${new Date().toLocaleDateString('ar-IQ')}`,
      A4_PX_W - margin - 20,
      A4_PX_H - margin - 20
    );
    ctx.textAlign = 'left';
    ctx.fillText(`ورقة ${p + 1} من ${totalPages}`, margin + 20, A4_PX_H - margin - 20);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.93);
    previewPages.push(dataUrl);
    pdfJpegs.push({
      bytes: dataUrlToUint8Array(dataUrl),
      width: A4_PX_W,
      height: A4_PX_H,
    });
  }

  const pdfBlob = buildPdfFromJpegs(pdfJpegs);
  const safeSection = (options.sectionLabel || 'section').replace(/[^\p{L}\p{N}_-]+/gu, '_');
  const fileName = `اكواد_الطلبة_${safeSection}_${new Date().toISOString().slice(0, 10)}.pdf`;

  return { previewPages, pdfBlob, fileName };
}
