import { DEMO_TOKEN, STREAMING_BASE, WORLD_SOURCE_LABELS } from "./config.js";

export async function loadConfiguredSources() {
  const sources = [];

  try {
    const raw = (await (await fetch("./sources.json")).json()).sources ?? [];
    for (const src of raw) sources.push(await enrichStreamingSource(src));
  } catch (error) {
    console.warn("No Gracia sources configured. Use Open file... or add sources.json entries.", error);
  }

  return sources;
}

export function sourceForWorld(sources, worldDef) {
  const label = WORLD_SOURCE_LABELS[worldDef?.name];
  return sources.find((source) => source.label === label) ?? null;
}

function withDemoToken(src) {
  if (!src?.url?.startsWith(STREAMING_BASE)) return src;
  return { ...src, token: src.token ?? DEMO_TOKEN };
}

function streamingIdOf(src) {
  if (src.streamingId) return src.streamingId;
  if (src.id) return src.id;
  return src.url?.match(/\/streaming\/content\/([^/]+)/)?.[1] ?? null;
}

async function enrichStreamingSource(src) {
  const source = withDemoToken(src);
  if (!source?.url?.startsWith(STREAMING_BASE)) return source;

  const streamingId = streamingIdOf(source);
  if (!streamingId) return source;

  try {
    const res = await fetch(`${STREAMING_BASE}/${streamingId}`, {
      headers: { "X-VIEW-TOKEN": source.token ?? DEMO_TOKEN }
    });
    const { metadata, audioFileLink } = res.ok ? await res.json() : {};
    return {
      ...source,
      id: source.id ?? streamingId,
      label: source.label ?? metadata?.name ?? streamingId,
      displayName: source.displayName ?? metadata?.name ?? undefined,
      audio: source.audio ?? (audioFileLink && metadata?.withAudio !== false ? audioFileLink : undefined),
      initialTransform: source.initialTransform ?? metadata?.initialSpawn ?? null,
      locked: source.locked ?? false,
      resetPositionOnStart: source.resetPositionOnStart ?? true,
      autoSwitchToNext: source.autoSwitchToNext ?? false
    };
  } catch (error) {
    console.warn(`Failed to load Gracia metadata for ${streamingId}:`, error);
    return source;
  }
}
