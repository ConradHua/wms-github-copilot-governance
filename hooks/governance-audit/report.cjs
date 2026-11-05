#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const readline = require('node:readline');
const path = require('node:path');

async function main() {
  const file = path.resolve('logs/copilot/governance/audit.log');
  if (!fs.existsSync(file)) {
    console.log('尚无审计日志。请先在目标项目运行一次 Copilot 会话。');
    return;
  }
  const sessions = new Map();
  let skipped = 0;
  for await (const line of readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity })) {
    let event;
    try { event = JSON.parse(line); } catch { skipped++; continue; }
    if (event.schema_version !== 2 || !event.session_id) { skipped++; continue; }
    if (process.argv[2] && event.session_id !== process.argv[2]) continue;
    const session = sessions.get(event.session_id) ?? { prompts: 0, risks: new Set(), denied: 0, confirmed: 0, succeeded: 0, failed: 0, errors: 0, pending: null, recent: [] };
    if (event.event === 'prompt_scanned') {
      session.prompts++;
      if (event.threats.length) session.risks.add(event.request_id);
      if (event.threats.length || event.control_rejected) session.recent.push(
        `${event.timestamp} 请求 ${event.request_id}: ${event.action}\n  ${event.prompt.text}\n  ${event.threats.map(t => `${t.rule_id}: ${t.description} (${t.evidence})`).join('；')}`);
    }
    if (event.event === 'prompt_transformed' && event.threats.length) session.risks.add(event.request_id);
    if (event.event === 'hook_error') session.errors++;
    if (event.event === 'confirmation_received') session.confirmed++;
    if (event.event === 'tool_decision' && event.action === 'deny') session.denied++;
    if (event.event === 'tool_result') session[event.result === 'reported_success' ? 'succeeded' : 'failed']++;
    if (event.pending_request_id !== undefined) session.pending = event.pending_request_id;
    if (['confirmation_received', 'request_cancelled'].includes(event.event)) session.pending = null;
    session.recent = session.recent.slice(-5);
    sessions.set(event.session_id, session);
  }
  for (const [id, session] of [...sessions].slice(-10)) {
    console.log(`会话 ${id}\n请求 ${session.prompts}；风险请求 ${session.risks.size}；确认 ${session.confirmed}；工具拦截 ${session.denied}；工具报告成功/失败 ${session.succeeded}/${session.failed}；hook 错误 ${session.errors}；待确认 ${session.pending ?? '无'}`);
    for (const detail of session.recent) console.log(detail);
  }
  if (skipped) console.log(`跳过 ${skipped} 条旧格式或无法解析的记录；原日志未修改。`);
  if (!sessions.size) console.log('未找到符合条件的新版审计记录。');
}

main().catch(() => { console.error('读取审计日志失败，请检查日志路径和权限。'); process.exitCode = 1; });
