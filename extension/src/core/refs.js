/**
 * Task-reference extraction.
 *
 * A timesheet line that says "3.5h — Acme" invites an argument. A line that says
 * "3.5h — Acme (PAY-2214, PAY-2231, #812)" ends one. These references are the
 * evidence attached to every block of time.
 */

const PATTERNS = [
  // Jira / Linear / Shortcut style: PAY-2214, ENG-77
  /\b([A-Z][A-Z0-9]{1,9}-\d{1,6})\b/g,
  // ServiceNow style: INC0012345, RITM0004567
  /\b((?:INC|CHG|REQ|RITM|TASK|SCTASK|PRB)\d{4,12})\b/g,
  // Pull requests / issues / tickets: #812
  /(?:^|[\s([])(#\d{1,7})\b/g,
  // Invoices and statements of work: INV-1043, SOW 22
  /\b((?:INV|SOW|PO)[-\s]?\d{2,10})\b/gi,
];

const MAX_REFS = 4;

/**
 * Pull task references out of a title.
 * @param {string} title
 * @returns {string[]} de-duplicated, order preserved, capped.
 */
export function extractRefs(title) {
  const text = String(title || '');
  if (!text) return [];
  const found = [];
  for (const pattern of PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = re.exec(text)) !== null) {
      const ref = match[1].trim().replace(/\s+/, '-').toUpperCase();
      if (!found.includes(ref)) found.push(ref);
      if (found.length >= MAX_REFS * 3) break;
    }
  }
  return found.slice(0, MAX_REFS);
}

/** Merge reference lists from many visits into one capped list. */
export function mergeRefs(lists, cap = 8) {
  const out = [];
  for (const list of lists) {
    for (const ref of list || []) {
      if (!out.includes(ref)) out.push(ref);
      if (out.length >= cap) return out;
    }
  }
  return out;
}
