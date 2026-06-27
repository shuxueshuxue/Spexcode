// @@@ login page - the gateway's gate is a DESIGNED page, not the browser's Basic-auth dialog (which can't
// be styled and feels like a 1998 intranet). Self-contained: inline CSS + SVG, zero external assets, so it
// renders before anything is authorised. Dark, calm, a single password field; an error state when the
// password is wrong. The form POSTs to /login (same-origin), which mints the auth cookie and redirects.
export function loginPage(error = false): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SpexCode — sign in</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color: #e7ecf3;
    background:
      radial-gradient(900px 600px at 50% -10%, #1b2b4d 0%, rgba(27,43,77,0) 60%),
      radial-gradient(700px 500px at 85% 110%, #1d3b39 0%, rgba(29,59,57,0) 55%),
      #080b12;
  }
  .card {
    width: min(92vw, 360px); padding: 38px 34px 30px;
    background: linear-gradient(180deg, rgba(22,28,40,0.92), rgba(15,19,28,0.92));
    border: 1px solid rgba(120,150,200,0.16); border-radius: 18px;
    box-shadow: 0 30px 80px -30px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.04);
    backdrop-filter: blur(8px);
  }
  .mark { display: flex; align-items: center; gap: 11px; margin-bottom: 26px; }
  .mark svg { width: 30px; height: 30px; }
  .mark b { font-size: 17px; font-weight: 650; letter-spacing: 0.2px; }
  .mark b span { color: #6ea0ff; }
  h1 { font-size: 15px; font-weight: 550; margin: 0 0 4px; }
  p.sub { margin: 0 0 22px; font-size: 12.5px; line-height: 1.5; color: #8b97aa; }
  label { display: block; font-size: 11px; letter-spacing: 0.4px; text-transform: uppercase; color: #8b97aa; margin: 0 0 8px; }
  input {
    width: 100%; padding: 12px 14px; font-size: 14px; color: #eef2f8;
    background: #0c1019; border: 1px solid rgba(120,150,200,0.22); border-radius: 11px;
    outline: none; transition: border-color .15s, box-shadow .15s;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 2px;
  }
  input:focus { border-color: #4f7fe0; box-shadow: 0 0 0 3px rgba(79,127,224,0.18); }
  button {
    width: 100%; margin-top: 16px; padding: 12px 14px; font-size: 14px; font-weight: 600;
    color: #fff; cursor: pointer; border: 0; border-radius: 11px;
    background: linear-gradient(180deg, #4f86f7, #3f6fe0);
    box-shadow: 0 8px 22px -8px rgba(63,111,224,0.7); transition: filter .15s, transform .05s;
  }
  button:hover { filter: brightness(1.07); }
  button:active { transform: translateY(1px); }
  .err {
    margin: 0 0 16px; padding: 9px 12px; font-size: 12.5px; border-radius: 9px;
    color: #ffd2cf; background: rgba(220,80,70,0.12); border: 1px solid rgba(220,80,70,0.32);
  }
  .foot { margin-top: 22px; font-size: 11px; color: #69748a; text-align: center; line-height: 1.5; }
</style>
</head>
<body>
  <form class="card" method="POST" action="/login" autocomplete="off">
    <div class="mark">
      <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="2" y="2" width="28" height="28" rx="8" fill="#0e1626" stroke="#3f6fe0" stroke-opacity="0.5"/>
        <path d="M11 12.5C11 10.6 12.6 9 14.5 9h3a3.5 3.5 0 0 1 0 7h-3a3.5 3.5 0 0 0 0 7h3c1.9 0 3.5-1.6 3.5-3.5" stroke="#6ea0ff" stroke-width="2" stroke-linecap="round"/>
      </svg>
      <b>Spex<span>Code</span></b>
    </div>
    <h1>Restricted access</h1>
    <p class="sub">This is a private agent workspace. Enter the access password to continue.</p>
    ${error ? '<div class="err">Incorrect password — try again.</div>' : ''}
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autofocus required placeholder="••••••••••">
    <button type="submit">Sign in</button>
    <div class="foot">Trusted collaborators only.</div>
  </form>
</body>
</html>`
}
