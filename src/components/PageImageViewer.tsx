import React, { useEffect, useRef, useState } from 'react';
import {
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Maximize2,
  Minimize2,
  Crop,
  Sparkles,
  BookmarkPlus,
  X,
  Loader2,
  ChevronRight,
  ChevronLeft,
  Phone,
  PhoneOff,
  Mic,
  MicOff,
} from 'lucide-react';
import type { LiveConnectionState } from '../types';

interface PageImageViewerProps {
  imageData?: string;
  pageNumber: number;
  totalPages?: number;
  zoom: number;
  onZoomChange: (nextZoom: number) => void;
  onPrevPage?: () => void;
  onNextPage?: () => void;
  croppedImage: string | null;
  onCropComplete: (croppedDataUrl: string | null) => void;
  onExplainCroppedDiagram: () => void;
  onSaveCroppedAsNote: () => void;
  loadingPage: boolean;
  liveState?: LiveConnectionState;
  liveMuted?: boolean;
  onStartLiveCall?: () => Promise<void>;
  onEndLiveCall?: () => void;
  onToggleLiveMute?: () => void;
}

interface BoxCoords {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

export const PageImageViewer: React.FC<PageImageViewerProps> = ({
  imageData,
  pageNumber,
  totalPages,
  zoom,
  onZoomChange,
  onPrevPage,
  onNextPage,
  croppedImage,
  onCropComplete,
  onExplainCroppedDiagram,
  onSaveCroppedAsNote,
  loadingPage,
  liveState = 'disconnected',
  liveMuted = false,
  onStartLiveCall,
  onEndLiveCall,
  onToggleLiveMute,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [cropMode, setCropMode] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [box, setBox] = useState<BoxCoords | null>(null);

  useEffect(() => {
    if (!fullscreen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setFullscreen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [fullscreen]);

  const getRelativePoint = (clientX: number, clientY: number) => {
    const img = imgRef.current;
    if (!img) return null;
    const rect = img.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, clientY - rect.top));
    return { x, y, rect };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!cropMode || !imgRef.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const pt = getRelativePoint(e.clientX, e.clientY);
    if (!pt) return;
    setDrawing(true);
    setBox({ startX: pt.x, startY: pt.y, endX: pt.x, endY: pt.y });
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!cropMode || !drawing || !box) return;
    const pt = getRelativePoint(e.clientX, e.clientY);
    if (!pt) return;
    setBox({ ...box, endX: pt.x, endY: pt.y });
  };

  const handlePointerUp = () => {
    if (!cropMode || !drawing || !box || !imgRef.current) return;
    setDrawing(false);

    const rect = imgRef.current.getBoundingClientRect();
    const x = Math.min(box.startX, box.endX);
    const y = Math.min(box.startY, box.endY);
    const w = Math.abs(box.endX - box.startX);
    const h = Math.abs(box.endY - box.startY);

    if (w < 18 || h < 18 || rect.width === 0 || rect.height === 0) {
      setBox(null);
      return;
    }

    const scaleX = imgRef.current.naturalWidth / rect.width;
    const scaleY = imgRef.current.naturalHeight / rect.height;

    const canvas = document.createElement('canvas');
    const sx = Math.max(0, Math.round(x * scaleX));
    const sy = Math.max(0, Math.round(y * scaleY));
    const sw = Math.max(10, Math.round(w * scaleX));
    const sh = Math.max(10, Math.round(h * scaleY));

    // Upscale small diagrams slightly if needed for sharper vision reading
    const targetScale = sw < 600 ? 1.5 : 1;
    canvas.width = Math.round(sw * targetScale);
    canvas.height = Math.round(sh * targetScale);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(imgRef.current, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      onCropComplete(canvas.toDataURL('image/jpeg', 0.92));
    }
    setCropMode(false);
    setBox(null);
  };

  const boxStyle = box
    ? {
        left: `${Math.min(box.startX, box.endX)}px`,
        top: `${Math.min(box.startY, box.endY)}px`,
        width: `${Math.abs(box.endX - box.startX)}px`,
        height: `${Math.abs(box.endY - box.startY)}px`,
      }
    : undefined;

  const viewerBody = (
    <div
      className={`flex flex-col bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden ${
        fullscreen ? 'flex-1 h-full w-full' : ''
      }`}
    >
      {/* Toolbar */}
      <div className="px-3 sm:px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 bg-slate-50/70 dark:bg-slate-900">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onZoomChange(Math.min(2.6, Number((zoom + 0.25).toFixed(2))))}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 cursor-pointer"
            aria-label="تكبير الصفحة"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => onZoomChange(Math.max(0.6, Number((zoom - 0.25).toFixed(2))))}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 cursor-pointer"
            aria-label="تصغير الصفحة"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="px-2 text-xs font-mono-num text-slate-600 dark:text-slate-400">
            {Math.round(zoom * 100)}%
          </span>
          {zoom !== 1 && (
            <button
              type="button"
              onClick={() => onZoomChange(1)}
              className="min-h-[40px] px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-300 flex items-center gap-1 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>إعادة</span>
            </button>
          )}
        </div>

