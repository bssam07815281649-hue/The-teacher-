import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import JSZip from 'jszip';
import mammoth from 'mammoth';
import type { BookPage, ChapterItem, FileType } from '../types';
import { cacheRawPdfBytes, getCachedRawPdfBytes } from './localCache';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface ProcessedBookInit {
  title: string;
  fileType: FileType;
  totalPages: number;
  coverImage: string;
  chapters: ChapterItem[];
  initialPages: Omit<BookPage, 'userId' | 'bookId'>[];
  pdfBuffer?: ArrayBuffer;
}

function isArabicText(text: string): boolean {
  return /[\u0600-\u06FF]/.test(text);
}

function wrapCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function renderTextPageToDataUrl(
  title: string,
  bodyText: string,
  pageNumber: number,
  totalPages: number,
  embeddedImages: HTMLImageElement[] = []
): string {
  const isSlide = embeddedImages.length > 0 && bodyText.length < 700;
  const width = isSlide ? 1280 : 900;
  const height = isSlide ? 720 : 1240;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // Clean paper background
  ctx.fillStyle = '#FAF9F6';
  ctx.fillRect(0, 0, width, height);

  // Subtle top bar & border
  ctx.fillStyle = '#1E3A8A';
  ctx.fillRect(0, 0, width, 10);
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 2;
  ctx.strokeRect(20, 24, width - 40, height - 48);

  const rtl = isArabicText(title + ' ' + bodyText);
  ctx.direction = rtl ? 'rtl' : 'ltr';
  ctx.textAlign = rtl ? 'right' : 'left';
  const marginX = 64;
  const anchorX = rtl ? width - marginX : marginX;
  const contentWidth = isSlide && embeddedImages.length > 0 ? width * 0.54 : width - marginX * 2;

  // Title
  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 30px "Cairo", "IBM Plex Sans Arabic", sans-serif';
  const titleLines = wrapCanvasText(ctx, title, width - marginX * 2);
  let y = 84;
  for (const line of titleLines.slice(0, 2)) {
    ctx.fillText(line, anchorX, y);
    y += 40;
  }

  ctx.strokeStyle = '#CBD5E1';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(marginX, y);
  ctx.lineTo(width - marginX, y);
  ctx.stroke();
  y += 38;

  // Body lines
  ctx.fillStyle = '#1E293B';
  ctx.font = '21px "IBM Plex Sans Arabic", "Cairo", sans-serif';
  const paragraphs = bodyText.split(/\n+/);
  for (const para of paragraphs) {
    if (y > height - 80) break;
    const trimmed = para.trim();
    if (!trimmed) {
      y += 14;
      continue;
    }
    const lines = wrapCanvasText(ctx, trimmed, contentWidth);
    for (const line of lines) {
      if (y > height - 80) break;
      ctx.fillText(line, anchorX, y);
      y += 33;
    }
    y += 10;
  }

  // Embedded slide images if any
  if (embeddedImages.length > 0) {
    const img = embeddedImages[0];
    const boxW = isSlide ? width * 0.34 : width - marginX * 2;
    const boxH = isSlide ? height - 180 : 280;
    const boxX = isSlide ? (rtl ? marginX : width - marginX - boxW) : marginX;
    const boxY = isSlide ? 120 : Math.min(y + 12, height - boxH - 60);
    const ratio = Math.min(boxW / img.width, boxH / img.height);
    const drawW = img.width * ratio;
    const drawH = img.height * ratio;
    ctx.drawImage(img, boxX + (boxW - drawW) / 2, boxY + (boxH - drawH) / 2, drawW, drawH);
  }

  // Page footer
  ctx.fillStyle = '#64748B';
  ctx.font = '16px "IBM Plex Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText(`${pageNumber} / ${totalPages}`, width / 2, height - 40);

  return canvas.toDataURL('image/jpeg', 0.82);
}

async function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export async function createCoverThumbnail(dataUrl: string, maxWidth = 420): Promise<string> {
  if (!dataUrl) return '';
  try {
    const img = await loadImageElement(dataUrl);
    const scale = img.width > maxWidth ? maxWidth / img.width : 1;
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    let thumb = canvas.toDataURL('image/jpeg', 0.72);
    if (thumb.length > 220000) {
      thumb = canvas.toDataURL('image/jpeg', 0.55);
    }
    return thumb;
  } catch {
    return '';
  }
}

