import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import type {
  EngineId,
  LatencyStats,
  LoggedEvent,
  MarkEntry,
  SessionReport,
} from "@/lib/telemetry";
import {
  filterTranscript,
  transcriptToSrt,
  transcriptToVtt,
  type TranscriptEntry,
} from "@/lib/transcript-utils";

export const dynamic = "force-dynamic";

// Session reports are written to <project root>/benchmarks (git-ignored).
// They can include audio recordings of the speaker, so keep them local.
const BENCHMARK_DIR = path.join(process.cwd(), "benchmarks");

// Only accept simple field names and extensions so a crafted multipart body
// cannot write outside BENCHMARK_DIR.
const AUDIO_FIELD_RE = /^audio-[a-z0-9-]{1,40}$/;
const EXTENSION_RE = /^[a-z0-9]{1,5}$/;

type SavedFile = { name: string; bytes: number };

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("multipart/form-data")) {
      return await handleMultipart(request);
    }
    return await handleJson(request);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Failed to save benchmark: ${message}` },
      { status: 500 },
    );
  }
}

async function handleJson(request: Request): Promise<NextResponse> {
  let report: SessionReport;
  try {
    report = (await request.json()) as SessionReport;
  } catch {
    return NextResponse.json(
      { error: "Body must be a valid SessionReport JSON." },
      { status: 400 },
    );
  }
  if (!report || typeof report !== "object" || !report.generatedAtIso) {
    return NextResponse.json(
      { error: "Body does not look like a SessionReport." },
      { status: 400 },
    );
  }
  const { folder, saved } = await writeArtifacts(report, []);
  return NextResponse.json({
    saved: true,
    folder,
    markdown: `${folder}/report.md`,
    files: saved,
  });
}

async function handleMultipart(request: Request): Promise<NextResponse> {
  const form = await request.formData();
  const reportRaw = form.get("report");
  if (typeof reportRaw !== "string") {
    return NextResponse.json(
      { error: "Missing 'report' field in multipart body." },
      { status: 400 },
    );
  }
  let report: SessionReport;
  try {
    report = JSON.parse(reportRaw) as SessionReport;
  } catch {
    return NextResponse.json(
      { error: "'report' field is not valid JSON." },
      { status: 400 },
    );
  }
  if (!report || typeof report !== "object" || !report.generatedAtIso) {
    return NextResponse.json(
      { error: "Body does not look like a SessionReport." },
      { status: 400 },
    );
  }

  const rawExtension = form.get("extension");
  const extension =
    typeof rawExtension === "string" && EXTENSION_RE.test(rawExtension)
      ? rawExtension
      : "webm";

  const audioFiles: { name: string; blob: Blob }[] = [];
  for (const [key, value] of form.entries()) {
    if (!AUDIO_FIELD_RE.test(key)) continue;
    if (!(value instanceof Blob)) continue;
    audioFiles.push({ name: `${key}.${extension}`, blob: value });
  }

  const { folder, saved } = await writeArtifacts(report, audioFiles);
  return NextResponse.json({
    saved: true,
    folder,
    markdown: `${folder}/report.md`,
    files: saved,
  });
}

async function writeArtifacts(
  report: SessionReport,
  audioFiles: { name: string; blob: Blob }[],
): Promise<{ folder: string; saved: SavedFile[] }> {
  const stamp = fileStamp(report.startedAtIso ?? report.generatedAtIso);
  const slug = slugify(report.meta?.eventId || "session");
  const folderName = `${stamp}_${slug}`;
  const folderAbs = path.join(BENCHMARK_DIR, folderName);
  await mkdir(folderAbs, { recursive: true });

  const saved: SavedFile[] = [];

  async function write(name: string, contents: string | Uint8Array) {
    const filePath = path.join(folderAbs, name);
    const bytes =
      typeof contents === "string"
        ? Buffer.byteLength(contents, "utf8")
        : contents.byteLength;
    await writeFile(filePath, contents, typeof contents === "string" ? "utf8" : undefined);
    saved.push({ name, bytes });
  }

  // Core report.
  await write("report.json", JSON.stringify(report, null, 2));
  await write("report.md", renderMarkdown(report));

  // Transcript artifacts.
  const transcript = (report.transcript ?? []) as TranscriptEntry[];
  if (transcript.length > 0) {
    await write("transcript.json", JSON.stringify(transcript, null, 2));
    // Source transcript: union of both engines, filtered to channel=source.
    const sourceEntries = transcript.filter((e) => e.channel === "source");
    if (sourceEntries.length > 0) {
      await write("transcript-source.srt", transcriptToSrt(sourceEntries));
      await write("transcript-source.vtt", transcriptToVtt(sourceEntries));
    }
    for (const engine of ["openai", "gemini"] as EngineId[]) {
      const entries = filterTranscript(transcript, engine, "translated");
      if (entries.length > 0) {
        await write(`transcript-${engine}.srt`, transcriptToSrt(entries));
        await write(`transcript-${engine}.vtt`, transcriptToVtt(entries));
      }
    }
  }

  // Marks (if any).
  const marks = (report.marks ?? []) as MarkEntry[];
  if (marks.length > 0) {
    await write("marks.json", JSON.stringify(marks, null, 2));
  }

  // Audio files.
  for (const { name, blob } of audioFiles) {
    const arrayBuffer = await blob.arrayBuffer();
    await write(name, new Uint8Array(arrayBuffer));
  }

  return { folder: `benchmarks/${folderName}`, saved };
}

function fileStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown-time";
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "session"
  );
}

function fmtMs(ms: number | null): string {
  if (ms === null) return "none";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function fmtDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function latencyRow(label: string, l: LatencyStats): string {
  return `| ${label} | ${l.count} | ${fmtMs(l.lastMs)} | ${fmtMs(l.p50Ms)} | ${fmtMs(l.p95Ms)} | ${fmtMs(l.maxMs)} |`;
}

function renderMarkdown(r: SessionReport): string {
  const engines = (r.meta?.engines ?? []) as EngineId[];
  const lines: string[] = [];
  lines.push(`# Session Benchmark, ${r.startedAtIso ?? r.generatedAtIso}`);
  lines.push("");
  lines.push(
    `- **Event:** ${r.meta?.eventId || "none"} → ${r.meta?.targetLanguage || "none"}`,
  );
  lines.push(`- **Engines:** ${engines.length ? engines.join(", ") : "none"}`);
  lines.push(`- **captureSource:** ${r.meta?.captureSource ? "on" : "off"}`);
  lines.push(`- **Duration:** ${fmtDuration(r.durationMs)}`);
  lines.push(`- **Started:** ${r.startedAtIso ?? "none"}`);
  lines.push(`- **Ended:** ${r.endedAtIso ?? "none"}`);
  lines.push(
    `- **Marks placed:** ${(r.marks?.length ?? 0)} · **Transcript deltas:** ${(r.transcript?.length ?? 0)}`,
  );
  lines.push("");
  lines.push("## Outcomes");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|---|---|");
  lines.push(`| Disconnects | ${r.disconnects} |`);
  lines.push(`| Errors | ${r.errors} |`);
  lines.push(`| Peak listeners | ${r.peakListeners} |`);
  lines.push(`| Estimated cost | $${r.estCostUsd.toFixed(4)} USD |`);
  lines.push("");
  lines.push("## Latency");
  lines.push("");
  lines.push("| Engine | Samples | Last | p50 | p95 | Max |");
  lines.push("|---|---|---|---|---|---|");
  lines.push(latencyRow("OpenAI", r.latency.openai));
  lines.push(latencyRow("Gemini", r.latency.gemini));
  lines.push("");
  lines.push(
    "> Latency here is **first-token** latency per session (the transcript-cadence proxy). " +
      "Mouth-to-ear latency is not captured automatically yet. " +
      "If marks were placed during the run, they're in `marks.json` and can be paired manually " +
      "(speaker phrase start vs. listener-heard moment) for ground-truth samples.",
  );
  lines.push("");
  lines.push("## Connection final states");
  lines.push("");
  lines.push(`- openai: ${r.conn.openai}`);
  lines.push(`- gemini: ${r.conn.gemini}`);
  lines.push(`- livekit: ${r.conn.livekit}`);
  lines.push("");
  if (r.marks && r.marks.length > 0) {
    lines.push("## Marks");
    lines.push("");
    lines.push("| t | note |");
    lines.push("|---|---|");
    for (const m of r.marks) {
      const t = `${Math.round(m.atMs / 1000)}s`;
      const note = (m.note ?? "").replace(/\|/g, "\\|");
      lines.push(`| ${t} | ${note} |`);
    }
    lines.push("");
  }
  lines.push("## Event log");
  lines.push("");
  lines.push("| t | kind | detail |");
  lines.push("|---|---|---|");
  for (const e of r.events as LoggedEvent[]) {
    const t = `${Math.round(e.atMs / 1000)}s`;
    const detail = e.detail.replace(/\|/g, "\\|");
    lines.push(`| ${t} | ${e.kind} | ${detail} |`);
  }
  lines.push("");
  return lines.join("\n");
}