        {/* Fullscreen Page Navigation & Live Call strip so student can follow tutor in fullscreen */}
        {fullscreen && (
          <div className="flex flex-wrap items-center gap-2">
            {onPrevPage && onNextPage && (
              <div className="flex items-center gap-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-1">
                <button
                  type="button"
                  disabled={pageNumber <= 1}
                  onClick={onPrevPage}
                  className="min-h-[34px] px-2.5 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center gap-1 cursor-pointer disabled:opacity-40"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                  <span>السابقة</span>
                </button>
                <span className="px-2 text-xs font-mono-num font-bold text-slate-800 dark:text-slate-100">
                  ص {pageNumber}
                  {totalPages ? ` / ${totalPages}` : ''}
                </span>
                <button
                  type="button"
                  disabled={totalPages !== undefined && pageNumber >= totalPages}
                  onClick={onNextPage}
                  className="min-h-[34px] px-2.5 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center gap-1 cursor-pointer disabled:opacity-40"
                >
                  <span>التالية</span>
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {onStartLiveCall && onEndLiveCall && (
              <div className="flex items-center gap-1.5">
                {liveState === 'disconnected' || liveState === 'error' ? (
                  <button
                    type="button"
                    onClick={() => void onStartLiveCall()}
                    title="اتصال مع المعلم"
                    aria-label="اتصال مع المعلم"
                    className="w-9 h-9 rounded-full bg-teal-700 hover:bg-teal-800 text-white flex items-center justify-center cursor-pointer"
                  >
                    <Phone className="w-4 h-4" />
                  </button>
                ) : (
                  <>
                    {onToggleLiveMute && liveState !== 'connecting' && (
                      <button
                        type="button"
                        onClick={onToggleLiveMute}
                        title={liveMuted ? 'فتح الميكروفون' : 'كتم الميكروفون'}
                        aria-label={liveMuted ? 'فتح الميكروفون' : 'كتم الميكروفون'}
                        className={`w-9 h-9 rounded-full flex items-center justify-center border cursor-pointer ${
                          liveMuted
                            ? 'bg-amber-600 text-white border-amber-600'
                            : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        {liveMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={onEndLiveCall}
                      title="إنهاء المكالمة"
                      aria-label="إنهاء المكالمة"
                      className="w-9 h-9 rounded-full bg-red-600 hover:bg-red-700 text-white flex items-center justify-center cursor-pointer"
                    >
                      <PhoneOff className="w-4 h-4" />
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setCropMode((v) => !v);
              setBox(null);
            }}
            className={`min-h-[40px] px-3.5 rounded-xl text-xs sm:text-sm font-semibold flex items-center gap-1.5 border transition-colors cursor-pointer ${
              cropMode
                ? 'bg-blue-700 text-white border-blue-700'
                : 'bg-white dark:bg-slate-800 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800 hover:bg-blue-50 dark:hover:bg-blue-950/40'
            }`}
          >
            <Crop className="w-4 h-4" />
            <span>{cropMode ? 'اسحب لتحديد الرسم...' : 'تحديد رسم أو شكل للشرح'}</span>
          </button>

          <button
            type="button"
            onClick={() => setFullscreen((v) => !v)}
            className={`min-h-[40px] px-3 rounded-lg border flex items-center gap-1.5 text-xs font-semibold cursor-pointer ${
              fullscreen
                ? 'bg-slate-900 dark:bg-slate-700 text-white border-slate-900 dark:border-slate-600'
                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200'
            }`}
            aria-label={fullscreen ? 'إغلاق ملء الشاشة' : 'عرض الصفحة بملء الشاشة'}
          >
            {fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            {fullscreen && <span>إغلاق</span>}
          </button>
        </div>
      </div>

      {cropMode && (
        <div className="px-4 py-2 bg-blue-50 dark:bg-blue-950/50 border-b border-blue-200 dark:border-blue-900 text-xs text-blue-800 dark:text-blue-300 flex items-center justify-between">
          <span>اسحب بالإصبع أو الفأرة فوق الرسم أو المعادلة أو الجدول داخل الصفحة لاقتطاعه بدقة عالية.</span>
          <button
            type="button"
            onClick={() => setCropMode(false)}
            className="font-semibold underline cursor-pointer"
          >
            إلغاء
          </button>
        </div>
      )}

      {/* Image Canvas Container */}
      <div
        ref={containerRef}
        className={`relative overflow-auto bg-slate-100 dark:bg-slate-950 flex justify-center items-start p-3 sm:p-5 ${
          fullscreen ? 'flex-1' : 'max-h-[70vh] min-h-[340px]'
        }`}
      >
        {loadingPage ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-500">
            <Loader2 className="w-8 h-8 animate-spin text-blue-700" />
            <span className="text-sm">جاري تحميل الصفحة {pageNumber}...</span>
          </div>
        ) : imageData ? (
          <div
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onClick={() => {
              if (!cropMode && !fullscreen) {
                setFullscreen(true);
              }
            }}
            role={!cropMode && !fullscreen ? 'button' : undefined}
            tabIndex={!cropMode && !fullscreen ? 0 : undefined}
            onKeyDown={(e) => {
              if (!cropMode && !fullscreen && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                setFullscreen(true);
              }
            }}
            title={!cropMode && !fullscreen ? 'اضغط لعرض الصفحة بملء الشاشة' : undefined}
            aria-label={!cropMode && !fullscreen ? `عرض الصفحة ${pageNumber} بملء الشاشة` : undefined}
            className={`relative inline-block select-none ${
              cropMode ? 'cursor-crosshair touch-none' : !fullscreen ? 'cursor-zoom-in' : ''
            }`}
            style={{
              width: `${Math.round(zoom * 100)}%`,
              maxWidth: zoom <= 1 ? (fullscreen ? '980px' : '760px') : 'none',
            }}
          >
            <img
              ref={imgRef}
              src={imageData}
              alt={`صورة الصفحة ${pageNumber} من الكتاب`}
              draggable={false}
              referrerPolicy="no-referrer"
              className="w-full h-auto rounded-lg shadow-sm border border-slate-200 dark:border-slate-800 block"
            />
            {boxStyle && (
              <div
                style={boxStyle}
                className="absolute border-2 border-blue-600 bg-blue-500/20 pointer-events-none rounded-xs"
              />
            )}
          </div>
        ) : (
          <div className="py-20 text-center text-sm text-slate-500">
            تعذر عرض صورة الصفحة {pageNumber}.
          </div>
        )}
      </div>

      {/* Cropped Diagram Action Bar */}
      {croppedImage && (
        <div className="p-3 sm:p-4 bg-blue-50/70 dark:bg-slate-800/90 border-t border-blue-200 dark:border-slate-700 flex flex-col sm:flex-row items-center gap-4">
          <img
            src={croppedImage}
            alt="الرسم المحدد للشرح"
            referrerPolicy="no-referrer"
            className="w-24 h-20 object-contain rounded-lg bg-white border border-slate-200 dark:border-slate-700 shrink-0"
          />
          <div className="flex-1 text-center sm:text-right">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">
              تم تحديد جزء من الصفحة بدقة عالية
            </p>
            <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
              سيرى المعلم الذكي هذا الرسم مباشرة ويشرح أجزاءه وتسمياته وأسهمه.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onExplainCroppedDiagram}
              className="min-h-[42px] px-4 rounded-xl bg-blue-700 hover:bg-blue-800 text-white text-xs sm:text-sm font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <Sparkles className="w-4 h-4" />
              <span>اشرح لي هذا الرسم</span>
            </button>
            <button
              type="button"
              onClick={onSaveCroppedAsNote}
              className="min-h-[42px] px-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <BookmarkPlus className="w-4 h-4" />
              <span>حفظ كملاحظة</span>
            </button>
            <button
              type="button"
              onClick={() => onCropComplete(null)}
              className="min-h-[42px] min-w-[42px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-200/60 dark:hover:bg-slate-700 cursor-pointer"
              aria-label="إلغاء التحديد"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );

  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-50 bg-slate-950/95 p-2 sm:p-4 flex flex-col">
        {viewerBody}
      </div>
    );
  }

  return viewerBody;
};
