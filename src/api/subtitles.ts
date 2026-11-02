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
