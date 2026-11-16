/**
 * The short notice a phone's remote control shows on the TV ("<phone> connected", #155): four
 * seconds at the top of the screen, over any screen including the player, as on Roku. Plain DOM,
 * outside React, so no screen has to render it. Not focusable.
 */
const SHOW_MS = 4000;
let timer: number | null = null;

export function showRemoteNotice(text: string) {
  let notice = document.querySelector<HTMLElement>(".remote-notice");
  if (!notice) {
    notice = document.createElement("div");
    notice.className = "remote-notice";
    notice.setAttribute("role", "status");
    document.body.appendChild(notice);
  }
  notice.textContent = text;
  notice.classList.add("visible");
  if (timer != null) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    timer = null;
    document.querySelector(".remote-notice")?.classList.remove("visible");
  }, SHOW_MS);
}