async function compressImageFile(file: File, maxWidth = 1400): Promise<{ dataUrl: string; width: number; height: number }> {
  const rawUrl = URL.createObjectURL(file);
  try {
    const img = await loadImageElement(rawUrl);
    const scale = img.width > maxWidth ? maxWidth / img.width : 1;
    let w = Math.max(1, Math.round(img.width * scale));
    let h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas not available');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    let dataUrl = canvas.toDataURL('image/jpeg', 0.84);
    if (dataUrl.length > 680000) {
      dataUrl = canvas.toDataURL('image/jpeg', 0.66);
    }
    if (dataUrl.length > 680000) {
      w = Math.max(1, Math.round(w * 0.75));
      h = Math.max(1, Math.round(h * 0.75));
      const small = document.createElement('canvas');
      small.width = w;
      small.height = h;
      const sCtx = small.getContext('2d');
      if (sCtx) {
        sCtx.fillStyle = '#FFFFFF';
        sCtx.fillRect(0, 0, w, h);
        sCtx.drawImage(canvas, 0, 0, w, h);
        dataUrl = small.toDataURL('image/jpeg', 0.65);
      }
    }
    return {
      dataUrl,
      width: w,
      height: h,
    };
  } finally {
    URL.revokeObjectURL(rawUrl);
  }
}

export async function renderPdfPageFromDocument(
  pdfDoc: pdfjsLib.PDFDocumentProxy,
  pageNumber: number,
  scale = 1.65,
  skipText = true
): Promise<{ imageData: string; extractedText: string; needsOcr: boolean }> {
  const page = await pdfDoc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);

  if (ctx) {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  }

  let quality = 0.82;
  let imageData = canvas.toDataURL('image/jpeg', quality);
  // Keep under Firestore 750KB limit
  if (imageData.length > 680000) {
    quality = 0.65;
    imageData = canvas.toDataURL('image/jpeg', quality);
  }
  if (imageData.length > 680000) {
    const smallCanvas = document.createElement('canvas');
    const ratio = 0.72;
    smallCanvas.width = Math.round(canvas.width * ratio);
    smallCanvas.height = Math.round(canvas.height * ratio);
    const sCtx = smallCanvas.getContext('2d');
    if (sCtx) {
      sCtx.drawImage(canvas, 0, 0, smallCanvas.width, smallCanvas.height);
      imageData = smallCanvas.toDataURL('image/jpeg', 0.68);
    }
  }

  if (skipText) {
    return {
      imageData,
      extractedText: '',
      needsOcr: false,
    };
  }

  const textContent = await page.getTextContent();
  const linesMap = new Map<number, { str: string; x: number }[]>();
  for (const item of textContent.items) {
    if (!('str' in item) || !item.str.trim()) continue;
    const yBucket = Math.round((item.transform[5] || 0) / 6) * 6;
    const xPos = item.transform[4] || 0;
    const arr = linesMap.get(yBucket) || [];
    arr.push({ str: item.str, x: xPos });
    linesMap.set(yBucket, arr);
  }

  const sortedY = Array.from(linesMap.keys()).sort((a, b) => b - a);
  const lines: string[] = [];
  for (const y of sortedY) {
    const items = linesMap.get(y) || [];
    const lineSample = items.map((i) => i.str).join(' ');
    if (isArabicText(lineSample)) {
      items.sort((a, b) => b.x - a.x);
    } else {
      items.sort((a, b) => a.x - b.x);
    }
    const joined = items.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();
    if (joined) lines.push(joined);
  }

  const extractedText = lines.join('\n');
  const needsOcr = extractedText.replace(/\s+/g, '').length < 25;

  return {
    imageData,
    extractedText: needsOcr ? '' : extractedText,
    needsOcr,
  };
}

export async function extractPdfTextSnippetOnly(
  pdfDoc: pdfjsLib.PDFDocumentProxy,
  pageNumber: number
): Promise<string> {
  try {
    const page = await pdfDoc.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const joined = textContent.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    return joined;
  } catch {
    return '';
  }
}

export async function renderPdfPageOnDemand(
  bookId: string,
  pageNumber: number,
  skipText = true
): Promise<{ imageData: string; extractedText: string; needsOcr: boolean } | null> {
  const buffer = await getCachedRawPdfBytes(bookId);
  if (!buffer) return null;
  const pdfDoc = await pdfjsLib.getDocument({ data: buffer.slice(0) }).promise;
  if (pageNumber < 1 || pageNumber > pdfDoc.numPages) return null;
  return renderPdfPageFromDocument(pdfDoc, pageNumber, 1.65, skipText);
}

