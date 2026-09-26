/**
 * Timesheet assembly: visits in, invoice-ready lines out.
 */

import { compileRules, attribute, collectUnassigned } from './attribution.js';
import { mergeBlocks, normalizeVisits } from './segments.js';
import { dayKeysBetween, tzOffsetMinutes } from './time.js';

/** @typedef {{ incrementMinutes?: number, direction?: 'nearest'|'up'|'down', billMinimumIncrement?: boolean }} RoundingRule */

export const ROUNDING_INCREMENTS = [
  { value: 0, label: 'Exact (no rounding)' },
  { value: 6, label: '6 minutes (0.1 h)' },
  { value: 10, label: '10 minutes' },
  { value: 15, label: '15 minutes (0.25 h)' },
  { value: 30, label: '30 minutes' },
  { value: 60, label: '1 hour' },
];

/**
 * Apply a billing increment to a duration.
 *
 * `billMinimumIncrement` reflects how real invoices work: if you did four
 * minutes of billable work on a 15-minute increment, the line is 15 minutes,
 * not zero. It never applies to `down`, where rounding to zero is the point.
 *
 * @param {number} seconds
 * @param {RoundingRule} [rule]
 */
export function roundSeconds(seconds, rule = {}) {
  const { incrementMinutes = 0, direction = 'nearest', billMinimumIncrement = true } = rule;
  const value = Math.max(0, Number(seconds) || 0);
  const increment = Math.max(0, Number(incrementMinutes) || 0) * 60;
  if (!increment) return value;

  let rounded;
  if (direction === 'up') rounded = Math.ceil(value / increment) * increment;
  else if (direction === 'down') rounded = Math.floor(value / increment) * increment;
  else rounded = Math.round(value / increment) * increment;

  if (billMinimumIncrement && direction !== 'down' && value > 0 && rounded === 0) {
    rounded = increment;
  }
  return rounded;
}

export function secondsToHours(seconds) {
  return (Number(seconds) || 0) / 3600;
}

/** Money for a duration, rounded to cents. */
export function amountFor(seconds, rate) {
  const value = secondsToHours(seconds) * (Number(rate) || 0);
  return Math.round(value * 100) / 100;
}

/**
 * Build a full timesheet for a range.
 *
 * @param {{
 *   visits: Array,
 *   rules: Array,
 *   clients: Array,
 *   settings: Object,
 *   range: { from: number, to: number },
 *   offsetMin?: number
 * }} input
 */
export function buildTimesheet(input) {
  const { visits = [], rules = [], clients = [], settings = {}, range } = input;
  const offsetMin = input.offsetMin ?? tzOffsetMinutes(range?.from ?? Date.now());
  const rounding = settings.rounding || {};
  const compiled = compileRules(rules);
  const clientById = new Map(clients.map((client) => [client.id, client]));

  const normalized = normalizeVisits(visits, {
    minSegmentSeconds: settings.minSegmentSeconds ?? 30,
    mergeGapSeconds: settings.mergeGapSeconds ?? 300,
    offsetMin,
    range,
  });

  const attributed = [];
  const unassignedVisits = [];
  for (const visit of normalized) {
    // A manual entry carries its client directly — it was typed in by the user,
    // so there is nothing for a rule to decide.
    if (visit.clientId && clientById.has(visit.clientId)) {
      attributed.push({
        ...visit,
        clientId: visit.clientId,
        projectId: visit.projectId || null,
        billable: visit.billable !== false,
        ruleId: null,
      });
      continue;
    }

    const match = attribute(visit, compiled);
    if (match && clientById.has(match.clientId)) {
      attributed.push({ ...visit, ...match });
    } else {
      unassignedVisits.push(visit);
    }
  }

  const merged = mergeBlocks(attributed, {
    mergeGapSeconds: settings.mergeGapSeconds ?? 300,
  });

  const lines = merged.map((block) => {
    const client = clientById.get(block.clientId);
    const roundedSeconds = block.billable ? roundSeconds(block.seconds, rounding) : block.seconds;
    return {
      ...block,
      clientName: client?.name || 'Unknown client',
      clientColor: client?.color || null,
      projectName: findProjectName(client, block.projectId),
      rate: block.billable ? Number(client?.rate) || 0 : 0,
      roundedSeconds,
      amount: block.billable ? amountFor(roundedSeconds, client?.rate) : 0,
      description: describeLine(block),
    };
  });

  const dayKeys = dayKeysBetween(range.from, range.to, offsetMin);
  const days = dayKeys.map((key) => {
    const dayLines = lines.filter((line) => line.dayKey === key);
    return {
      dayKey: key,
      lines: dayLines.sort((a, b) => b.seconds - a.seconds),
      seconds: sum(dayLines, 'seconds'),
      billableSeconds: sum(dayLines.filter((l) => l.billable), 'seconds'),
      roundedSeconds: sum(dayLines.filter((l) => l.billable), 'roundedSeconds'),
      amount: round2(sum(dayLines, 'amount')),
    };
  });

  const byClient = [...new Set(lines.map((line) => line.clientId))].map((clientId) => {
    const clientLines = lines.filter((line) => line.clientId === clientId);
    const billableLines = clientLines.filter((line) => line.billable);
    const client = clientById.get(clientId);
    const perDay = {};
    for (const line of clientLines) {
      perDay[line.dayKey] = (perDay[line.dayKey] || 0) + line.seconds;
    }
    return {
      clientId,
      name: client?.name || 'Unknown client',
      color: client?.color || null,
      rate: Number(client?.rate) || 0,
      seconds: sum(clientLines, 'seconds'),
      billableSeconds: sum(billableLines, 'seconds'),
      roundedSeconds: sum(billableLines, 'roundedSeconds'),
      amount: round2(sum(clientLines, 'amount')),
      lineCount: clientLines.length,
      days: perDay,
      refs: [...new Set(clientLines.flatMap((line) => line.refs || []))].slice(0, 12),
    };
  }).sort((a, b) => b.seconds - a.seconds);

  const unassigned = collectUnassigned(unassignedVisits);
  const billableLines = lines.filter((line) => line.billable);

  return {
    range,
    offsetMin,
    days,
    lines,
    byClient,
    unassigned,
    totals: {
      trackedSeconds: sum(normalized, 'seconds'),
      assignedSeconds: sum(lines, 'seconds'),
      billableSeconds: sum(billableLines, 'seconds'),
      nonBillableSeconds: sum(lines.filter((line) => !line.billable), 'seconds'),
      roundedBillableSeconds: sum(billableLines, 'roundedSeconds'),
      unassignedSeconds: sum(unassigned, 'seconds'),
      amount: round2(sum(lines, 'amount')),
      clientCount: byClient.length,
    },
  };
}

function findProjectName(client, projectId) {
  if (!projectId || !client?.projects) return null;
  return client.projects.find((project) => project.id === projectId)?.name || null;
}

/**
 * A human line description.
 *
 * Task references are the evidence a client can check, so they lead — but only in
 * exports. On screen they are also shown as separate chips, and repeating them
 * here just pushed the useful text off the end of the row.
 */
function describeLine(block) {
  const refs = (block.refs || []).slice(0, 4);
  const titles = (block.titles || []).filter(Boolean).slice(0, 3);
  if (refs.length && titles.length) return `${refs.join(', ')} — ${titles.join('; ')}`;
  if (refs.length) return refs.join(', ');
  if (titles.length) return titles.join('; ');
  return (block.hostnames || []).join(', ') || 'Added by hand';
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}
