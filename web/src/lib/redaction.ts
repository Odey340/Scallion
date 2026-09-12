/**
 * Client-side redaction of a lab report's text layer before anything leaves the phone
 * (CLAUDE.md rule 2; docs/contracts.md section 7). A port of Lane D's reference applier
 * `api/app/redaction.py`; the rules themselves are D's `api/redaction_rules.json`, copied to
 * `public/redaction_rules.json` by scripts/sync-assets.js and fetched at runtime.
 */

export interface RawRule {
  id: string;
  category: 'name' | 'dob' | 'mrn' | 'address' | 'physician' | 'contact';
  action: 'drop_line' | 'mask';
  pattern: string;
  note?: string;
}

export interface RawRules {
  version: number;
  mask_token?: string;
  keep_if: { pattern: string; note?: string };
  rules: RawRule[];
}

export interface Rule {
  id: string;
  category: RawRule['category'];
  action: RawRule['action'];
  regex: RegExp;
}

export interface RuleSet {
  version: number;
  keepIf: RegExp;
  maskToken: string;
  rules: Rule[];
}

export interface MaskHit {
  ruleId: string;
  matched: string;
  /** [start, end) in the line as it was when the rule ran (masks apply right to left, so earlier offsets stay valid). */
  start: number;
  end: number;
}

export interface LineRedaction {
  /** The line after masking, or null when a drop_line rule removed it. */
  text: string | null;
  droppedBy: string | null;
  masks: MaskHit[];
}

export function loadRules(raw: RawRules): RuleSet {
  return {
    version: raw.version,
    keepIf: new RegExp(raw.keep_if.pattern, 'i'),
    maskToken: raw.mask_token ?? '[REDACTED]',
    rules: raw.rules.map((r) => ({ id: r.id, category: r.category, action: r.action, regex: new RegExp(r.pattern, 'i') })),
  };
}

/** Rules run in order; the first drop_line wins (never on a result row); mask rules replace only the match. */
export function redactLine(line: string, rs: RuleSet): LineRedaction {
  // A line that already carries the mask token was redacted upstream (the consented fixture, a
  // report redacted once before): its label ("Patient:", "DOB:") no longer sits next to a value,
  // so dropping it would only change the bytes and defeat the API's cached response for that file.
  const alreadyRedacted = line.includes(rs.maskToken);
  const isResultRow = rs.keepIf.test(line);
  const masks: MaskHit[] = [];
  let out = line;
  for (const rule of rs.rules) {
    if (rule.action === 'drop_line') {
      if (!isResultRow && !alreadyRedacted && rule.regex.test(out)) return { text: null, droppedBy: rule.id, masks };
    } else {
      const global = new RegExp(rule.regex.source, 'gi');
      const found = [...out.matchAll(global)].filter((m) => m[0].length > 0);
      for (const m of found.reverse()) {
        const start = m.index ?? 0;
        masks.push({ ruleId: rule.id, matched: m[0], start, end: start + m[0].length });
        out = out.slice(0, start) + rs.maskToken + out.slice(start + m[0].length);
      }
    }
  }
  return { text: out, droppedBy: null, masks };
}

export interface TextRedaction {
  text: string;
  dropped: { line: number; ruleId: string; text: string }[];
  masked: { line: number; ruleId: string; matched: string }[];
}

export function redactText(text: string, rs: RuleSet): TextRedaction {
  const kept: string[] = [];
  const result: TextRedaction = { text: '', dropped: [], masked: [] };
  text.split('\n').forEach((line, i) => {
    const r = redactLine(line, rs);
    if (r.text === null) {
      result.dropped.push({ line: i, ruleId: r.droppedBy!, text: line });
      return;
    }
    for (const m of r.masks) result.masked.push({ line: i, ruleId: m.ruleId, matched: m.matched });
    kept.push(r.text);
  });
  result.text = kept.join('\n');
  return result;
}

export function redactionHits(r: TextRedaction): number {
  return r.dropped.length + r.masked.length;
}
