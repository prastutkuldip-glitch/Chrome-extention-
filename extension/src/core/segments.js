/**
 * Segment maths.
 *
 * One rule governs this whole file: **Billed never invents time.** Merging
 * adjacent blocks is a presentation concern, so a merged block's duration is the
 * sum of its parts — never the wall-clock span between the first start and the
 * last end. Bridging the gap would quietly inflate an invoice, and a billing
 * tool that rounds in your favour by accident is worse than no tool.
 */

import { DAY_MS, dayKey, dayStart, tzOffsetMinutes } from './time.js';
import { extractRefs, mergeRefs } from './refs.js';

/** Clip a segment to `[from, to)`, or return null if it falls outside. */
export function clampToRange(segment, from, to) {
  const start = Math.max(segment.start, from);
  const end = Math.min(segment.end, to);
  if (end <= start) return null;
  return { ...segment, start, end };
}

/**
 * Split a segment that crosses local midnight, so a session from 23:40 to 00:20
 * bills 20 minutes to each day instead of 40 to one.
 */
export function splitAtMidnight(segment, offsetMin = tzOffsetMinutes(segment.start)) {
  const out = [];
  let cursor = segment.start;
  while (cursor < segment.end) {
    const boundary = dayStart(dayKey(cursor, offsetMin), offsetMin) + DAY_MS;
    const end = Math.min(segment.end, boundary);
    out.push({ ...segment, start: cursor, end, dayKey: dayKey(cursor, offsetMin) });
    cursor = end;
  }
  return out;
}

/**
 * Turn stored visits into clean, day-bounded segments.
 *
 * @param {Array<{start:number,end:number}>} visits
 * @param {{ minSegmentSeconds?: number, offsetMin?: number, range?: {from:number,to:number} }} [opts]
 */
export function normalizeVisits(visits = [], opts = {}) {
  const { minSegmentSeconds = 30, offsetMin = tzOffsetMinutes(), range = null } = opts;
  const out = [];

  for (const visit of visits) {
    if (!visit || typeof visit.start !== 'number' || typeof visit.end !== 'number') continue;
    if (visit.end <= visit.start) continue;

    // The minimum-duration filter runs on the real visit, before any splitting,
    // so a 45-second session that happens to straddle midnight is still judged
    // as 45 seconds rather than two sub-threshold slivers.
    if ((visit.end - visit.start) / 1000 < minSegmentSeconds) continue;

    const clipped = range ? clampToRange(visit, range.from, range.to) : visit;
    if (!clipped) continue;

    for (const piece of splitAtMidnight(clipped, offsetMin)) {
      out.push({
        ...piece,
        refs: piece.refs ?? extractRefs(piece.title),
        seconds: (piece.end - piece.start) / 1000,
      });
    }
  }

  return out.sort((a, b) => a.start - b.start);
}

/**
 * Collapse consecutive blocks of the same client, project and day into single
 * timesheet lines. Short trips to another tab no longer produce eleven lines
 * that say the same thing.
 *
 * @param {Array} blocks attributed segments
 * @param {{ mergeGapSeconds?: number }} [opts]
 */
export function mergeBlocks(blocks = [], opts = {}) {
  const { mergeGapSeconds = 300 } = opts;
  const buckets = new Map();

  for (const block of blocks) {
    const key = `${block.dayKey}|${block.clientId}|${block.projectId || ''}|${block.billable ? 1 : 0}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(block);
  }

  const merged = [];
  for (const bucket of buckets.values()) {
    bucket.sort((a, b) => a.start - b.start);
    let current = null;

    for (const block of bucket) {
      if (current && (block.start - current.end) / 1000 <= mergeGapSeconds) {
        // Sum the parts. Deliberately not `block.end - current.start`.
        current.seconds += block.seconds;
        current.end = Math.max(current.end, block.end);
        current.parts.push(block);
      } else {
        if (current) merged.push(finalizeBlock(current));
        current = {
          dayKey: block.dayKey,
          clientId: block.clientId,
          projectId: block.projectId || null,
          billable: block.billable !== false,
          start: block.start,
          end: block.end,
          seconds: block.seconds,
          parts: [block],
        };
      }
    }
    if (current) merged.push(finalizeBlock(current));
  }

  return merged.sort((a, b) => a.start - b.start);
}

function finalizeBlock(block) {
  const titles = [];
  const hostnames = [];
  for (const part of block.parts) {
    if (part.title && !titles.includes(part.title)) titles.push(part.title);
    if (part.hostname && !hostnames.includes(part.hostname)) hostnames.push(part.hostname);
  }
  return {
    dayKey: block.dayKey,
    clientId: block.clientId,
    projectId: block.projectId,
    billable: block.billable,
    start: block.start,
    end: block.end,
    seconds: block.seconds,
    refs: mergeRefs(block.parts.map((part) => part.refs), 8),
    titles: titles.slice(0, 6),
    hostnames: hostnames.slice(0, 4),
    visitCount: block.parts.length,
    /** True only when every part was typed in by hand, so the label is accurate. */
    manual: block.parts.every((part) => part.manual === true),
    /** Record ids, so a single line can be deleted precisely. */
    visitIds: block.parts.map((part) => part.id).filter(Boolean),
  };
}
