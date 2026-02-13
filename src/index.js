import { compileProgramBot, compileNetworkBots } from './compiler';

// ----------------------------------------------------------------------
//  Global helpers
// ----------------------------------------------------------------------

function escapeHtml(unsafe) {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function generateAdminToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function bufferToHex(buffer) {
  return '\\x' + Buffer.from(buffer).toString('hex');
}

// Format hex for display: group in pairs and add line breaks every 32 bytes
function formatHex(hexString) {
  // Remove leading \x if present
  const hex = hexString.startsWith('\\x') ? hexString.slice(2) : hexString;
  const pairs = hex.match(/.{1,2}/g) || [];
  const lines = [];
  for (let i = 0; i < pairs.length; i += 16) {
    lines.push(pairs.slice(i, i + 16).join(' '));
  }
  return lines.join('\n');
}

// ----------------------------------------------------------------------
//  Embedded UI components – modern, dark theme, with toast notifications
// ----------------------------------------------------------------------

const LAYOUT_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #0a0c10;
    color: #e6edf3;
    line-height: 1.6;
    padding: 2rem;
    max-width: 1200px;
    margin: 0 auto;
  }
  h1, h2, h3 { color: #ff7b72; font-weight: 500; letter-spacing: -0.02em; }
  a { color: #79c0ff; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .card {
    background: #161b22;
    border: 1px solid #30363d;
    border-radius: 16px;
    padding: 2rem;
    margin: 1.5rem 0;
    box-shadow: 0 20px 30px -10px rgba(0,0,0,0.5);
  }
  .btn {
    background: #238636;
    color: white;
    border: none;
    padding: 0.7rem 1.5rem;
    border-radius: 8px;
    font-weight: 600;
    cursor: pointer;
    font-size: 0.95rem;
    transition: all 0.2s;
    margin-right: 0.75rem;
    box-shadow: 0 4px 6px rgba(0,0,0,0.3);
  }
  .btn:hover { background: #2ea043; transform: translateY(-1px); }
  .btn:active { transform: translateY(1px); }
  .btn-secondary {
    background: #21262d;
    color: #c9d1d9;
    border: 1px solid #3d444d;
  }
  .btn-secondary:hover { background: #30363d; }
  .meta {
    display: flex;
    gap: 2rem;
    color: #8b949e;
    font-size: 0.9rem;
    border-bottom: 1px solid #30363d;
    padding-bottom: 0.75rem;
    margin-bottom: 1.5rem;
  }
  .binary-panel {
    background: #0d1117;
    border: 1px solid #3d444d;
    border-radius: 12px;
    padding: 1.5rem;
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    font-size: 0.8rem;
    overflow-x: auto;
    white-space: pre;
    color: #7ee787;
    max-height: 400px;
    overflow-y: auto;
    box-shadow: inset 0 0 10px rgba(0,0,0,0.6);
  }
  .editor-container {
    border: 1px solid #3d444d;
    border-radius: 12px;
    overflow: hidden;
    margin: 1.5rem 0;
    box-shadow: 0 8px 20px rgba(0,0,0,0.6);
  }
  .CodeMirror {
    height: auto;
    min-height: 450px;
    font-size: 14px;
    background: #0d1117;
  }
  .toast {
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 1rem 1.5rem;
    border-radius: 8px;
    background: #1f2833;
    color: white;
    font-weight: 500;
    box-shadow: 0 10px 25px rgba(0,0,0,0.5);
    z-index: 1000;
    display: none;
    border-left: 4px solid #238636;
  }
  .toast.error { border-left-color: #f85149; }
  .toast.warning { border-left-color: #d29922; }
  .spinner {
    display: inline-block;
    width: 20px;
    height: 20px;
    border: 3px solid rgba(255,255,255,0.3);
    border-radius: 50%;
    border-top-color: white;
    animation: spin 1s ease-in-out infinite;
    margin-left: 10px;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .button-group { display: flex; align-items: center; }
  pre code.hljs { background: transparent; padding: 1rem; }
`;

const TOAST_JS = `
  function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast ' + type;
    toast.style.display = 'block';
    setTimeout(() => { toast.style.display = 'none'; }, 4000);
  }
`;

const ROOT_HTML = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>WEB_PROGRAMS – Create</title>
  <style>${LAYOUT_CSS}</style>
</head>
<body>
  <div id="toast" class="toast"></div>
  <div class="card">
    <h1>✨ WEB_PROGRAMS</h1>
    <p style="color: #b1bac4;">Create a new program in your custom language. After creation you'll receive a <strong>public shareable link</strong> and a <strong>secret admin link</strong> for editing.</p>
    <form id="createForm">
      <label for="type" style="display: block; margin: 1rem 0 0.5rem;">Program type:</label>
      <select name="type" id="type" style="padding: 0.6rem; background: #0d1117; color: #c9d1d9; border: 1px solid #3d444d; border-radius: 8px; width: 200px;">
        <option value="program-bot">Program Bot</option>
        <option value="network-bots">Network Bots</option>
      </select>
      <div class="editor-container">
        <textarea name="source" id="source" rows="20" cols="80" placeholder="Enter your source code..." style="width:100%; background:#0d1117; color:#c9d1d9; border:none; padding:1.5rem; font-family: 'JetBrains Mono', monospace; line-height: 1.5;"></textarea>
      </div>
      <div class="button-group">
        <button type="submit" class="btn" id="createBtn">Create Program</button>
        <div id="spinner" class="spinner" style="display:none;"></div>
      </div>
    </form>
  </div>
  <script>
    ${TOAST_JS}
    document.getElementById('createForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('createBtn');
      const spinner = document.getElementById('spinner');
      btn.disabled = true;
      spinner.style.display = 'inline-block';

      const source = document.getElementById('source').value;
      const type = document.getElementById('type').value;
      try {
        const res = await fetch('/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source, type })
        });
        const data = await res.json();
        if (res.ok) {
          showToast('Program created! Redirecting to admin...');
          setTimeout(() => { window.location.href = data.adminUrl; }, 1500);
        } else {
          showToast('Error: ' + (data.details || data.error), 'error');
          btn.disabled = false;
          spinner.style.display = 'none';
        }
      } catch (err) {
        showToast('Network error: ' + err.message, 'error');
        btn.disabled = false;
        spinner.style.display = 'none';
      }
    });
  </script>
</body>
</html>
`;

function publicViewHTML(id, program) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Program ${id}</title>
  <style>${LAYOUT_CSS}</style>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
</head>
<body>
  <div class="card">
    <h1>📄 Program ${id}</h1>
    <div class="meta">
      <span>📅 Created: ${new Date(program.created_at).toLocaleString()}</span>
      <span>🕒 Updated: ${new Date(program.updated_at).toLocaleString()}</span>
    </div>
    <h2>Source Code</h2>
    <pre><code class="language-javascript" style="background: #0d1117; border-radius: 8px;">${escapeHtml(program.source_code)}</code></pre>
    <p style="margin-top: 2rem;">
      <a href="/admin/${program.admin_token}" target="_blank" class="btn">🔐 Admin (edit)</a> 
      <span style="color: #8b949e; margin-left: 1rem;">– keep this link secret.</span>
    </p>
    <script>hljs.highlightAll();</script>
  </div>
</body>
</html>`;
}

function adminViewHTML(program) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Edit Program</title>
  <style>${LAYOUT_CSS}</style>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/6.65.7/codemirror.min.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/6.65.7/theme/dracula.min.css">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/6.65.7/codemirror.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/6.65.7/mode/javascript/javascript.min.js"></script>
</head>
<body>
  <div id="toast" class="toast"></div>
  <div class="card">
    <h1>✏️ Edit Program</h1>
    <div class="meta">
      <span>ID: ${program.id}</span>
      <span>Created: ${new Date(program.created_at).toLocaleString()}</span>
      <span>Updated: ${new Date(program.updated_at).toLocaleString()}</span>
    </div>
    <textarea id="source-textarea" style="display:none;">${escapeHtml(program.source_code)}</textarea>
    <div class="editor-container">
      <div id="editor"></div>
    </div>
    <div style="display: flex; align-items: center; gap: 1rem; margin: 1.5rem 0;">
      <button id="saveBtn" class="btn">💾 Save & Recompile</button>
      <button id="viewBinaryBtn" class="btn btn-secondary">🔍 View Binary (hex)</button>
      <div id="spinner" class="spinner" style="display:none;"></div>
    </div>
    <div id="binary-panel" class="binary-panel" style="display:none;"></div>
  </div>
  <script>
    ${TOAST_JS}
    const sourceTextarea = document.getElementById('source-textarea');
    const editor = document.getElementById('editor');
    const cm = CodeMirror(editor, {
      lineNumbers: true,
      mode: 'javascript',
      theme: 'dracula',
      value: sourceTextarea.value,
      lineWrapping: true,
      indentUnit: 2,
      tabSize: 2
    });

    const saveBtn = document.getElementById('saveBtn');
    const spinner = document.getElementById('spinner');
    const binaryPanel = document.getElementById('binary-panel');

    async function fetchBinary() {
      const res = await fetch(window.location.href + '/binary');
      if (res.ok) {
        const hex = await res.text();
        // Format nicely
        const formatted = formatHex(hex);
        binaryPanel.style.display = 'block';
        binaryPanel.textContent = formatted;
      } else {
        showToast('Could not load binary', 'error');
      }
    }

    // Format hex function (same as worker's but defined here)
    function formatHex(hexString) {
      const hex = hexString.startsWith('\\\\x') ? hexString.slice(2) : hexString;
      const pairs = hex.match(/.{1,2}/g) || [];
      const lines = [];
      for (let i = 0; i < pairs.length; i += 16) {
        lines.push(pairs.slice(i, i + 16).join(' '));
      }
      return lines.join('\\n');
    }

    document.getElementById('viewBinaryBtn').addEventListener('click', fetchBinary);

    saveBtn.addEventListener('click', async () => {
      const source = cm.getValue();
      saveBtn.disabled = true;
      spinner.style.display = 'inline-block';

      try {
        const res = await fetch(window.location.href, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source })
        });
        if (res.ok) {
          showToast('Program saved and recompiled.');
          // Refresh binary if visible
          if (binaryPanel.style.display === 'block') {
            await fetchBinary();
          }
        } else {
          const err = await res.json();
          showToast('Error: ' + (err.details || err.error), 'error');
        }
      } catch (err) {
        showToast('Network error: ' + err.message, 'error');
      } finally {
        saveBtn.disabled = false;
        spinner.style.display = 'none';
      }
    });
  </script>
</body>
</html>`;
}

// ----------------------------------------------------------------------
//  Worker
// ----------------------------------------------------------------------

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    // --- Supabase helper -------------------------------------------------
    async function supabaseRequest(pathSegment, options = {}) {
      const supabaseUrl = `${env.SUPABASE_URL}/rest/v1/${pathSegment}`;
      const headers = {
        'Content-Type': 'application/json',
        'apikey': env.SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${env.SUPABASE_ANON_KEY}`,
        ...options.headers,
      };
      if (options.prefer) headers['Prefer'] = options.prefer;
      const res = await fetch(supabaseUrl, { ...options, headers });
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Supabase error ${res.status}: ${errorText}`);
      }
      return res;
    }

    // -------------------- CREATE PROGRAM --------------------------------
    if (request.method === 'POST' && path === '/') {
      try {
        const body = await request.json().catch(() => ({}));
        const { source, type = 'program-bot' } = body;
        if (!source) {
          return new Response(JSON.stringify({ error: 'Missing source' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        let binaryBuffer;
        try {
          if (type === 'program-bot') {
            binaryBuffer = compileProgramBot(source);
          } else if (type === 'network-bots') {
            binaryBuffer = compileNetworkBots(source);
          } else {
            return new Response(JSON.stringify({ error: 'Invalid type' }), {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
            });
          }
        } catch (err) {
          return new Response(JSON.stringify({ error: 'Compilation failed', details: err.message }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        const adminToken = generateAdminToken();

        // Insert using column name "binary" (must be quoted in SQL, but in JSON it's fine)
        const insertRes = await supabaseRequest('programs', {
          method: 'POST',
          headers: { 'Prefer': 'return=representation' },
          body: JSON.stringify({
            admin_token: adminToken,
            source_code: source,
            binary: bufferToHex(binaryBuffer),
          }),
        });

        const newRecord = await insertRes.json();
        const programId = newRecord[0].id;

        const baseUrl = `${url.protocol}//${url.host}`;
        const publicUrl = `${baseUrl}/${programId}`;
        const adminUrl = `${baseUrl}/admin/${adminToken}`;

        return new Response(JSON.stringify({ publicUrl, adminUrl }), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // -------------------- PUBLIC VIEW ------------------------------------
    const publicMatch = path.match(/^\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
    if (request.method === 'GET' && publicMatch) {
      const id = publicMatch[1];
      try {
        const res = await supabaseRequest(`programs?id=eq.${id}&select=source_code,created_at,updated_at,admin_token`);
        const data = await res.json();
        if (!data.length) return new Response('Not found', { status: 404 });

        const program = data[0];
        const html = publicViewHTML(id, program);
        return new Response(html, { headers: { 'Content-Type': 'text/html' } });
      } catch (err) {
        return new Response('Error: ' + err.message, { status: 500 });
      }
    }

    // -------------------- ADMIN VIEW -------------------------------------
    const adminMatch = path.match(/^\/admin\/([A-Za-z0-9_-]+)$/);
    if (request.method === 'GET' && adminMatch && !path.endsWith('/binary')) {
      const token = adminMatch[1];
      try {
        const res = await supabaseRequest(`programs?admin_token=eq.${token}&select=id,source_code,created_at,updated_at`);
        const data = await res.json();
        if (!data.length) return new Response('Not found', { status: 404 });

        const program = data[0];
        const html = adminViewHTML(program);
        return new Response(html, { headers: { 'Content-Type': 'text/html' } });
      } catch (err) {
        return new Response('Error: ' + err.message, { status: 500 });
      }
    }

    // -------------------- ADMIN UPDATE -----------------------------------
    if (request.method === 'POST' && adminMatch) {
      const token = adminMatch[1];
      try {
        const body = await request.json().catch(() => ({}));
        const { source } = body;
        if (!source) {
          return new Response(JSON.stringify({ error: 'Missing source' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        let binaryBuffer;
        try {
          binaryBuffer = compileProgramBot(source); // assume program-bot
        } catch (err) {
          return new Response(JSON.stringify({ error: 'Compilation failed', details: err.message }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        await supabaseRequest(`programs?admin_token=eq.${token}`, {
          method: 'PATCH',
          body: JSON.stringify({
            source_code: source,
            binary: bufferToHex(binaryBuffer),
            updated_at: new Date().toISOString(),
          }),
        });

        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // -------------------- GET BINARY HEX --------------------------------
    if (request.method === 'GET' && path.match(/^\/admin\/[A-Za-z0-9_-]+\/binary$/)) {
      const token = path.split('/')[2];
      try {
        const res = await supabaseRequest(`programs?admin_token=eq.${token}&select=binary`);
        const data = await res.json();
        if (!data.length) return new Response('Not found', { status: 404 });

        const binaryHex = data[0].binary; // stored as \x... string
        return new Response(binaryHex, { headers: { 'Content-Type': 'text/plain' } });
      } catch (err) {
        return new Response('Error: ' + err.message, { status: 500 });
      }
    }

    // -------------------- ROOT -------------------------------------------
    if (request.method === 'GET' && path === '/') {
      return new Response(ROOT_HTML, { headers: { 'Content-Type': 'text/html' } });
    }

    return new Response('Not found', { status: 404 });
  },
};
