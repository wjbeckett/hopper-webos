import type { Session } from "../types";
import { requestV2 } from "./silo";

export type SubtitleSearchResult = {
  id: string;
  provider: string;
  language: string;
  release_name: string;
  format: string;
  score: number;
  downloads: number;
  hearing_impaired: boolean;
  upload_date?: string;
};
export type SubtitleSearchResponse = { results: SubtitleSearchResult[]; warnings: string[] };
export type StoredSubtitle = { id: string; media_file_id: string; provider: string; language: string; format: string; release_name: string; score: number; hearing_impaired: boolean; created_at: string };

export function searchSubtitles(session: Session, mediaFileId: number | string, language: string) {
  return requestV2<SubtitleSearchResponse>(session, "/subtitles/search", { method: "POST", body: JSON.stringify({ media_file_id: String(mediaFileId), languages: [language] }) });
}

export function downloadSubtitle(session: Session, mediaFileId: number | string, result: SubtitleSearchResult) {
  return requestV2<{ subtitle: StoredSubtitle }>(session, "/subtitles/download", {
    method: "POST",
    body: JSON.stringify({ media_file_id: String(mediaFileId), provider: result.provider, subtitle_id: result.id, language: result.language, release_name: result.release_name, score: result.score, hearing_impaired: result.hearing_impaired })
  });
}

export type AiStatus = { enabled: boolean; transcribe_enabled: boolean };
export type AiQuota = { limited: boolean; limit: number; used: number; remaining: number; period: string };
export type AiJob = { id: string; status: string; progress: number; progress_message: string; error_message?: string; result_subtitle_id: string | null };
export type AiKind = "translate" | "transcribe" | "transcribe_translate";

export const getAiStatus = (session: Session) => requestV2<AiStatus>(session, "/subtitles/ai/status");
export const getAiQuota = (session: Session) => requestV2<AiQuota>(session, "/subtitles/ai/quota");
export const getAiJob = (session: Session, jobId: string) => requestV2<{ job: AiJob }>(session, `/subtitles/ai/jobs/${encodeURIComponent(jobId)}`);
export const cancelAiJob = (session: Session, jobId: string) => requestV2<void>(session, `/subtitles/ai/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" });
export function startAiTranslate(session: Session, body: { mediaFileId: number | string; kind: AiKind; sourceIndex: number; sourceLanguage: string; targetLanguage: string; startPosition: number }) {
  return requestV2<{ job: AiJob; live_delivery_attached: boolean }>(session, "/subtitles/ai/translate", {
    method: "POST",
    body: JSON.stringify({ media_file_id: String(body.mediaFileId), kind: body.kind, source_index: body.sourceIndex, source_language: body.sourceLanguage, target_language: body.targetLanguage, start_position: body.startPosition })
  });
}

export function apiErrorMessage(reason: unknown, fallback: string) {
  if (!(reason instanceof Error) || !reason.message) return fallback;
  const start = reason.message.indexOf("{");
  if (start >= 0) {
    try {
      const body = JSON.parse(reason.message.slice(start)) as { message?: string; error?: string | { message?: string }; detail?: string };
      const text = body.message ?? (typeof body.error === "string" ? body.error : body.error?.message) ?? body.detail;
      if (text) return text;
    } catch { /* fall through */ }
  }
  return fallback;
}
export const apiErrorStatus = (reason: unknown) => reason instanceof Error ? Number(/: (\d{3}) /.exec(reason.message)?.[1] ?? 0) : 0;