async function extractPdfOutline(pdfDoc: pdfjsLib.PDFDocumentProxy): Promise<ChapterItem[]> {
  try {
    const outline = await pdfDoc.getOutline();
    if (!outline || outline.length === 0) return [];
    const chapters: ChapterItem[] = [];

    const walk = async (items: typeof outline, depth = 0) => {
      for (const item of items) {
        if (chapters.length >= 120) break;
        let pageNum = 1;
        try {
          if (typeof item.dest === 'string') {
            const dest = await pdfDoc.getDestination(item.dest);
            if (dest && dest[0]) {
              const idx = await pdfDoc.getPageIndex(dest[0]);
              pageNum = idx + 1;
            }
          } else if (Array.isArray(item.dest) && item.dest[0]) {
            const idx = await pdfDoc.getPageIndex(item.dest[0]);
            pageNum = idx + 1;
          }
        } catch {
          // Ignore malformed bookmark dest
        }
        chapters.push({
          id: `ch_${chapters.length + 1}`,
          title: (depth > 0 ? '— ' : '') + (item.title || `فصل ${chapters.length + 1}`).trim(),
          startPage: Math.max(1, pageNum),
        });
        if (item.items && item.items.length > 0 && depth < 1) {
          await walk(item.items, depth + 1);
        }
      }
    };

    await walk(outline);
    return chapters;
  } catch {
    return [];
  }
}

function paginateLongText(rawText: string, maxCharsPerPage = 1150): string[] {
  const paragraphs = rawText
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) return ['(ملف فارغ)'];

  const pages: string[] = [];
  let buffer = '';
  for (const para of paragraphs) {
    if (para.length > maxCharsPerPage) {
      if (buffer.trim()) {
        pages.push(buffer.trim());
        buffer = '';
      }
      const sentences = para.split(/(?<=[.!?؟])\s+/);
      for (const s of sentences) {
        if ((buffer + '\n' + s).length > maxCharsPerPage && buffer.trim()) {
          pages.push(buffer.trim());
          buffer = s;
        } else {
          buffer = buffer ? `${buffer} ${s}` : s;
        }
      }
    } else if ((buffer + '\n\n' + para).length > maxCharsPerPage && buffer.trim()) {
      pages.push(buffer.trim());
      buffer = para;
    } else {
      buffer = buffer ? `${buffer}\n\n${para}` : para;
    }
  }
  if (buffer.trim()) pages.push(buffer.trim());
  return pages.length > 0 ? pages : [rawText];
}

