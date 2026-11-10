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

export type SubtitleTiming = { offset_ms: number; scale: number };
export type SubtitleSyncJob = { id?: string; status: string; trigger?: string; phase?: string; progress?: number | null; failure?: string; confidence?: number | null; result?: SubtitleTiming; created_at?: string; finished_at?: string | null };
export type SubtitleSyncState = { key: string; media_file_id?: string; source: string; stored_subtitle_id?: string; language?: string; format?: string; label?: string; timing: SubtitleTiming; sync?: SubtitleSyncJob | null };
export type SubtitleSyncCapability = { state: string; auto_sync: boolean; external: boolean; allowed: boolean };

const syncPath = (fileId: number | string, key: string) => `/subtitles/${encodeURIComponent(String(fileId))}/sync/${encodeURIComponent(key)}`;
export const getSyncCapability = (session: Session) => requestV2<SubtitleSyncCapability>(session, "/subtitles/sync/status");
export const readSubtitleSync = (session: Session, fileId: number | string, key: string) => requestV2<{ subtitle: SubtitleSyncState }>(session, syncPath(fileId, key)).then(response => response.subtitle);
export const startSubtitleSync = (session: Session, fileId: number | string, key: string) => requestV2<{ subtitle: SubtitleSyncState }>(session, syncPath(fileId, key), { method: "POST" }).then(response => response.subtitle);

export async function resetSubtitleTiming(session: Session, fileId: number | string, key: string) {
  const root = session.serverUrl.replace(/\/+$/, "");
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${session.accessToken}`,
    ...(session.profileId ? { "X-Profile-Id": session.profileId } : {}),
    ...(session.profileToken ? { "X-Profile-Token": session.profileToken } : {})
  };
  const fail = async (response: Response) => new Error(`${syncPath(fileId, key)}: ${response.status} ${response.statusText}: ${await response.text().catch(() => "")}`);
  const read = await fetch(`${root}/api/v2${syncPath(fileId, key)}`, { headers });
  if (!read.ok) throw await fail(read);
  const validator = read.headers.get("ETag");
  const write = await fetch(`${root}/api/v2${syncPath(fileId, key)}/timing`, { method: "PUT", headers: { ...headers, ...(validator ? { "If-Match": validator } : {}) }, body: JSON.stringify({ offset_ms: 0, scale: 1 }) });
  if (!write.ok) throw await fail(write);
  return (await write.json() as { subtitle: SubtitleSyncState }).subtitle;
}
