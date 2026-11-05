#!/usr/bin/env node
'use strict';

const { readFileSync } = require('node:fs');

// ponytail: example regex rules; extend for organization-specific secret/PII formats.
function redact(prompt) {
  const fields = String.raw`(?:password|passwd|pwd|(?:proxy[ _-]?)?authorization|x[ _-]?api[ _-]?key|api[ _-]?key|apikey|secret(?:[ _-]?key)?|client[ _-]?secret|(?:access[ _-]?|refresh[ _-]?|id[ _-]?)?token|aws[ _-]?access[ _-]?key[ _-]?id|aws[ _-]?secret[ _-]?access[ _-]?key|accountkey|sharedaccesskey|sharedaccesssignature|sig|密码|密钥|令牌)`;
  const assignment = new RegExp(
    String.raw`((?:^|[^\p{L}\p{N}_-])["']?${fields}["']?[ \t]*[:=：][ \t]*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s"',;{}<>&，。；、]+)`,
    'gimu',
  );

  return prompt
    // Redact whole PEM blocks, including an unfinished pasted block.
    .replace(/-----BEGIN ([A-Z0-9 ]*PRIVATE KEY)-----[\s\S]*?(?:-----END \1-----|$)/g, '[REDACTED_PRIVATE_KEY]')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(assignment, (_, prefix, value) => {
      // Preserve the scheme so the following rule can redact the entire credential.
      if (/^(?:bearer|basic)$/i.test(value)) return prefix + value;
      const quote = /^["']/.test(value) ? value[0] : '';
      return `${prefix}${quote}[REDACTED]${quote}`;
    })
    .replace(/\b((?:bearer|basic)[ \t]+)[a-z0-9_./+~=-]+/gi, '$1[REDACTED]')
    .replace(/\b((?:api[ _-]?key|secret[ _-]?key|access[ _-]?token|client[ _-]?secret)[ \t]+(?:is[ \t]+)?)[a-z0-9_./+~-]{16,}/gi, '$1[REDACTED]')
    .replace(/((?:密码|密钥|令牌)[ \t]*(?:是|为)[ \t]*)[^\s"',;{}<>&，。；、]+/gu, '$1[REDACTED]')
    .replace(/\b(?:sk-[a-z0-9_-]{16,}|AIza[a-z0-9_-]{30,}|gh[pousr]_[a-z0-9]{20,}|github_pat_[a-z0-9_]{20,}|xox[baprs]-[a-z0-9-]{10,}|(?:AKIA|ASIA)[A-Z0-9]{16}|(?:sk|rk)_(?:live|test)_[a-z0-9]{12,}|npm_[a-z0-9]{20,}|glpat-[a-z0-9_-]{16,})\b/gi, '[REDACTED_TOKEN]')
    .replace(/\beyJ[a-z0-9_-]{5,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\b/gi, '[REDACTED_TOKEN]')
    .replace(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}\b/gi, '[REDACTED_EMAIL]')
    .replace(/(?<![\w+])(?:\+?86[ -]?)?1[3-9]\d{9}(?!\w)/g, '[REDACTED_PHONE]');
}

function main() {
  // No override means the runtime keeps the original model-facing content.
  if (process.env.SKIP_GOVERNANCE_AUDIT === 'true' || process.env.ENABLE_PROMPT_REDACTION === 'false') {
    process.stdout.write('{}\n');
    return;
  }
  if (!['true', undefined].includes(process.env.ENABLE_PROMPT_REDACTION)) {
    throw new Error('invalid configuration');
  }

  const event = JSON.parse(readFileSync(0, 'utf8'));
  if (!event || typeof event.transformedPrompt !== 'string') {
    throw new Error('invalid transformed prompt event');
  }
  const modified = redact(event.transformedPrompt);
  process.stdout.write(JSON.stringify(modified === event.transformedPrompt ? {} : {
    modifiedTransformedPrompt: modified,
  }) + '\n');
}

if (require.main === module) {
  try {
    main();
  } catch {
    // Never print parser errors: their messages may contain the original secret.
    process.stderr.write('Governance: prompt redaction failed; check the event and configuration.\n');
    process.exitCode = 2;
  }
}

module.exports = { redact };
