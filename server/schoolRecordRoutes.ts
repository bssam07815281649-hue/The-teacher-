import { Router, type NextFunction, type Request, type Response } from 'express';
import { Type, ThinkingLevel, type GoogleGenAI } from '@google/genai';
import type {
  ImportBoundingBox,
  ImportExtractedCell,
  ImportExtractedRow,
  ImportExtractionResult,
  SchoolSessionUser,
  SchoolUserRole,
} from '../src/types';
import { parseRawCellValue } from '../src/utils/arabicNameMatch';
import { SchoolRecordError, type SchoolRecordStore } from './schoolRecordStore';

interface SchoolAuthedRequest extends Request {
  schoolSession?: SchoolSessionUser;
}

function stripDataUrlPrefix(dataUrl?: string): { mimeType: string; data: string } | null {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const match = dataUrl.match(/^data:([^;,]+)(?:;[^,]+)?;base64,(.+)$/);
  if (match) {
    return { mimeType: match[1], data: match[2] };
  }
  return null;
}

function sendError(res: Response, err: unknown) {
  if (err instanceof SchoolRecordError) {
    res.status(err.statusCode).json({
      error: err.message,
      ...(err.retryAfterSeconds ? { retryAfterSeconds: err.retryAfterSeconds } : {}),
    });
    return;
  }
  console.error('School record route error:', err);
  res.status(500).json({ error: 'حدث خطأ غير متوقع في خادم سجل الطالب الذكي.' });
}