async function processPptxFile(file: File): Promise<ProcessedBookInit> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const presXml = await zip.file('ppt/presentation.xml')?.async('text');
  const presRelsXml = await zip.file('ppt/_rels/presentation.xml.rels')?.async('text');
  const parser = new DOMParser();

  let slidePaths: string[] = [];
  if (presXml && presRelsXml) {
    const presDoc = parser.parseFromString(presXml, 'application/xml');
    const relsDoc = parser.parseFromString(presRelsXml, 'application/xml');
    const relMap = new Map<string, string>();
    relsDoc.querySelectorAll('Relationship').forEach((rel) => {
      const id = rel.getAttribute('Id');
      const target = rel.getAttribute('Target');
      if (id && target) relMap.set(id, target);
    });
    presDoc.querySelectorAll('sldId').forEach((sldId) => {
      const rId = sldId.getAttribute('r:id') || sldId.getAttribute('id');
      if (rId && relMap.has(rId)) {
        const target = relMap.get(rId)!.replace(/^\//, '');
        slidePaths.push(target.startsWith('ppt/') ? target : `ppt/${target}`);
      }
    });
  }

  if (slidePaths.length === 0) {
    slidePaths = Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort((a, b) => {
        const numA = parseInt(a.match(/\d+/)?.[0] || '0', 10);
        const numB = parseInt(b.match(/\d+/)?.[0] || '0', 10);
        return numA - numB;
      });
  }

  const totalPages = Math.max(1, slidePaths.length);
  const initialPages: Omit<BookPage, 'userId' | 'bookId'>[] = [];
  const chapters: ChapterItem[] = [];
  const baseTitle = file.name.replace(/\.[^/.]+$/, '');

  for (let i = 0; i < slidePaths.length; i++) {
    const slidePath = slidePaths[i];
    const xmlStr = await zip.file(slidePath)?.async('text');
    const slideDoc = xmlStr ? parser.parseFromString(xmlStr, 'application/xml') : null;

    const paragraphs: string[] = [];
    if (slideDoc) {
      const pNodes = slideDoc.getElementsByTagName('a:p');
      for (let p = 0; p < pNodes.length; p++) {
        const tNodes = pNodes[p].getElementsByTagName('a:t');
        const line = Array.from(tNodes)
          .map((t) => t.textContent || '')
          .join('');
        if (line.trim()) paragraphs.push(line.trim());
      }
    }

    // Check embedded images for slide
    const slideFileName = slidePath.split('/').pop() || '';
    const relsPath = `ppt/slides/_rels/${slideFileName}.rels`;
    const slideRelsXml = await zip.file(relsPath)?.async('text');
    const embeddedImages: HTMLImageElement[] = [];
    if (slideRelsXml) {
      const sRelsDoc = parser.parseFromString(slideRelsXml, 'application/xml');
      const rels = Array.from(sRelsDoc.querySelectorAll('Relationship'));
      for (const rel of rels) {
        const type = rel.getAttribute('Type') || '';
        const target = rel.getAttribute('Target') || '';
        if (type.includes('/image') && target) {
          const cleanMediaPath = target.replace(/^\.\.\//, 'ppt/');
          const mediaFile = zip.file(cleanMediaPath);
          if (mediaFile) {
            try {
              const b64 = await mediaFile.async('base64');
              const ext = cleanMediaPath.split('.').pop()?.toLowerCase() || 'png';
              const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
              const imgEl = await loadImageElement(`data:${mime};base64,${b64}`);
              embeddedImages.push(imgEl);
              break;
            } catch {
              // Skip unreadable media
            }
          }
        }
      }
    }

    const slideTitle = paragraphs[0] || `الشريحة ${i + 1}`;
    const bodyText = paragraphs.slice(1).join('\n') || slideTitle;
    const fullText = paragraphs.join('\n') || `الشريحة ${i + 1}`;
    const imageData = renderTextPageToDataUrl(slideTitle, bodyText, i + 1, totalPages, embeddedImages);

    chapters.push({
      id: `ch_${i + 1}`,
      title: slideTitle.slice(0, 120),
      startPage: i + 1,
    });

    initialPages.push({
      pageNumber: i + 1,
      printedPageLabel: String(i + 1),
      chapterTitle: slideTitle.slice(0, 180),
      imageData,
      extractedText: fullText,
      isCompleted: false,
      isAnalyzed: false,
      ocrApplied: false,
      difficulty: 'medium',
      estimatedMinutes: 5,
    });
  }

  const coverImage = await createCoverThumbnail(initialPages[0]?.imageData || '');

  return {
    title: baseTitle,
    fileType: 'pptx',
    totalPages,
    coverImage,
    chapters: chapters.slice(0, 150),
    initialPages,
  };
}

export async function processUploadedFiles(
  files: File[],
  bookId: string,
  onProgress?: (pct: number, message: string) => void
): Promise<ProcessedBookInit> {
  const primary = files[0];
  const ext = primary.name.split('.').pop()?.toLowerCase() || '';

  // Image files (single or multi-image book)
  if (files.every((f) => f.type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp'].includes(f.name.split('.').pop()?.toLowerCase() || ''))) {
    const pages: Omit<BookPage, 'userId' | 'bookId'>[] = [];
    for (let i = 0; i < files.length; i++) {
      onProgress?.(Math.round(((i + 1) / files.length) * 85), `جاري تجهيز الصورة ${i + 1} من ${files.length}...`);
      const { dataUrl } = await compressImageFile(files[i]);
      pages.push({
        pageNumber: i + 1,
        printedPageLabel: String(i + 1),
        chapterTitle: files.length > 1 ? `صفحة ${i + 1}` : primary.name.replace(/\.[^/.]+$/, ''),
        imageData: dataUrl,
        extractedText: '',
        isCompleted: false,
        isAnalyzed: false,
        ocrApplied: false,
        difficulty: 'medium',
        estimatedMinutes: 8,
      });
    }
    const coverImage = await createCoverThumbnail(pages[0]?.imageData || '');
    return {
      title: primary.name.replace(/\.[^/.]+$/, ''),
      fileType: 'image',
      totalPages: pages.length,
      coverImage,
      chapters: [{ id: 'ch_1', title: 'المحتوى المصور', startPage: 1 }],
      initialPages: pages,
    };
  }

  // PDF file — Fast open: ONLY extract outline + render Page 1 image + small cover thumbnail!
  if (ext === 'pdf' || primary.type === 'application/pdf') {
    onProgress?.(20, 'جاري فتح ملف PDF وتجهيز الغلاف والصفحة الأولى...');
    const buffer = await primary.arrayBuffer();
    await cacheRawPdfBytes(bookId, buffer);

    const pdfDoc = await pdfjsLib.getDocument({ data: buffer.slice(0) }).promise;
    const totalPages = pdfDoc.numPages;
    const chapters = await extractPdfOutline(pdfDoc);

    onProgress?.(60, 'جاري تجهيز الصفحة الأولى للعرض الفوري...');
    const renderedFirst = await renderPdfPageFromDocument(pdfDoc, 1, 1.65, true);
    const coverImage = await createCoverThumbnail(renderedFirst.imageData);

    const initialPages: Omit<BookPage, 'userId' | 'bookId'>[] = [
      {
        pageNumber: 1,
        printedPageLabel: '1',
        chapterTitle: chapters[0]?.startPage === 1 ? chapters[0].title : '',
        imageData: renderedFirst.imageData,
        extractedText: '',
        isCompleted: false,
        isAnalyzed: false,
        ocrApplied: false,
        difficulty: 'medium',
        estimatedMinutes: 8,
      },
    ];

    return {
      title: primary.name.replace(/\.pdf$/i, ''),
      fileType: 'pdf',
      totalPages,
      coverImage,
      chapters,
      initialPages,
      pdfBuffer: buffer,
    };
  }

  // PPTX file
  if (ext === 'pptx') {
    onProgress?.(20, 'جاري تحويل شرائح PowerPoint إلى صفحات مرئية...');
    return processPptxFile(primary);
  }

  // DOCX file
  if (ext === 'docx') {
    onProgress?.(20, 'جاري تجهيز صفحات مستند Word...');
    const buffer = await primary.arrayBuffer();
    const res = await mammoth.extractRawText({ arrayBuffer: buffer });
    const chunks = paginateLongText(res.value || '');
    const title = primary.name.replace(/\.docx$/i, '');
    const initialPages: Omit<BookPage, 'userId' | 'bookId'>[] = chunks.map((text, idx) => ({
      pageNumber: idx + 1,
      printedPageLabel: String(idx + 1),
      chapterTitle: title,
      imageData: renderTextPageToDataUrl(idx === 0 ? title : `${title} — صفحة ${idx + 1}`, text, idx + 1, chunks.length),
      extractedText: text,
      isCompleted: false,
      isAnalyzed: false,
      ocrApplied: false,
      difficulty: 'medium',
      estimatedMinutes: 7,
    }));
    const coverImage = await createCoverThumbnail(initialPages[0]?.imageData || '');
    return {
      title,
      fileType: 'docx',
      totalPages: initialPages.length,
      coverImage,
      chapters: [{ id: 'ch_1', title, startPage: 1 }],
      initialPages,
    };
  }

  // TXT / MD file
  if (ext === 'txt' || ext === 'md' || primary.type.startsWith('text/')) {
    onProgress?.(20, 'جاري تنسيق الملف النصي إلى صفحات مرئية...');
    const text = await primary.text();
    const chunks = paginateLongText(text);
    const title = primary.name.replace(/\.(txt|md)$/i, '');
    const initialPages: Omit<BookPage, 'userId' | 'bookId'>[] = chunks.map((chunk, idx) => ({
      pageNumber: idx + 1,
      printedPageLabel: String(idx + 1),
      chapterTitle: title,
      imageData: renderTextPageToDataUrl(idx === 0 ? title : `${title} — صفحة ${idx + 1}`, chunk, idx + 1, chunks.length),
      extractedText: chunk,
      isCompleted: false,
      isAnalyzed: false,
      ocrApplied: false,
      difficulty: 'medium',
      estimatedMinutes: 7,
    }));
    const coverImage = await createCoverThumbnail(initialPages[0]?.imageData || '');
    return {
      title,
      fileType: 'txt',
      totalPages: initialPages.length,
      coverImage,
      chapters: [{ id: 'ch_1', title, startPage: 1 }],
      initialPages,
    };
  }

  throw new Error('صيغة الملف غير مدعومة حالياً. الصيغ المدعومة هي: PDF، PPTX، الصور (JPG/PNG/WebP)، DOCX، وTXT.');
}
