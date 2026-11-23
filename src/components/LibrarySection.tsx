import React, { useRef, useState } from 'react';
import {
  Upload,
  Search,
  BookOpen,
  Trash2,
  Edit3,
  Check,
  X,
  Loader2,
  FileText,
  TrendingUp,
} from 'lucide-react';
import type { Book } from '../types';

interface LibrarySectionProps {
  books: Book[];
  uploadProgress: { active: boolean; percent: number; message: string };
  backgroundStatus: Record<string, string>;
  schoolAverage?: number | null;
  weakSubjects?: string[];
  onNavigateToGrades?: () => void;
  onUploadFiles: (files: File[]) => Promise<void>;
  onOpenBook: (book: Book) => void;
  onRenameBook: (bookId: string, newTitle: string) => Promise<void>;
  onDeleteBook: (bookId: string) => Promise<void>;
}

export const LibrarySection: React.FC<LibrarySectionProps> = ({
  books,
  uploadProgress,
  backgroundStatus,
  schoolAverage,
  weakSubjects = [],
  onNavigateToGrades,
  onUploadFiles,
  onOpenBook,
  onRenameBook,
  onDeleteBook,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [emptyImgFailed, setEmptyImgFailed] = useState(false);

  const filteredBooks = books.filter((b) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      b.title.toLowerCase().includes(q) ||
      (b.subject || '').toLowerCase().includes(q) ||
      (b.gradeLevel || '').toLowerCase().includes(q)
    );
  });

  const handleFilesSelected = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setUploadError('');
    try {
      await onUploadFiles(Array.from(fileList));
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'تعذر رفع الملف، يرجى التأكد من صيغته.');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const submitRename = async (bookId: string) => {
    if (!titleDraft.trim()) return;
    await onRenameBook(bookId, titleDraft.trim());
    setEditingId(null);
  };

  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Header & Upload Trigger */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">
            مكتبتي الدراسية
          </h1>
        </div>

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadProgress.active}
          className="min-h-[48px] px-6 py-3 rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-semibold text-sm flex items-center justify-center gap-2.5 shadow-sm transition-colors cursor-pointer disabled:opacity-60 whitespace-nowrap shrink-0"
        >
          <Upload className="w-5 h-5" />
          <span>{uploadProgress.active ? 'جاري رفع الكتاب...' : 'رفع كتاب أو ملف جديد'}</span>
        </button>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.pptx,.docx,.txt,.md,image/jpeg,image/png,image/webp"
          onChange={(e) => void handleFilesSelected(e.target.files)}
          className="hidden"
        />
      </div>

      {/* Written Educational Mission Banner */}
      <div className="rounded-2xl bg-gradient-to-l from-blue-50 to-teal-50/70 dark:from-blue-950/40 dark:to-teal-950/30 border border-blue-200/80 dark:border-blue-900 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-700 text-white flex items-center justify-center shrink-0 mt-0.5">
            <TrendingUp className="w-5 h-5" />
          </div>
          <div className="space-y-1">
            <h2 className="font-display font-bold text-sm sm:text-base text-slate-900 dark:text-white">
              هدفنا الأساسي: تحسين وتعديل المستوى العلمي للطالب
            </h2>
            {schoolAverage !== null && schoolAverage !== undefined && (
              <p className="text-xs font-semibold text-teal-800 dark:text-teal-300 pt-0.5">
                معدلك الحالي في سجل درجات الصف: <span className="font-mono-num">{schoolAverage}%</span>
                {weakSubjects.length > 0 && (
                  <span className="text-amber-700 dark:text-amber-300">
                    {' '}· مواد وفصول تحتاج تقوية: {weakSubjects.join('، ')}
                  </span>
                )}
              </p>
            )}
          </div>
        </div>
        {onNavigateToGrades && (
          <button
            type="button"
            onClick={onNavigateToGrades}
            className="min-h-[42px] px-4 rounded-xl bg-white dark:bg-slate-900 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-400 text-xs sm:text-sm font-semibold hover:bg-blue-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
          >
            سجل درجات الصف
          </button>
        )}
      </div>

      {/* Dropzone & Supported Formats */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void handleFilesSelected(e.dataTransfer.files);
        }}
        onClick={() => !uploadProgress.active && fileInputRef.current?.click()}
        className={`rounded-2xl border-2 border-dashed p-5 transition-colors cursor-pointer ${
          dragOver
            ? 'border-blue-600 bg-blue-50/70 dark:bg-blue-950/30'
            : 'border-slate-300 dark:border-slate-700 bg-white/70 dark:bg-slate-900/50 hover:border-blue-400'
        }`}
      >
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-center sm:text-right">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-400 flex items-center justify-center shrink-0">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                اختيار ملف
              </p>
            </div>
          </div>

          {uploadProgress.active && (
            <div className="w-full sm:w-64 space-y-1.5">
              <div className="flex items-center justify-between text-xs font-medium text-blue-700 dark:text-blue-400">
                <span className="truncate">{uploadProgress.message}</span>
                <span className="font-mono-num">{uploadProgress.percent}%</span>
              </div>
              <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-blue-700 transition-all duration-200"
                  style={{ width: `${uploadProgress.percent}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {uploadError && (
        <div
          role="alert"
          className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-sm text-red-700 dark:text-red-300"
        >
          {uploadError}
        </div>
      )}

      {/* Search */}
      {books.length > 0 && (
        <div className="relative">
          <Search className="w-5 h-5 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="ابحث عن كتاب أو مادة دراسية..."
            className="w-full min-h-[46px] pr-11 pl-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>
      )}

      {/* Books Grid or Empty State */}
      {books.length === 0 ? (
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 sm:p-10 grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
          <div className="md:col-span-5 rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-800 aspect-4/3 flex items-center justify-center">
            {!emptyImgFailed ? (
              <img
                src="/src/assets/images/library_empty_desk_1794766023593.jpg"
                alt="كتب دراسية مرتبة على مكتب تعليمي"
                referrerPolicy="no-referrer"
                onError={() => setEmptyImgFailed(true)}
                className="w-full h-full object-cover"
              />
            ) : (
              <BookOpen className="w-12 h-12 text-blue-600" />
            )}
          </div>
          <div className="md:col-span-7 space-y-4">
            <h2 className="font-display text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">
              مكتبتك جاهزة لاستقبال أول كتاب
            </h2>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="min-h-[46px] px-6 rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-semibold text-sm inline-flex items-center gap-2 cursor-pointer"
            >
              <Upload className="w-4 h-4" />
              <span>ابدأ برفع كتابك الأول</span>
            </button>
          </div>
        </div>
      ) : filteredBooks.length === 0 ? (
        <div className="py-12 text-center text-slate-500 dark:text-slate-400">
          لا توجد كتب مطابقة لبحثك «{searchQuery}».
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredBooks.map((book) => {
            const pct = book.totalPages > 0 ? Math.min(100, Math.round((book.completedCount / book.totalPages) * 100)) : 0;
            const bgStatus = backgroundStatus[book.id];
            const isEditing = editingId === book.id;
            const isConfirmDelete = confirmDeleteId === book.id;

            return (
              <article
                key={book.id}
                className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col transition-shadow hover:shadow-md"
              >
                {/* Cover Preview */}
                <div
                  onClick={() => onOpenBook(book)}
                  className="h-44 bg-slate-100 dark:bg-slate-800 relative overflow-hidden cursor-pointer border-b border-slate-100 dark:border-slate-800"
                >
                  {book.coverImage ? (
                    <img
                      src={book.coverImage}
                      alt={`غلاف ${book.title}`}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover object-top"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-400">
                      <BookOpen className="w-10 h-10" />
                    </div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-slate-900/60 to-transparent pointer-events-none" />
                  <span className="absolute bottom-2.5 right-3 text-xs font-medium text-white font-mono-num">
                    صفحة {book.lastPage} من {book.totalPages}
                  </span>
                </div>

                <div className="p-4 flex-1 flex flex-col justify-between gap-4">
                  <div className="space-y-2">
                    {isEditing ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={titleDraft}
                          onChange={(e) => setTitleDraft(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && void submitRename(book.id)}
                          className="flex-1 min-h-[38px] px-2.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-sm font-semibold"
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={() => void submitRename(book.id)}
                          className="p-2 rounded-lg bg-blue-700 text-white cursor-pointer"
                          aria-label="حفظ الاسم"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer"
                          aria-label="إلغاء التعديل"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-2">
                        <h3
                          onClick={() => onOpenBook(book)}
                          className="font-display font-bold text-base text-slate-900 dark:text-white line-clamp-2 cursor-pointer hover:text-blue-700 dark:hover:text-blue-400"
                        >
                          {book.title}
                        </h3>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(book.id);
                            setTitleDraft(book.title);
                          }}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 shrink-0 cursor-pointer"
                          aria-label="تعديل اسم الكتاب"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                      </div>
                    )}

                    {/* Unboxed clean metadata */}
                    <p className="text-xs text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-x-1.5">
                      <span>{book.subject || 'مادة عامة'}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono-num">{book.totalPages} صفحة</span>
                      <span aria-hidden="true">·</span>
                      <span>مواصلة التقدم: ص {book.lastPage}</span>
                    </p>

                    {/* Background Analysis status if active */}
                    {(bgStatus || book.analysisStatus === 'analyzing') && (
                      <div className="flex items-center gap-1.5 text-xs text-blue-700 dark:text-blue-400">
                        <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                        <span className="truncate">
                          {bgStatus || `جاري فهرسة وتحليل الكتاب (${book.analyzedCount}/${book.totalPages})`}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="space-y-3">
                    {/* Actual Study Progress */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-600 dark:text-slate-400">نسبة الإنجاز الفعلية</span>
                        <span className="font-mono-num font-semibold text-teal-700 dark:text-teal-400">
                          {pct}% ({book.completedCount}/{book.totalPages})
                        </span>
                      </div>
                      <div className="w-full h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                        <div
                          className="h-full bg-teal-600 transition-all duration-300"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>

                    {isConfirmDelete ? (
                      <div className="p-2.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-red-700 dark:text-red-300">حذف الكتاب نهائياً؟</span>
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            onClick={() => void onDeleteBook(book.id)}
                            className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-semibold cursor-pointer"
                          >
                            حذف
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs cursor-pointer"
                          >
                            إلغاء
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onOpenBook(book)}
                          className="flex-1 min-h-[44px] px-4 rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
                        >
                          <BookOpen className="w-4 h-4" />
                          <span>أكمل الدراسة</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(book.id)}
                          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-red-600 hover:border-red-200 dark:hover:border-red-900 transition-colors cursor-pointer"
                          aria-label="حذف الكتاب"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
};
