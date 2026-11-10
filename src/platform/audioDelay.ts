type Graph = { context: AudioContext; delay: DelayNode };

const graphs = new WeakMap<HTMLVideoElement, Graph>();

export const MAX_AUDIO_DELAY_MS = 1000;

export function audioDelaySupported() {
  return typeof window !== "undefined" && Boolean(window.AudioContext ?? (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext);
}

export function setAudioDelay(video: HTMLVideoElement, delayMs: number) {
  const seconds = Math.min(MAX_AUDIO_DELAY_MS, Math.max(0, delayMs)) / 1000;
  let graph = graphs.get(video);
  if (!graph) {
    if (seconds === 0 || !audioDelaySupported()) return;
    try {
      const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const context = new Context();
      const source = context.createMediaElementSource(video);
      const delay = context.createDelay(MAX_AUDIO_DELAY_MS / 1000);
      source.connect(delay);
      delay.connect(context.destination);
      graph = { context, delay };
      graphs.set(video, graph);
    } catch {
      return;
    }
  }
  graph.delay.delayTime.value = seconds;
  if (graph.context.state === "suspended") void graph.context.resume().catch(() => undefined);
}