export function createSchoolRecordRouter(
  store: SchoolRecordStore,
  options?: {
    getAiClient?: () => GoogleGenAI;
    geminiTextModel?: string;
    verifyFirebaseIdToken?: (
      idToken: string
    ) => Promise<{ uid: string; email: string; emailVerified: boolean; displayName?: string } | null>;
  }
): Router {
  const router = Router();

  const requireSchoolSession = (req: SchoolAuthedRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const session = store.verifySessionToken(token);
    if (!session) {
      res.status(401).json({ error: 'انتهت الجلسة أو تم تغيير/إبطال الكود. يرجى تسجيل الدخول بالكود مجدداً.' });
      return;
    }
    req.schoolSession = session;
    next();
  };

  const requireRoles = (allowed: SchoolUserRole[]) => {
    return (req: SchoolAuthedRequest, res: Response, next: NextFunction) => {
      if (!req.schoolSession || !allowed.includes(req.schoolSession.role)) {
        res.status(403).json({ error: 'ليس لديك الصلاحية لتنفيذ هذه العملية.' });
        return;
      }
      next();
    };
  };

  // === Public & Unified Code Auth ===

  router.get('/public', (_req, res) => {
    try {
      res.json(store.getPublicPayload());
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post('/auth/login', async (req, res) => {
    try {
      const { code } = (req.body || {}) as { code?: string };
      const clientKey = String(req.ip || req.socket.remoteAddress || 'unknown');
      const result = await store.loginWithCode(String(code || ''), clientKey);
      res.json(result);
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post('/auth/google-admin', async (req, res) => {
    try {
      if (!options?.verifyFirebaseIdToken) {
        throw new SchoolRecordError(500, 'خدمة التحقق من حساب Google غير مفعّلة على الخادم.');
      }
      const { idToken, code, initialCode } = (req.body || {}) as {
        idToken?: string;
        code?: string;
        initialCode?: string;
      };
      const cleanToken = typeof idToken === 'string' ? idToken.trim() : '';
      if (!cleanToken) {
        throw new SchoolRecordError(400, 'رمز التحقق من Google مفقود.');
      }
      const verified = await options.verifyFirebaseIdToken(cleanToken);
      if (!verified) {
        throw new SchoolRecordError(401, 'رمز الدخول من Google غير صالح أو منتهي الصلاحية.');
      }
      const clientKey = String(req.ip || req.socket.remoteAddress || 'unknown');
      const result = await store.loginWithVerifiedGoogleAdmin(
        {
          verified,
          code: typeof code === 'string' ? code : undefined,
          initialCode: typeof initialCode === 'string' ? initialCode : undefined,
        },
        clientKey
      );
      res.json(result);
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post('/auth/logout', requireSchoolSession, (req: SchoolAuthedRequest, res) => {
    try {
      store.recordLogout(req.schoolSession!);
      res.json({ ok: true });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get('/auth/me', requireSchoolSession, (req: SchoolAuthedRequest, res) => {
    res.json({ session: req.schoolSession });
  });

  router.get('/workspace', requireSchoolSession, (req: SchoolAuthedRequest, res) => {
    try {
      res.json(store.getWorkspaceForSession(req.schoolSession!));
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get('/my-record', requireSchoolSession, requireRoles(['student']), (req: SchoolAuthedRequest, res) => {
    try {
      res.json(store.getStudentPersonalReport(req.schoolSession!));
    } catch (err) {
      sendError(res, err);
    }
  });

  // === Principal (Admin) Endpoints ===

  router.put('/school', requireSchoolSession, requireRoles(['admin']), (req: SchoolAuthedRequest, res) => {
    try {
      const updated = store.updateSchoolProfile(req.schoolSession!, req.body || {});
      res.json({ school: updated });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.put('/admin/code', requireSchoolSession, requireRoles(['admin']), async (req: SchoolAuthedRequest, res) => {
    try {
      const { newCode } = (req.body || {}) as { newCode?: string };
      await store.rotateAdminCode(req.schoolSession!, String(newCode || ''));
      res.json({ ok: true });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post('/announcements', requireSchoolSession, requireRoles(['admin']), (req: SchoolAuthedRequest, res) => {
    try {
      const ann = store.upsertAnnouncement(req.schoolSession!, req.body || {});
      res.json({ announcement: ann });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.put('/announcements/:id', requireSchoolSession, requireRoles(['admin']), (req: SchoolAuthedRequest, res) => {
    try {
      const ann = store.upsertAnnouncement(req.schoolSession!, {
        ...(req.body || {}),
        id: String(req.params.id),
      });
      res.json({ announcement: ann });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.delete('/announcements/:id', requireSchoolSession, requireRoles(['admin']), (req: SchoolAuthedRequest, res) => {
    try {
      store.deleteAnnouncement(req.schoolSession!, String(req.params.id));
      res.json({ ok: true });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post('/stages', requireSchoolSession, requireRoles(['admin']), (req: SchoolAuthedRequest, res) => {
    try {
      const stage = store.upsertStage(req.schoolSession!, req.body || {});
      res.json({ stage });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.put('/stages/:id', requireSchoolSession, requireRoles(['admin']), (req: SchoolAuthedRequest, res) => {
    try {
      const stage = store.upsertStage(req.schoolSession!, {
        ...(req.body || {}),
        id: String(req.params.id),
      });
      res.json({ stage });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post('/stages/reorder', requireSchoolSession, requireRoles(['admin']), (req: SchoolAuthedRequest, res) => {
    try {
      const { orderedStageIds } = (req.body || {}) as { orderedStageIds?: string[] };
      store.reorderStages(req.schoolSession!, orderedStageIds || []);
      res.json({ ok: true });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.delete('/stages/:id', requireSchoolSession, requireRoles(['admin']), (req: SchoolAuthedRequest, res) => {
    try {
      store.deleteStage(req.schoolSession!, String(req.params.id));
      res.json({ ok: true });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post('/sections', requireSchoolSession, requireRoles(['admin']), (req: SchoolAuthedRequest, res) => {
    try {
      const section = store.upsertSection(req.schoolSession!, req.body || {});
      res.json({ section });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.put('/sections/:id', requireSchoolSession, requireRoles(['admin']), (req: SchoolAuthedRequest, res) => {
    try {
      const section = store.upsertSection(req.schoolSession!, {
        ...(req.body || {}),
        id: String(req.params.id),
      });
      res.json({ section });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.delete('/sections/:id', requireSchoolSession, requireRoles(['admin']), (req: SchoolAuthedRequest, res) => {
    try {
      store.deleteSection(req.schoolSession!, String(req.params.id));
      res.json({ ok: true });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post(
    '/sections/:sectionId/counselor-code',
    requireSchoolSession,
    requireRoles(['admin']),
    async (req: SchoolAuthedRequest, res) => {
      try {
        const { action, code } = (req.body || {}) as {
          action?: 'issue' | 'change' | 'revoke';
          code?: string;
        };
        const section = await store.setCounselorCode(
          req.schoolSession!,
          String(req.params.sectionId),
          action || 'issue',
          code
        );
        res.json({ section });
      } catch (err) {
        sendError(res, err);
      }
    }
  );

  router.put('/firebase-link', requireSchoolSession, requireRoles(['admin']), (req: SchoolAuthedRequest, res) => {
    try {
      const firebaseSync = store.updateFirebaseLink(req.schoolSession!, req.body || {});
      res.json({ firebaseSync });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get('/audit-logs', requireSchoolSession, requireRoles(['admin']), (req: SchoolAuthedRequest, res) => {
    try {
      const ws = store.getWorkspaceForSession(req.schoolSession!);
      res.json({ auditLogs: ws.auditLogs });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post('/backups/snapshot', requireSchoolSession, requireRoles(['admin']), (req: SchoolAuthedRequest, res) => {
    try {
      const backup = store.createLocalBackupSnapshot(req.schoolSession!);
      res.json({ backup, backups: store.listBackups(req.schoolSession!.schoolId) });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get('/backups/export', requireSchoolSession, requireRoles(['admin']), (req: SchoolAuthedRequest, res) => {
    try {
      res.json(store.exportSanitizedData(req.schoolSession!.schoolId));
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post('/backups/restore', requireSchoolSession, requireRoles(['admin']), (req: SchoolAuthedRequest, res) => {
    try {
      const { fileName, backupData } = (req.body || {}) as {
        fileName?: string;
        backupData?: ReturnType<SchoolRecordStore['exportSanitizedData']>;
      };
      store.restoreSanitizedBackup(req.schoolSession!, fileName, backupData);
      res.json({ ok: true, workspace: store.getWorkspaceForSession(req.schoolSession!) });
    } catch (err) {
      sendError(res, err);
    }
  });

  // === Counselor & Admin Section-Scoped Endpoints ===

  router.post(
    '/sections/:sectionId/students',
    requireSchoolSession,
    requireRoles(['admin', 'counselor']),
    (req: SchoolAuthedRequest, res) => {
      try {
        const student = store.upsertStudent(req.schoolSession!, String(req.params.sectionId), req.body || {});
        res.json({ student });
      } catch (err) {
        sendError(res, err);
      }
    }
  );

  router.put(
    '/sections/:sectionId/students/:studentId',
    requireSchoolSession,
    requireRoles(['admin', 'counselor']),
    (req: SchoolAuthedRequest, res) => {
      try {
        const student = store.upsertStudent(req.schoolSession!, String(req.params.sectionId), {
          ...(req.body || {}),
          id: String(req.params.studentId),
        });
        res.json({ student });
      } catch (err) {
        sendError(res, err);
      }
    }
  );

  router.delete(
    '/sections/:sectionId/students/:studentId',
    requireSchoolSession,
    requireRoles(['admin', 'counselor']),
    (req: SchoolAuthedRequest, res) => {
      try {
        store.deleteStudent(req.schoolSession!, String(req.params.sectionId), String(req.params.studentId));
        res.json({ ok: true });
      } catch (err) {
        sendError(res, err);
      }
    }
  );

  router.post(
    '/sections/:sectionId/students/bulk-codes',
    requireSchoolSession,
    requireRoles(['admin', 'counselor']),
    async (req: SchoolAuthedRequest, res) => {
      try {
        const { mode } = (req.body || {}) as { mode?: 'missing_only' | 'regenerate_all' };
        const result = await store.bulkIssueStudentCodes(
          req.schoolSession!,
          String(req.params.sectionId),
          mode === 'regenerate_all' ? 'regenerate_all' : 'missing_only'
        );
        res.json(result);
      } catch (err) {
        sendError(res, err);
      }
    }
  );

  router.post(
    '/sections/:sectionId/students/:studentId/code',
    requireSchoolSession,
    requireRoles(['admin', 'counselor']),
    async (req: SchoolAuthedRequest, res) => {
      try {
        const { action, code } = (req.body || {}) as {
          action?: 'issue' | 'change' | 'revoke';
          code?: string;
        };
        const student = await store.setStudentCode(
          req.schoolSession!,
          String(req.params.sectionId),
          String(req.params.studentId),
          action || 'issue',
          code
        );
        res.json({ student });
      } catch (err) {
        sendError(res, err);
      }
    }
  );

  router.post(
    '/sections/:sectionId/absences',
    requireSchoolSession,
    requireRoles(['admin', 'counselor']),
    (req: SchoolAuthedRequest, res) => {
      try {
        const absence = store.upsertAbsence(req.schoolSession!, String(req.params.sectionId), req.body || {});
        res.json({ absence });
      } catch (err) {
        sendError(res, err);
      }
    }
  );

  router.put(
    '/sections/:sectionId/absences/:absenceId',
    requireSchoolSession,
    requireRoles(['admin', 'counselor']),
    (req: SchoolAuthedRequest, res) => {
      try {
        const absence = store.upsertAbsence(req.schoolSession!, String(req.params.sectionId), {
          ...(req.body || {}),
          id: String(req.params.absenceId),
        });
        res.json({ absence });
      } catch (err) {
        sendError(res, err);
      }
    }
  );

  router.delete(
    '/sections/:sectionId/absences/:absenceId',
    requireSchoolSession,
    requireRoles(['admin', 'counselor']),
    (req: SchoolAuthedRequest, res) => {
      try {
        store.deleteAbsence(req.schoolSession!, String(req.params.sectionId), String(req.params.absenceId));
        res.json({ ok: true });
      } catch (err) {
        sendError(res, err);
      }
    }
  );

  router.post(
    '/sections/:sectionId/subjects',
    requireSchoolSession,
    requireRoles(['admin', 'counselor']),
    (req: SchoolAuthedRequest, res) => {
      try {
        const subject = store.createOrUpdateSubject(req.schoolSession!, String(req.params.sectionId), req.body || {});
        res.json({ subject });
      } catch (err) {
        sendError(res, err);
      }
    }
  );

  router.put(
    '/sections/:sectionId/subjects/:subjectId',
    requireSchoolSession,
    requireRoles(['admin', 'counselor']),
    (req: SchoolAuthedRequest, res) => {
      try {
        const subject = store.createOrUpdateSubject(req.schoolSession!, String(req.params.sectionId), {
          ...(req.body || {}),
          id: String(req.params.subjectId),
        });
        res.json({ subject });
      } catch (err) {
        sendError(res, err);
      }
    }
  );

  router.delete(
    '/sections/:sectionId/subjects/:subjectId',
    requireSchoolSession,
    requireRoles(['admin', 'counselor']),
    (req: SchoolAuthedRequest, res) => {
      try {
        store.deleteSubject(req.schoolSession!, String(req.params.sectionId), String(req.params.subjectId));
        res.json({ ok: true });
      } catch (err) {
        sendError(res, err);
      }
    }
  );

  router.post(
    '/sections/:sectionId/subjects/:subjectId/cells',
    requireSchoolSession,
    requireRoles(['admin', 'counselor']),
    (req: SchoolAuthedRequest, res) => {
      try {
        const { updates } = (req.body || {}) as {
          updates?: Parameters<SchoolRecordStore['updateGradeCells']>[3];
        };
        const subject = store.updateGradeCells(
          req.schoolSession!,
          String(req.params.sectionId),
          String(req.params.subjectId),
          updates || []
        );
        res.json({ subject });
      } catch (err) {
        sendError(res, err);
      }
    }
  );

  router.post(
    '/sections/:sectionId/import-commit',
    requireSchoolSession,
    requireRoles(['admin', 'counselor']),
    (req: SchoolAuthedRequest, res) => {
      try {
        const result = store.commitSmartImport(req.schoolSession!, String(req.params.sectionId), req.body || {});
        res.json(result);
      } catch (err) {
        sendError(res, err);
      }
    }
  );

  router.post(
    '/templates',
    requireSchoolSession,
    requireRoles(['admin', 'counselor']),
    (req: SchoolAuthedRequest, res) => {
      try {
        const template = store.saveImportTemplate(req.schoolSession!, req.body || {});
        res.json({ template });
      } catch (err) {
        sendError(res, err);
      }
    }
  );

  router.delete(
    '/templates/:id',
    requireSchoolSession,
    requireRoles(['admin', 'counselor']),
    (req: SchoolAuthedRequest, res) => {
      try {
        store.deleteImportTemplate(req.schoolSession!, String(req.params.id));
        res.json({ ok: true });
      } catch (err) {
        sendError(res, err);
      }
    }
  );

  // === Smart AI Sheet Vision Extraction ===

  router.post(
    '/import-extract',
    requireSchoolSession,
    requireRoles(['admin', 'counselor']),
    async (req: SchoolAuthedRequest, res) => {
      try {
        if (!options?.getAiClient) {
          throw new SchoolRecordError(500, 'خدمة التحليل البصري غير متوفرة حالياً.');
        }
        const { imageDataUrl, description, boxes } = (req.body || {}) as {
          imageDataUrl?: string;
          description?: string;
          boxes?: ImportBoundingBox[];
        };
        const imgPart = stripDataUrlPrefix(imageDataUrl);
        if (!imgPart) {
          throw new SchoolRecordError(400, 'يرجى رفع صورة واضحة أو اختيار صفحة PDF للتحليل.');
        }

        const boxGuide =
          Array.isArray(boxes) && boxes.length > 0
            ? `\nالمربعات اليدوية المحددة من المعلم (إحداثيات نسبية 0 إلى 1 من أعلى اليسار):\n${boxes
                .map(
                  (b) =>
                    `- ${b.role === 'name' ? 'عمود أسماء الطلبة' : `عمود الدرجة رقم ${b.columnOrder}`} (${b.label || 'بدون عنوان'}): x=${b.x.toFixed(3)}, y=${b.y.toFixed(3)}, w=${b.width.toFixed(3)}, h=${b.height.toFixed(3)}`
                )
                .join('\n')}`
            : '';

        const ai = options.getAiClient();
        const model = options.geminiTextModel || 'gemini-3.1-flash-lite';

        const promptText = `حلّل ورقة كشف الدرجات المصورة واستخرج الجدول بدقة تامة وفق القواعد الإلزامية التالية:
1. الاتجاه عربي من اليمين إلى اليسار (RTL): عمود اسم الطالب يقع في جهة اليمين، وأول عمود درجات يليه مباشرة نحو اليسار هو العمود رقم 1 (columnIndex: 1)، ثم الذي يليه العمود رقم 2، وهكذا.
2. يُمنع منعاً باتاً دمج رقمين متجاورين من عمودين مختلفين في رقم واحد؛ حافظ على حدود كل عمود بدقة.
3. يُمنع التخمين:
   - إذا كانت الخلية فارغة أو بها خط (-) اكتب rawText: "-" ولا تخترع رقماً.
   - إذا كان عنوان العمود غير مكتوب أو غير واضح لا تخترع عنواناً (أعد label: "").
   - إذا كانت الدرجة العظمى (maxScore) غير مكتوبة صراحةً لا تخترعها (أعد maxScore: null).
   - إذا لم تستطع قراءة خانة بخط اليد بوضوح اكتب [غير واضح] في rawText وأضف تنبيهاً في warnings.
4. ادعم خط اليد والأرقام العربية (٠١٢٣٤٥٦٧٨٩) والأرقام الإنجليزية (0123456789) وكلمات مثل (غ، غائب، م، معفى، 0). لاحظ أن الصفر (0 أو ٠) يختلف تماماً عن الخلية الفارغة (-).
${description ? `\nوصف إضافي من المستخدم للورقة:\n${description.slice(0, 600)}` : ''}
${boxGuide}`;

        const response = await ai.models.generateContent({
          model,
          contents: [
            {
              role: 'user',
              parts: [{ inlineData: imgPart }, { text: promptText }],
            },
          ],
          config: {
            systemInstruction:
              'أنت محلل بصري دقيق لكشوف الدرجات المدرسية العربية (RTL). لا تخمّن أي قيمة أو عنوان مفقود وأعد JSON فقط مطابقاً للمخطط.',
            thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                detectedHeaders: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      columnIndex: { type: Type.INTEGER },
                      label: { type: Type.STRING },
                      maxScore: { type: Type.NUMBER, nullable: true },
                    },
                    required: ['columnIndex', 'label'],
                  },
                },
                rows: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      rowIndex: { type: Type.INTEGER },
                      rawNameText: { type: Type.STRING },
                      cells: {
                        type: Type.ARRAY,
                        items: {
                          type: Type.OBJECT,
                          properties: {
                            columnIndex: { type: Type.INTEGER },
                            rawText: { type: Type.STRING },
                          },
                          required: ['columnIndex', 'rawText'],
                        },
                      },
                    },
                    required: ['rowIndex', 'rawNameText', 'cells'],
                  },
                },
                warnings: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
              },
              required: ['detectedHeaders', 'rows', 'warnings'],
            },
          },
        });

        const parsed = JSON.parse((response.text || '{}').trim()) as {
          detectedHeaders?: { columnIndex: number; label: string; maxScore?: number | null }[];
          rows?: { rowIndex: number; rawNameText: string; cells: { columnIndex: number; rawText: string }[] }[];
          warnings?: string[];
        };

        const detectedHeaders = (parsed.detectedHeaders || []).map((h, i) => ({
          columnIndex: typeof h.columnIndex === 'number' ? h.columnIndex : i + 1,
          label: (h.label || '').trim(),
          maxScore: typeof h.maxScore === 'number' && h.maxScore > 0 ? h.maxScore : null,
        }));

        const rows: ImportExtractedRow[] = (parsed.rows || []).map((r, rIdx) => {
          const cells: ImportExtractedCell[] = (r.cells || []).map((c, cIdx) => {
            const rawText = (c.rawText ?? '').trim();
            const parsedVal = parseRawCellValue(rawText);
            return {
              columnIndex: typeof c.columnIndex === 'number' ? c.columnIndex : cIdx + 1,
              rawText: rawText || '-',
              parsedStatus: parsedVal.status,
              parsedScore: parsedVal.score,
            };
          });
          return {
            rowIndex: typeof r.rowIndex === 'number' ? r.rowIndex : rIdx + 1,
            rawNameText: (r.rawNameText || '').trim(),
            cells,
          };
        });

        const result: ImportExtractionResult = {
          detectedHeaders,
          rows,
          warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
        };
        res.json(result);
      } catch (err) {
        sendError(res, err);
      }
    }
  );

  return router;
}
