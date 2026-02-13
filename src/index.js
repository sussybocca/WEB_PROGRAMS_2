import { compileProgramBot, compileNetworkBots } from './compiler';

// ----------------------------------------------------------------------
//  Embedded UI components
// ----------------------------------------------------------------------

const LAYOUT_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Inter', system-ui, -apple-system, sans-serif;
    background: #0d1117;
    color: #c9d1d9;
    line-height: 1.6;
    padding: 2rem;
    max-width: 1200px;
    margin: 0 auto;
  }
  h1, h2, h3 { color: #58a6ff; font-weight: 500; }
  a { color: #58a6ff; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .card {
    background: #161b22;
    border: 1px solid #30363d;
    border-radius: 12px;
    padding: 1.5rem;
    margin: 1.5rem 0;
    box-shadow: 0 8px 24px rgba(0,0,0,0.4);
  }
  .btn {
    background: #238636;
    color: white;
    border: none;
    padding: 0.6rem 1.2rem;
    border-radius: 6px;
    font-weight: 600;
    cursor: pointer;
    font-size: 0.9rem;
    transition: background 0.2s;
    margin-right: 0.5rem;
  }
  .btn:hover { background: #2ea043; }
  .btn-danger { background: #da3633; }
  .btn-danger:hover { background: #f85149; }
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
    border: 1px solid #30363d;
    border-radius: 8px;
    padding: 1rem;
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.8rem;
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-all;
    color: #7ee787;
    max-height: 300px;
    overflow-y: auto;
  }
  .editor-container {
    border: 1px solid #30363d;
    border-radius: 8px;
    overflow: hidden;
    margin: 1rem 0;
  }
  .CodeMirror {
    height: auto;
    min-height: 400px;
    font-size: 14px;
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
  <div class="card">
    <h1>✨ WEB_PROGRAMS</h1>
    <p>Create a new program in your custom language. After creation you'll get a <strong>public shareable link</strong> and a <strong>secret admin link</strong> for editing.</p>
    <form id="createForm">
      <label for="type">Program type:</label>
      <select name="type" id="type" style="margin: 1rem 0; padding: 0.5rem; background: #0d1117; color: #c9d1d9; border: 1px solid #30363d; border-radius: 6px;">
        <option value="program-bot">Program Bot</option>
        <option value="network-bots">Network Bots</option>
      </select>
      <div class="editor-container">
        <textarea name="source" id="source" rows="20" cols="80" placeholder="Enter your source code..." style="width:100%; background:#0d1117; color:#c9d1d9; border:none; padding:1rem; font-family:monospace;"></textarea>
      </div>
      <button type="submit" class="btn">Create Program</button>
    </form>
  </div>
  <script>
    document.getElementById('createForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const source = document.getElementById('source').value;
      const type = document.getElementById('type').value;
      const res = await fetch('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, type })
      });
      const data = await res.json();
      if (res.ok) {
        alert(\`Program created!\\nPublic: \${data.publicUrl}\\nAdmin: \${data.adminUrl}\`);
        window.location.href = data.adminUrl;
      } else {
        alert('Error: ' + (data.details || data.error));
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
      <span>Created: ${new Date(program.created_at).toLocaleString()}</span>
      <span>Updated: ${new Date(program.updated_at).toLocaleString()}</span>
    </div>
    <h2>Source Code</h2>
    <pre><code class="language-javascript">${escapeHtml(program.source_code)}</code></pre>
    <p><a href="/admin/${program.admin_token}" target="_blank" class="btn">🔐 Admin (edit)</a> – keep this link secret.</p>
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
    <div style="margin: 1rem 0;">
      <button id="saveBtn" class="btn">💾 Save & Recompile</button>
      <button id="viewBinaryBtn" class="btn">🔍 View Binary (hex)</button>
    </div>
    <div id="binary-panel" class="binary-panel" style="display:none;"></div>
  </div>
  <script>
    const sourceTextarea = document.getElementById('source-textarea');
    const editor = document.getElementById('editor');
    const cm = CodeMirror(editor, {
      lineNumbers: true,
      mode: 'javascript',  // You can replace with your own language mode
      theme: 'dracula',
      value: sourceTextarea.value,
      lineWrapping: true,
      indentUnit: 2,
      tabSize: 2
    });

    document.getElementById('saveBtn').addEventListener('click', async () => {
      const source = cm.getValue();
      const res = await fetch(window.location.href, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source })
      });
      if (res.ok) {
        alert('Program saved and recompiled.');
        // Optionally refresh binary view
        const binaryRes = await fetch(window.location.href + '/binary');
        if (binaryRes.ok) {
          const hex = await binaryRes.text();
          document.getElementById('binary-panel').style.display = 'block';
          document.getElementById('binary-panel').textContent = hex;
        }
      } else {
        const err = await res.json();
        alert('Error: ' + (err.details || err.error));
      }
    });

    document.getElementById('viewBinaryBtn').addEventListener('click', async () => {
      const res = await fetch(window.location.href + '/binary');
      if (res.ok) {
        const hex = await res.text();
        document.getElementById('binary-panel').style.display = 'block';
        document.getElementById('binary-panel').textContent = hex;
      } else {
        alert('Could not load binary');
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

    // --- Token generation (URL-safe) ------------------------------------
    function generateAdminToken() {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      return btoa(String.fromCharCode(...bytes))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    }

    // --- Hex conversion for bytea ---------------------------------------
    function bufferToHex(buffer) {
      return '\\x' + Buffer.from(buffer).toString('hex');
    }

    // --- Escape HTML (prevent XSS) --------------------------------------
    function escapeHtml(unsafe) {
      return unsafe
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
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

        // Compile
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

    // -------------------- PUBLIC VIEW (GET /:id) -----------------------
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

    // -------------------- ADMIN VIEW (GET /admin/:token) ---------------
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

    // -------------------- ADMIN UPDATE (POST /admin/:token) ------------
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

        // Recompile (assume program-bot; you could store type in DB)
        let binaryBuffer;
        try {
          binaryBuffer = compileProgramBot(source);
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

    // -------------------- GET BINARY HEX (GET /admin/:token/binary) ----
    if (request.method === 'GET' && path.match(/^\/admin\/[A-Za-z0-9_-]+\/binary$/)) {
      const token = path.split('/')[2];
      try {
        const res = await supabaseRequest(`programs?admin_token=eq.${token}&select=binary`);
        const data = await res.json();
        if (!data.length) return new Response('Not found', { status: 404 });

        const binaryHex = data[0].binary; // already stored as \x... string
        return new Response(binaryHex, { headers: { 'Content-Type': 'text/plain' } });
      } catch (err) {
        return new Response('Error: ' + err.message, { status: 500 });
      }
    }

    // -------------------- ROOT (GET /) ----------------------------------
    if (request.method === 'GET' && path === '/') {
      return new Response(ROOT_HTML, { headers: { 'Content-Type': 'text/html' } });
    }

    return new Response('Not found', { status: 404 });
  },
};
