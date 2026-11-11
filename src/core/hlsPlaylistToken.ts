/**
 * Silo signs every segment URL in a stream's playlist with the same token, and the token is
 * about 900 characters. A two-hour film's playlist is 1.3 MB, nearly all of it that one
 * token repeated. hls.js parses playlists on the main thread, and on a webOS 22 TV that
 * parse took 0.7 to 1.8 s, right while the stream was starting.
 *
 * So the token is taken out of the playlist text before hls.js sees it, and put back on
 * each segment request.
 */

const TOKEN = /\?st=([A-Za-z0-9._~-]+)/;

/** Removes the repeated `?st=<token>` from a playlist. Returns the text unchanged when there is no repeat. */
export function stripPlaylistToken(text: string): { text: string; token: string | null } {
  const token = TOKEN.exec(text)?.[1];
  if (!token) return { text, token: null };
  const parts = text.split(`?st=${token}`);
  // One occurrence is not worth it, and anything left over means the URLs are not uniform.
  if (parts.length < 3) return { text, token: null };
  return { text: parts.join(""), token };
}

/** Puts the token back on a segment URL that the playlist no longer carries it for. */
export function withPlaylistToken(url: string, token: string | null): string {
  if (!token || /[?&]st=/.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}st=${token}`;
}
