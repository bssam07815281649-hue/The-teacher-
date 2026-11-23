import React, { useState } from 'react';
import { X, Plus, Trash2, Edit3, BookOpen, Check } from 'lucide-react';
import type { Note } from '../types';

interface NotesDrawerProps {
  open: boolean;
  onClose: () => void;
  notes: Note[];
  currentBookId?: string;
  currentBookTitle?: string;
  currentChapterTitle?: string;
  currentPage?: number;
  onCreateManualNote: (title: string, content: string) => Promise<void>;
  onUpdateNote: (noteId: string, title: string, content: string) => Promise<void>;
  onDeleteNote: (noteId: string) => Promise<void>;
  onOpenNoteSource: (bookId: string, pageNumber: number) => void;
}

export const NotesDrawer: React.FC<NotesDrawerProps> = ({
  open,
  onClose,
  notes,
  currentBookId,
  currentPage,
  onCreateManualNote,
  onUpdateNote,
  onDeleteNote,
  onOpenNoteSource,
}) => {
  const [filterBookOnly, setFilterBookOnly] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  const visibleNotes =
    filterBookOnly && currentBookId ? notes.filter((n) => n.bookId === currentBookId) : notes;

  const handleSaveNew = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newContent.trim()) return;
    setSaving(true);
    try {
      await onCreateManualNote(newTitle.trim(), newContent.trim());
      setNewTitle('');
      setNewContent('');
      setAdding(false);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEdit = async (noteId: string) => {
    if (!editTitle.trim() || !editContent.trim()) return;
    setSaving(true);
    try {
      await onUpdateNote(noteId, editTitle.trim(), editContent.trim());
      setEditingId(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex justify-end">
      <div className="w-full max-w-lg bg-white dark:bg-slate-900 h-full border-r border-slate-200 dark:border-slate-800 flex flex-col shadow-2xl">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-display font-bold text-lg text-slate-900 dark:text-white">
              الملاحظات الشخصية
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {visibleNotes.length} ملاحظة محفوظة في حسابك
            </p>
          </div>
          <div className="flex items-center gap-2">
            {currentBookId && (
              <button
                type="button"
                onClick={() => setAdding((v) => !v)}
                className="min-h-[40px] px-3 rounded-xl bg-blue-700 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>ملاحظة جديدة</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              aria-label="إغلاق الملاحظات"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {currentBookId && (
          <div className="px-5 py-2.5 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setFilterBookOnly(true)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                filterBookOnly
                  ? 'bg-slate-900 dark:bg-slate-700 text-white'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              هذا الكتاب
            </button>
            <button
              type="button"
              onClick={() => setFilterBookOnly(false)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                !filterBookOnly
                  ? 'bg-slate-900 dark:bg-slate-700 text-white'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              جميع الكتب
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-5 space-y-4 thin-scrollbar">
          {adding && currentBookId && (
            <form
              onSubmit={handleSaveNew}
              className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 space-y-3"
            >
              <p className="text-xs font-semibold text-blue-700 dark:text-blue-400">
                إضافة ملاحظة مرتبطة بالصفحة {currentPage || 1}
              </p>
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="عنوان الملاحظة..."
                required
                className="w-full min-h-[40px] px-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
              />
              <textarea
                rows={4}
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                placeholder="اكتب ملاحظتك أو التلخيص المهم هنا..."
                required
                className="w-full p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
              />
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setAdding(false)}
                  className="min-h-[38px] px-4 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="min-h-[38px] px-4 rounded-lg bg-blue-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-60"
                >
                  {saving ? 'جاري الحفظ...' : 'حفظ الملاحظة'}
                </button>
              </div>
            </form>
          )}

          {visibleNotes.length === 0 ? (
            <div className="py-16 text-center space-y-2 text-slate-500 dark:text-slate-400">
              <p className="font-semibold text-slate-700 dark:text-slate-300">لا توجد ملاحظات محفوظة بعد</p>
            </div>
          ) : (
            visibleNotes.map((note) => {
              const isEditing = editingId === note.id;
              return (
                <article
                  key={note.id}
                  className="p-4 rounded-xl bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 space-y-2.5"
                >
                  {isEditing ? (
                    <div className="space-y-2.5">
                      <input
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        className="w-full min-h-[40px] px-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm font-semibold"
                      />
                      <textarea
                        rows={4}
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        className="w-full p-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
                      />
                      <div className="flex gap-2 justify-end">
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs cursor-pointer"
                        >
                          إلغاء
                        </button>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => void handleSaveEdit(note.id)}
                          className="px-3 py-1.5 rounded-lg bg-blue-700 text-white text-xs font-semibold flex items-center gap-1 cursor-pointer"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>حفظ التعديل</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-0.5 min-w-0">
                          <h3 className="font-semibold text-sm text-slate-900 dark:text-white">
                            {note.title}
                          </h3>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {note.bookTitle}
                            {note.chapterTitle ? ` · ${note.chapterTitle}` : ''} · صفحة {note.pageNumber}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(note.id);
                              setEditTitle(note.title);
                              setEditContent(note.content);
                            }}
                            className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                            aria-label="تعديل الملاحظة"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void onDeleteNote(note.id)}
                            className="p-2 rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 cursor-pointer"
                            aria-label="حذف الملاحظة"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {note.selectedText && (
                        <blockquote className="text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-900/70 p-2.5 rounded-lg border border-slate-200/70 dark:border-slate-700/70">
                          «{note.selectedText}»
                        </blockquote>
                      )}

                      <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed whitespace-pre-wrap">
                        {note.content}
                      </p>

                      <div className="pt-1">
                        <button
                          type="button"
                          onClick={() => {
                            onOpenNoteSource(note.bookId, note.pageNumber);
                            onClose();
                          }}
                          className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 dark:text-blue-400 hover:underline cursor-pointer"
                        >
                          <BookOpen className="w-3.5 h-3.5" />
                          <span>العودة إلى الصفحة الأصلية (صفحة {note.pageNumber})</span>
                        </button>
                      </div>
                    </>
                  )}
                </article>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
