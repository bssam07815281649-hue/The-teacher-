import React, { useRef, useState } from 'react';
import {
  Upload,
  Search,
  BookOpen,
  Trash2,
  Plus,
  ChevronLeft,
  User,
  Target,
} from 'lucide-react';
import type { Book } from '@/src/types';

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
  onUploadFiles,
  onOpenBook,
  onDeleteBook,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState('');

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

  const lastActiveBook = books.length > 0 ? books[0] : null;
  const lastActivePct = lastActiveBook && lastActiveBook.totalPages > 0
    ? Math.min(100, Math.round((lastActiveBook.completedCount / lastActiveBook.totalPages) * 100))
    : 0;

  return (
    <section className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6 pb-24">
      {/* Top Header matching mockup */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-indigo-600/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold text-lg">
            <BookOpen className="w-5 h-5" />
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white">
            مكتبتي
          </h1>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadProgress.active}
            className="min-h-[42px] px-4 py-2 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs sm:text-sm flex items-center gap-1.5 shadow-sm cursor-pointer transition-colors disabled:opacity-60"
          >
            <Plus className="w-4 h-4" />
            <span>{uploadProgress.active ? 'جاري الرفع...' : 'أضف كتابًا'}</span>
          </button>
          <div className="w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 flex items-center justify-center font-bold border border-indigo-200/50 dark:border-indigo-800">
            <User className="w-5 h-5" />
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.pptx,.docx,.txt,.md,image/jpeg,image/png,image/webp"
          onChange={(e) => void handleFilesSelected(e.target.files)}
          className="hidden"
        />
      </div>

      {/* Search Input Bar */}
      {books.length > 0 && (
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="ابحث في كتبك ومناهجك الدراسية..."
            className="w-full min-h-[44px] pr-10 pl-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs sm:text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-600 shadow-xs"
          />
        </div>
      )}

      {uploadError && (
        <div role="alert" className="p-3 rounded-xl bg-red-50 text-red-700 text-xs">
          {uploadError}
        </div>
      )}

      {uploadProgress.active && (
        <div className="p-3 rounded-2xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-900 flex items-center justify-between gap-3">
          <span className="text-xs font-medium text-indigo-900 dark:text-indigo-200 truncate">{uploadProgress.message}</span>
          <span className="text-xs font-mono-num font-bold text-indigo-700">{uploadProgress.percent}%</span>
        </div>
      )}

      {/* "أكمل دراستك" Banner matching mockup */}
      {lastActiveBook && (
        <div
          onClick={() => onOpenBook(lastActiveBook)}
          className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-4 sm:p-5 shadow-xs cursor-pointer hover:border-indigo-400 transition-all flex items-center justify-between gap-4"
        >
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="w-12 h-16 sm:w-14 sm:h-20 rounded-xl bg-slate-100 dark:bg-slate-800 shrink-0 overflow-hidden shadow-xs">
              {lastActiveBook.coverImage ? (
                <img src={lastActiveBook.coverImage} alt={lastActiveBook.title} className="w-full h-full object-cover object-top" />
              ) : (
                <BookOpen className="w-6 h-6 text-indigo-600 m-auto mt-5" />
              )}
            </div>
            <div className="space-y-1.5 min-w-0">
              <div className="flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400 text-xs font-bold">
                <Target className="w-3.5 h-3.5" />
                <span>أكمل دراستك</span>
              </div>
              <h2 className="font-display font-bold text-sm sm:text-base text-slate-900 dark:text-white truncate">
                {lastActiveBook.title}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                تابع من الصفحة <span className="font-mono-num font-semibold">{lastActiveBook.lastPage}</span>
              </p>
              <div className="w-40 sm:w-56 h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                <div className="h-full bg-indigo-600 rounded-full" style={{ width: `${lastActivePct}%` }} />
              </div>
            </div>
          </div>
          <div className="w-9 h-9 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 flex items-center justify-center shrink-0">
            <ChevronLeft className="w-5 h-5" />
          </div>
        </div>
      )}

      {/* Books Grid matching mockup (2 columns on mobile, 3-4 on desktop) */}
      {books.length === 0 ? (
        <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-8 text-center space-y-4">
          <BookOpen className="w-12 h-12 text-indigo-600 mx-auto" />
          <h3 className="font-display font-bold text-lg text-slate-900 dark:text-white">مكتبتك فارغة حالياً</h3>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="px-5 py-2.5 rounded-2xl bg-indigo-600 text-white text-sm font-semibold cursor-pointer"
          >
            رفع كتاب الآن
          </button>
        </div>
      ) : filteredBooks.length === 0 ? (
        <div className="py-12 text-center text-slate-500">لا توجد نتائج مطابقة لبحثك.</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-5">
          {filteredBooks.map((book) => {
            const pct = book.totalPages > 0 ? Math.min(100, Math.round((book.completedCount / book.totalPages) * 100)) : 0;
            const isConfirmDelete = confirmDeleteId === book.id;

            return (
              <article
                key={book.id}
                className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 overflow-hidden flex flex-col shadow-xs hover:shadow-md transition-all group"
              >
                {/* Book Cover */}
                <div
                  onClick={() => onOpenBook(book)}
                  className="aspect-3/4 bg-slate-100 dark:bg-slate-800 relative overflow-hidden cursor-pointer"
                >
                  {book.coverImage ? (
                    <img
                      src={book.coverImage}
                      alt={book.title}
                      className="w-full h-full object-cover object-top group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-400">
                      <BookOpen className="w-8 h-8" />
                    </div>
                  )}
                  {/* Delete button top left */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDeleteId(book.id);
                    }}
                    className="absolute top-2.5 left-2.5 w-7 h-7 rounded-full bg-black/40 backdrop-blur-md text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                    title="حذف الكتاب"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Book Info */}
                <div className="p-3.5 flex-1 flex flex-col justify-between gap-2.5">
                  <div className="space-y-1">
                    <h3
                      onClick={() => onOpenBook(book)}
                      className="font-display font-bold text-xs sm:text-sm text-slate-900 dark:text-white line-clamp-2 cursor-pointer hover:text-indigo-600"
                    >
                      {book.title}
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
                      <BookOpen className="w-3 h-3" />
                      <span>آخر صفحة: {book.lastPage}</span>
                    </p>
                  </div>

                  <div className="space-y-1.5 pt-1 border-t border-slate-100 dark:border-slate-800">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-mono-num font-bold text-indigo-600 dark:text-indigo-400">{pct}%</span>
                      <span className="text-slate-400 text-[10px]">{book.totalPages} ص</span>
                    </div>
                    <div className="w-full h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      <div className="h-full bg-indigo-600 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                  </div>

                  {isConfirmDelete && (
                    <div className="p-2 rounded-xl bg-red-50 dark:bg-red-950/50 text-center space-y-1.5">
                      <p className="text-[10px] text-red-700 font-semibold">حذف الكتاب؟</p>
                      <div className="flex gap-1 justify-center">
                        <button
                          type="button"
                          onClick={() => void onDeleteBook(book.id)}
                          className="px-2 py-1 bg-red-600 text-white text-[10px] rounded-lg"
                        >
                          نعم
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="px-2 py-1 bg-slate-200 text-slate-800 text-[10px] rounded-lg"
                        >
                          إلغاء
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
};
