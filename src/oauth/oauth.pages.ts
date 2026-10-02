import { API_SCOPES } from '../auth/auth-context.js';
import { LOGO_DATA_URI } from './oauth.assets.js';
import { SCOPE_LABELS, escapeHtml } from './oauth.util.js';

// Same look as the Centric app: white cards on a soft green-grey page, Inter,
// pine (#223C33) outlines, and the lime call-to-action button. Colours are the
// values in the app's AppColors.
const STYLE = `
:root{color-scheme:light;--pine:#223C33;--lime:#D2FD3C;--ink:#111715;--text2:#6E7875;--label:#7A8985;--muted:#8E9995;--line:#D2D8D5;--page:#F2F4F3;--inset:#F4F6F5;--neg:#EF4444}
*{box-sizing:border-box}
html,body{margin:0}
body{min-height:100vh;background:var(--page);color:var(--ink);font:15px/1.45 Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased;display:flex;justify-content:center;align-items:flex-start;padding:max(16px,env(safe-area-inset-top)) 16px max(16px,env(safe-area-inset-bottom))}
main{width:100%;max-width:440px;background:#fff;border-radius:28px;padding:28px 24px 24px;box-shadow:0 8px 32px rgba(34,60,51,.08);margin-top:min(8vh,64px)}
.brand{display:flex;align-items:center;gap:10px;margin-bottom:28px}
.brand img{width:40px;height:40px;border-radius:12px;display:block}
.brand span{font-weight:700;font-size:15px;letter-spacing:-.1px;color:var(--text2)}
h1{margin:0 0 8px;font-size:30px;line-height:1.12;font-weight:800;letter-spacing:-.8px}
.sub{margin:0 0 24px;color:var(--text2);letter-spacing:-.1px}
.sub strong{color:var(--ink);font-weight:700}
.field{display:block;position:relative;border:1.5px solid var(--pine);border-radius:16px;padding:9px 16px 8px;margin:0 0 12px;background:#fff}
.field:focus-within{box-shadow:0 0 0 .5px var(--pine);border-width:2px;padding:8.5px 15.5px 7.5px}
.field span{display:block;font-size:11.5px;font-weight:500;color:var(--label);letter-spacing:.1px}
.field input{display:block;width:100%;border:0;outline:0;padding:2px 0 0;margin:0;font:inherit;font-size:15.5px;font-weight:600;color:var(--ink);letter-spacing:-.2px;background:transparent}
.field input::placeholder{color:var(--muted);font-weight:400}
.scopes{margin:20px 0 4px}
.scopes h2{margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:var(--label)}
.list{background:var(--inset);border-radius:16px;padding:4px 14px}
.scope{display:flex;gap:12px;align-items:center;padding:11px 0;cursor:pointer}
.scope+.scope{border-top:1px solid #E5E7EB}
.scope input{appearance:none;-webkit-appearance:none;flex:none;width:22px;height:22px;margin:0;border:1.5px solid var(--pine);border-radius:7px;background:#fff;display:grid;place-content:center;cursor:pointer}
.scope input::after{content:"";width:11px;height:6px;border:solid var(--ink);border-width:0 0 2.5px 2.5px;transform:rotate(-45deg) translate(1px,-1px);opacity:0}
.scope input:checked{background:var(--lime)}
.scope input:checked::after{opacity:1}
.scope input:disabled{cursor:default}
.scope input:focus-visible{outline:2px solid var(--pine);outline-offset:2px}
.scope b{display:block;font-weight:600;letter-spacing:-.15px}
.scope small{display:block;color:var(--text2);font-size:13px}
.err{display:flex;gap:8px;background:#FEF2F2;color:#B91C1C;border-radius:12px;padding:11px 14px;margin:0 0 16px;font-size:14px;font-weight:500}
.go{display:block;width:100%;height:58px;margin-top:20px;border:0;border-radius:18px;background:var(--lime);color:var(--ink);font:inherit;font-size:16px;font-weight:700;letter-spacing:-.2px;cursor:pointer;transition:transform .12s}
.go:active{transform:scale(.975)}
.go:focus-visible{outline:2px solid var(--pine);outline-offset:3px}
.no{display:block;width:100%;height:48px;margin-top:6px;border:0;background:transparent;color:var(--ink);font:inherit;font-size:14.5px;font-weight:700;letter-spacing:-.2px;cursor:pointer;border-radius:14px}
.no:hover{background:var(--inset)}
.note{margin:14px 0 0;color:var(--muted);font-size:12.5px;line-height:1.5;text-align:center}
@media (max-width:480px){body{padding:0;background:#fff}main{margin-top:0;border-radius:0;box-shadow:none;min-height:100vh;padding:max(24px,env(safe-area-inset-top)) 20px max(20px,env(safe-area-inset-bottom))}}
`;

const FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap">';

function shell(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex"><meta name="theme-color" content="#F2F4F3"><title>${escapeHtml(title)}</title>${FONTS}<style>${STYLE}</style></head><body><main><div class="brand"><img src="${LOGO_DATA_URI}" alt="" width="40" height="40"><span>Centric</span></div>${body}</main></body></html>`;
}

/** Short title and one line of detail for each scope, in plain words. */
const SCOPE_COPY: Record<string, [string, string]> = {
  read: ['View your money', 'Accounts, plan, balances and transactions'],
  'transactions:write': ['Log and fix transactions', 'Add, change and delete transactions and transfers'],
  'plan:write': ['Change your plan', 'Sections, bills, goals and recurring income'],
  'accounts:write': ['Manage accounts', 'Add, rename and remove accounts'],
};

function scopeRow(scope: string, checked: boolean): string {
  const [title, detail] = SCOPE_COPY[scope] ?? [scope, SCOPE_LABELS[scope] ?? ''];
  const text = `<span><b>${escapeHtml(title)}</b><small>${escapeHtml(detail)}</small></span>`;
  if (scope === 'read') {
    // Reading is always part of a connection; shown ticked and locked.
    return `<label class="scope"><input type="checkbox" checked disabled aria-label="Always on">${text}</label>`;
  }
  return `<label class="scope"><input type="checkbox" name="scope" value="${escapeHtml(scope)}"${checked ? ' checked' : ''}>${text}</label>`;
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
  const rows = API_SCOPES.filter((s) => opts.offered.includes(s))
    .map((s) => scopeRow(s, checked.has(s)))
    .join('');
  const name = escapeHtml(opts.clientName);

  return shell(
    'Connect to Centric',
    `<h1>Connect ${name} to Centric</h1>
<p class="sub">Sign in to let <strong>${name}</strong> work with your money. You choose what it can do.</p>
${opts.error ? `<div class="err" role="alert">${escapeHtml(opts.error)}</div>` : ''}
<form method="post" action="${escapeHtml(opts.action)}" autocomplete="on">
<input type="hidden" name="form" value="${escapeHtml(opts.form)}">
<label class="field"><span>Email address</span><input name="email" type="email" autocomplete="username" inputmode="email" placeholder="my.account@gmail.com" required value="${escapeHtml(opts.email ?? '')}"></label>
<label class="field"><span>Password</span><input name="password" type="password" autocomplete="current-password" placeholder="Your password" required></label>
<div class="scopes"><h2>${name} can</h2><div class="list">${rows}</div></div>
<button class="go" type="submit" name="decision" value="approve">Allow access</button>
<button class="no" type="submit" name="decision" value="deny" formnovalidate>Cancel</button>
<p class="note">Everything it does can be undone from Centric, and you can end its access at any time.</p>
</form>`,
  );
}

export function errorPage(message: string): string {
  return shell('Cannot connect', `<h1>Cannot connect</h1><p class="sub">${escapeHtml(message)}</p>`);
}
