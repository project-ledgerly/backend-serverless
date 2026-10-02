import { API_SCOPES } from '../auth/auth-context.js';
import { SCOPE_LABELS, escapeHtml } from './oauth.util.js';

const STYLE = `
:root{--ink:#223C33;--bg:#f6f7f5;--card:#fff;--line:#d9dfdb;--muted:#5d6f67;--danger:#b3261e;--accent:#223C33}
@media (prefers-color-scheme:dark){:root{--ink:#e8efeb;--bg:#101714;--card:#18221d;--line:#2c3a33;--muted:#9bb0a6;--danger:#ff8a80;--accent:#9fd8b8}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px;background:var(--bg);color:var(--ink);font:16px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{width:100%;max-width:420px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:28px 24px}
h1{font-size:1.25rem;margin:0 0 6px}
.brand{font-weight:700;letter-spacing:.04em;margin-bottom:18px}
p{margin:0 0 16px;color:var(--muted)}
label.field{display:block;font-size:.85rem;margin:12px 0 4px}
input[type=email],input[type=password]{width:100%;padding:11px 12px;border:1px solid var(--line);border-radius:10px;font:inherit;background:transparent;color:inherit}
fieldset{border:1px solid var(--line);border-radius:12px;margin:18px 0 0;padding:6px 14px 10px}
legend{font-size:.85rem;color:var(--muted);padding:0 6px}
.scope{display:flex;gap:10px;align-items:flex-start;padding:8px 0}
.scope input{margin-top:4px}
.err{color:var(--danger);margin:0 0 12px;font-size:.92rem}
.row{display:flex;gap:10px;margin-top:20px}
button{flex:1;padding:12px;border-radius:10px;border:1px solid var(--accent);font:inherit;font-weight:600;cursor:pointer}
button.go{background:var(--accent);color:var(--card)}
button.no{background:transparent;color:var(--ink);border-color:var(--line)}
small{display:block;margin-top:14px;color:var(--muted);font-size:.8rem}
`;

function shell(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head><body><main><div class="brand">CENTRIC</div>${body}</main></body></html>`;
}

export function authorizePage(opts: {
  clientName: string;
  form: string;
  offered: string[];
  checked?: string[];
  email?: string;
  error?: string;
  action: string;
}): string {
  const checked = new Set(opts.checked ?? opts.offered);
  const scopes = API_SCOPES.filter((s) => opts.offered.includes(s))
    .map((s) => {
      if (s === 'read') {
        return `<div class="scope"><input type="checkbox" checked disabled><span>${escapeHtml(SCOPE_LABELS[s] ?? s)}</span></div>`;
      }
      return `<label class="scope"><input type="checkbox" name="scope" value="${s}"${checked.has(s) ? ' checked' : ''}><span>${escapeHtml(SCOPE_LABELS[s] ?? s)}</span></label>`;
    })
    .join('');

  return shell(
    'Connect to Centric',
    `<h1>Connect ${escapeHtml(opts.clientName)}</h1>
<p>Sign in to Centric to let <strong>${escapeHtml(opts.clientName)}</strong> work with your money.</p>
${opts.error ? `<div class="err" role="alert">${escapeHtml(opts.error)}</div>` : ''}
<form method="post" action="${escapeHtml(opts.action)}" autocomplete="on">
<input type="hidden" name="form" value="${escapeHtml(opts.form)}">
<label class="field" for="email">Email</label>
<input id="email" name="email" type="email" autocomplete="username" required value="${escapeHtml(opts.email ?? '')}">
<label class="field" for="password">Password</label>
<input id="password" name="password" type="password" autocomplete="current-password" required>
<fieldset><legend>It will be able to</legend>${scopes}</fieldset>
<div class="row"><button class="no" type="submit" name="decision" value="deny" formnovalidate>Cancel</button><button class="go" type="submit" name="decision" value="approve">Allow</button></div>
<small>You can undo what it does, and revoke its access from Centric at any time.</small>
</form>`,
  );
}

export function errorPage(message: string): string {
  return shell('Cannot connect', `<h1>Cannot connect</h1><p>${escapeHtml(message)}</p>`);
}

export function doneUnknownRedirectPage(): string {
  return errorPage('This sign-in link is no longer valid. Go back to the app and try connecting again.');
}
