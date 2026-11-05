# 安全检查清单

Web 应用安全速查资料。请与 `security-and-hardening` 技能配合使用。

## 目录

- [威胁 Modeling (Start Here)](#威胁建模从这里开始)
- [Pre-Commit Checks](#提交前检查)
- [Authentication](#身份认证)
- [Authorization](#授权)
- [Input Validation](#输入验证)
- [Security Headers](#安全响应头)
- [CORS Configuration](#cors-配置)
- [Data Protection](#数据保护)
- [Dependency Security](#依赖安全)
- [AI / LLM Security](#ai--llm-安全)
- [Error 处理方式](#错误处理)
- [OWASP Top 10 Quick Reference](#owasp-top-10-快速参考)
- [OWASP Top 10 for LLMs Quick Reference](#owasp-llm-十大风险快速参考)

## 威胁建模（从这里开始）

Before reaching for controls, spend five minutes thinking like an attacker:

- [ ] Trust boundaries mapped (requests, uploads, webhooks, third-party APIs, LLM output, and local values written by processes you don't control)
- [ ] Assets named (credentials, PII, payment data, admin actions, money movement)
- [ ] STRIDE run per boundary (Spoofing, Tampering, Repudiation, Info disclosure, DoS, Elevation)
- [ ] Abuse cases written next to use cases ("how would I misuse this?")

## 提交前检查

- [ ] No secrets in code (`git diff --cached -i -G'password|secret|api_key|token' --name-only` — lists only the names of files whose staged diff matches, never the value itself; any output means review those files before committing)
- [ ] `.gitignore` covers: `.env`, `.env.local`, `*.pem`, `*.key`
- [ ] `.env.example` uses placeholder values (not real secrets)

## 身份认证

- [ ] Passwords hashed with bcrypt (≥12 rounds), scrypt, or argon2
- [ ] Session cookies: `httpOnly`, `secure`, `sameSite: 'lax'`
- [ ] Session expiration configured (reasonable max-age)
- [ ] Rate limiting on login endpoint (≤10 attempts per 15 minutes)
- [ ] Password reset tokens: time-limited (≤1 hour), single-use
- [ ] Account lockout after repeated failures (optional, with notification)
- [ ] MFA supported for sensitive operations (optional but recommended)

## 授权

- [ ] Every protected endpoint checks authentication
- [ ] Every resource access checks ownership/role (prevents IDOR)
- [ ] Admin endpoints require admin role verification
- [ ] API keys scoped to minimum necessary permissions
- [ ] JWT tokens validated (signature, expiration, issuer)

## 输入验证

- [ ] All user input validated at system boundaries (API routes, form handlers)
- [ ] Validation uses allowlists (not denylists)
- [ ] String lengths constrained (min/max)
- [ ] Numeric ranges validated
- [ ] Email, URL, and date formats validated with proper libraries
- [ ] File uploads: type restricted, size limited, content verified
- [ ] SQL queries parameterized (no string concatenation)
- [ ] HTML output encoded (use framework auto-escaping)
- [ ] URLs validated before redirect (prevent open redirect)
- [ ] Server-side URL fetches allowlisted; private/reserved IPs blocked (prevent SSRF)
- [ ] Destructive path operations (delete/move/overwrite): symlinks resolved, allowlisted root, minimum depth, ownership evidence read before the call

### Destructive Path Operations

Containment for a target named by data. 先解析再判断 — and treat the
result as a candidate, not as authorization:

```typescript
import { realpath, readFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute, join, sep } from 'node:path';

const ALLOWED_ROOTS = ['/var/lib/myapp/sessions']; // an allowlist, not a pattern
const MIN_DEPTH = 1;                               // so a root is never the target

async function resolveDeletable(candidate: string, expectedOwner: string) {
  const target = await realpath(resolve(candidate)); // symlinks resolved BEFORE the check
  const inRoot = ALLOWED_ROOTS.some((root) => {
    const rel = relative(root, target);
    // `rel === '..'` / `'../'` only — a plain `startsWith('..')` would also
    // reject a legitimate child named `..cache`.
    if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return false;
    return rel.split(sep).length >= MIN_DEPTH;
  });
  if (!inRoot) throw new Error(`refusing: outside allowed roots (${target})`);

  const owner = await readFile(join(target, '.owner'), 'utf8').catch(() => null);
  if (owner?.trim() !== expectedOwner) throw new Error(`refusing: unproven owner (${target})`);
  return target;
}
```

此代码未解决以下问题；复制该片段时必须一并说明：

- **标记是自我声明。** Anything that can write inside the root can write
  `.owner`. `expectedOwner` has to come from authenticated state, and the marker needs
  integrity protection (restrictive ownership, or a MAC) before it is authorization
  rather than a consistency check against a misderived target.
- **返回路径仍存在检查/使用竞态。** Where an untrusted process can swap an
  ancestor between the check and the call, operate on a descriptor with no-follow,
  beneath-the-root semantics, or guarantee the hierarchy is immutable for the duration.

## 安全响应头

```
Content-Security-Policy: default-src 'self'; script-src 'self'
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 0  (disabled, rely on CSP)
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

## CORS 配置

```typescript
// 限制性配置（推荐）
cors({
  origin: ['https://yourdomain.com', 'https://app.yourdomain.com'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
})

// 生产环境中绝不要使用：
cors({ origin: '*' })  // Allows any origin
```

## 数据保护

- [ ] Sensitive fields excluded from API responses (`passwordHash`, `resetToken`, etc.)
- [ ] Sensitive data not logged (passwords, tokens, full CC numbers)
- [ ] PII encrypted at rest (if required by regulation)
- [ ] HTTPS for all external communication
- [ ] Database backups encrypted
- [ ] Personal data is classified, collected against a stated purpose, and minimized
- [ ] Personal data has a retention limit and a working deletion path (incl. backups, caches, indexes)
- [ ] Export/delete (data-subject) requests are supported where required; third-party sharing has consent and a data-processing agreement

## 依赖安全

First locate the **installation boundary**. If the package is matched by a parent `workspaces` declaration, use that workspace root; otherwise use the nearest project root that owns both its manifest and dependency graph. At that boundary, corroborate `packageManager` (when present), the lockfile, and CI commands. Stop if they disagree or competing manager lockfiles exist there. A nested project is independent only when it is outside the parent workspace; independent subprojects may legitimately use different managers.

| Manager/version signal | Frozen/immutable CI install | Known-advisory audit |
|---|---|---|
| npm (`package-lock.json` or `npm-shrinkwrap.json`) | `npm ci` | `npm audit` |
| pnpm | `pnpm install --frozen-lockfile` | `pnpm audit` |
| Yarn 2+ | `yarn install --immutable` | `yarn npm audit -A -R` |
| Yarn 1 | `yarn install --frozen-lockfile` | `yarn audit` |

For an unlisted manager or version, consult its official documentation; do not substitute another manager's commands or newer defaults.

### 安装脚本门禁

Never discover dependency lifecycle scripts by first executing an ordinary install on a client whose defaults have not been verified.

1. Bootstrap with dependency scripts disabled, or with a documented default-deny policy plus fail-closed enforcement.
2. Inspect the exact script source and package version before approval.
3. Record the narrowest native allow/deny policy at the installation boundary and commit it.
4. Run a clean frozen/immutable install with that policy and verify the required packages still build.

**Point-in-time snapshot:** Package-manager defaults and command names change quickly. Verify this matrix against the pinned client's current official documentation before relying on it.

| Manager version | Native policy |
|---|---|
| npm without verified granular approvals | Bootstrap with `npm ci --ignore-scripts`, or persist `ignore-scripts=true` when project-wide blocking is intended. Keep scripts disabled or deliberately upgrade before allowing any reviewed dependency script. |
| npm 11.18.x (verified on 11.18.0) | Unreviewed dependency scripts run with a warning by default. Enforce `strict-allow-scripts=true` before a normal install, then use the workspace-unaware `npm install-scripts ls` from the installation boundary; keep approvals version-pinned and denials name-wide. |
| npm 12.x (verified on 12.0.1) | Unreviewed dependency scripts are skipped by default; `strict-allow-scripts=true` makes their presence fail the install before execution. Use the same `npm install-scripts` review and approval flow. |
| pnpm 11+ | Use `pnpm approve-builds` and commit `allowBuilds` decisions; `strictDepBuilds` defaults to `true`, so unreviewed builds fail. |
| pnpm 10.26–10.x | Configure `allowBuilds` explicitly, or use `pnpm approve-builds` with the legacy `onlyBuiltDependencies` / `ignoredBuiltDependencies` lists. Set `strictDepBuilds: true`; its v10 default is `false`. |
| pnpm 10.1–10.25 | `pnpm approve-builds` records the legacy lists; enable `strictDepBuilds` where supported (10.3+). |
| Older or unknown pnpm | Bootstrap with `pnpm install --frozen-lockfile --ignore-scripts`. Keep scripts disabled unless the pinned version documents an enforceable policy. |
| Yarn 4.14+ | Dependency postinstalls are disabled by default. Grant only required exceptions with top-level `dependenciesMeta.<package>.built: true`. |
| Yarn 2–4.13 | Set `enableScripts: false` in `.yarnrc.yml`, then grant only required exceptions with top-level `dependenciesMeta.<package>.built: true`; do not enable scripts globally. |
| Yarn 1 | Bootstrap with `yarn install --ignore-scripts`; keep scripts disabled unless each required exception is reviewed under the pinned client's documented workflow. |

权威参考： [npm install-scripts](https://docs.npmjs.com/cli/v11/commands/npm-install-scripts/), [install policy](https://docs.npmjs.com/cli/v11/commands/npm-install/), and [CLI releases](https://github.com/npm/cli/releases); [pnpm approve-builds](https://pnpm.io/cli/approve-builds) and [build settings](https://pnpm.io/settings#allowbuilds); [Yarn security](https://yarnpkg.com/features/security) and [manifest](https://yarnpkg.com/configuration/manifest#dependenciesMeta).

**供应链卫生** (advisory audits do not catch newly malicious packages):
- [ ] Exactly one authoritative lockfile per project/workspace root is committed and CI never rewrites it
- [ ] Critical/high findings are triaged for reachability; deferrals have a reason and review date
- [ ] Forced audit remediation (`npm audit fix --force` or equivalent) is never automatic; remediation diffs and changelogs are reviewed
- [ ] Registry signatures/provenance are verified where the manager supports it
- [ ] Dependency lifecycle scripts are blocked before first execution and approved only through the pinned manager's native policy
- [ ] New dependencies are reviewed for ownership, maintenance, release age, provenance, transitive graph, and typosquatting

## AI / LLM 安全

对于任何调用 LLM 的功能（聊天机器人、摘要器、代理、RAG）：

- [ ] Model output treated as untrusted — never into `eval`/SQL/shell/`innerHTML`/file paths
- [ ] Prompt injection assumed; permissions enforced in code, not in the system prompt
- [ ] Secrets, cross-tenant data, and full system prompts kept out of the context window
- [ ] Tool/agent permissions scoped; destructive or irreversible actions require confirmation
- [ ] Token, rate, and recursion/loop limits set (bound consumption)

## 错误处理

```typescript
// Production: generic error, no internals
res.status(500).json({
  error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' }
});

// NEVER in production:
res.status(500).json({
  error: err.message,
  stack: err.stack,         // Exposes internals
  query: err.sql,           // Exposes database details
});
```

## OWASP Top 10 快速参考

| # | 漏洞 | 防护措施 |
|---|---|---|
| 1 | Broken Access Control | Auth checks on every endpoint, ownership verification |
| 2 | Cryptographic Failures | HTTPS, strong hashing, no secrets in code |
| 3 | Injection | Parameterized queries, input validation |
| 4 | Insecure Design | 威胁 modeling, spec-driven development |
| 5 | Security Misconfiguration | Security headers, minimal permissions, audit deps |
| 6 | Vulnerable Components | The ecosystem's dependency audit (`npm audit`, `pip-audit`, ...), keep deps updated, minimal deps |
| 7 | Auth Failures | Strong passwords, rate limiting, session management |
| 8 | Data Integrity Failures | Verify updates/dependencies, signed artifacts |
| 9 | Logging Failures | Log security events, don't log secrets |
| 10 | SSRF | Validate/allowlist URLs, restrict outbound requests |

## OWASP LLM 十大风险快速参考

适用于具有 LLM 功能的应用。参见 [OWASP GenAI Security Project](https://genai.owasp.org/llm-top-10/).

| ID | 风险 | 防护措施 |
|---|---|---|
| LLM01 | Prompt Injection | Don't trust the system prompt as a boundary; enforce permissions in code |
| LLM02 | Sensitive Information Disclosure | Keep secrets/PII out of prompts; filter outputs |
| LLM03 | Supply Chain | Vet models, datasets, and plugins like any dependency |
| LLM04 | Data and Model Poisoning | Use trusted model sources, verify integrity; vet fine-tuning and RAG data |
| LLM05 | Improper Output 处理方式 | Treat model output as untrusted; validate, parameterize, encode |
| LLM06 | Excessive Agency | Scope tool permissions; confirm destructive actions |
| LLM07 | System Prompt Leakage | Assume the system prompt can leak; put no secrets in it |
| LLM08 | Vector and Embedding Weaknesses | Partition RAG embeddings per tenant; validate documents before indexing |
| LLM09 | Misinformation | Ground answers with citations; validate critical claims; keep a human in the loop |
| LLM10 | Unbounded Consumption | Cap tokens, request rate, and loop/recursion depth |


