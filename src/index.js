import { compileProgramBot, compileNetworkBots } from './compiler';

// ----------------------------------------------------------------------
//  Opcode definitions (copied from compiler for disassembly)
// ----------------------------------------------------------------------
const OP = {
  PUSH_CONST:   0x01,
  POP:          0x02,
  LOAD_VAR:     0x03,
  STORE_VAR:    0x04,
  ADD:          0x05,
  SUB:          0x06,
  MUL:          0x07,
  DIV:          0x08,
  MOD:          0x09,
  EQ:           0x0A,
  NEQ:          0x0B,
  LT:           0x0C,
  GT:           0x0D,
  LTE:          0x0E,
  GTE:          0x0F,
  AND:          0x10,
  OR:           0x11,
  JMP:          0x12,
  JZ:           0x13,
  EXEC_BLOCK:   0x14,
  ENTER_FUNC:   0x20,
  STORE_PARAM:  0x21,
  RETURN:       0x22,
  CALL:         0x23,
  NEW_ARRAY:    0x24,
  NEW_OBJECT:   0x25,
  SET_PROP:     0x26,
  GET_PROP:     0x27,
  SET_PROP_COMPUTED: 0x28,
  GET_PROP_COMPUTED: 0x29,
  THROW:        0x2A,
  CATCH:        0x2B,
  FINALLY:      0x2C,
  END_CATCH:    0x2D,
  HALT:         0xFF,
};

// Reverse mapping for disassembly
const OP_NAME = Object.fromEntries(
  Object.entries(OP).map(([name, code]) => [code, name])
);

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

function formatHex(hexString) {
  const hex = hexString.startsWith('\\x') ? hexString.slice(2) : hexString;
  const pairs = hex.match(/.{1,2}/g) || [];
  const lines = [];
  for (let i = 0; i < pairs.length; i += 16) {
    lines.push(pairs.slice(i, i + 16).join(' '));
  }
  return lines.join('\n');
}

// ----------------------------------------------------------------------
//  Binary decompiler (server‑side)
// ----------------------------------------------------------------------
function disassembleBinary(hexInput) {
  // Remove any whitespace and optional \x prefix
  let clean = hexInput.replace(/\s+/g, '');
  if (clean.startsWith('\\x')) clean = clean.slice(2);
  if (clean.length % 2 !== 0) throw new Error('Invalid hex length');
  
  const bytes = [];
  for (let i = 0; i < clean.length; i += 2) {
    bytes.push(parseInt(clean.substr(i, 2), 16));
  }

  let pos = 0;
  // Header (16 bytes)
  if (bytes.length < 16) throw new Error('Binary too short');
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  const entry = (bytes[4] << 24) | (bytes[5] << 16) | (bytes[6] << 8) | bytes[7];
  const dataSize = (bytes[8] << 24) | (bytes[9] << 16) | (bytes[10] << 8) | bytes[11];
  const codeSize = (bytes[12] << 24) | (bytes[13] << 16) | (bytes[14] << 8) | bytes[15];
  pos = 16;

  if (bytes.length < 16 + dataSize + codeSize) throw new Error('Binary size mismatch');

  // Data section (constants)
  const constants = [];
  const dataEnd = pos + dataSize;
  while (pos < dataEnd) {
    const len = (bytes[pos] << 24) | (bytes[pos+1] << 16) | (bytes[pos+2] << 8) | bytes[pos+3];
    pos += 4;
    if (pos + len > dataEnd) throw new Error('Constant data truncated');
    
    let value;
    if (len === 8) {
      // Double (IEEE 754 little‑endian)
      const buf = new ArrayBuffer(8);
      const view = new DataView(buf);
      for (let i = 0; i < 8; i++) view.setUint8(i, bytes[pos + i]);
      value = view.getFloat64(0, true);
      pos += 8;
    } else if (len === 1 && bytes[pos] === 0) {
      value = null;
      pos += 1;
    } else if (len === 1 && (bytes[pos] === 0 || bytes[pos] === 1)) {
      value = bytes[pos] === 1;
      pos += 1;
    } else {
      // String (UTF-8)
      const strBytes = bytes.slice(pos, pos + len);
      value = new TextDecoder().decode(new Uint8Array(strBytes));
      pos += len;
    }
    constants.push(value);
  }

  // Code section
  const code = bytes.slice(pos, pos + codeSize);
  const disassembly = [];
  let i = 0;
  while (i < code.length) {
    const op = code[i];
    const mnemonic = OP_NAME[op] || `UNKNOWN_0x${op.toString(16).padStart(2,'0')}`;
    let line = `${i.toString(16).padStart(4,'0')}: ${mnemonic}`;
    i++;

    if (op === 0x01 || op === 0x03 || op === 0x04 || op === 0x21 || op === 0x26 || op === 0x27) {
      // 4‑byte constant index
      if (i + 3 >= code.length) throw new Error('Truncated instruction');
      const idx = (code[i] << 24) | (code[i+1] << 16) | (code[i+2] << 8) | code[i+3];
      const constVal = constants[idx];
      line += ` ${idx} (${JSON.stringify(constVal)})`;
      i += 4;
    } else if (op === 0x12 || op === 0x13) {
      // 2‑byte jump offset (signed)
      if (i + 1 >= code.length) throw new Error('Truncated jump');
      let offset = (code[i] << 8) | code[i+1];
      if (offset > 32767) offset -= 65536; // sign‑extend 16‑bit
      line += ` ${offset} (→${(i+2 + offset).toString(16)})`;
      i += 2;
    } else if (op === 0x23 || op === 0x24) {
      // 4‑byte argument count
      if (i + 3 >= code.length) throw new Error('Truncated instruction');
      const arg = (code[i] << 24) | (code[i+1] << 16) | (code[i+2] << 8) | code[i+3];
      line += ` ${arg}`;
      i += 4;
    }
    disassembly.push(line);
  }

  return { magic, entry, dataSize, codeSize, constants, disassembly };
}

// ----------------------------------------------------------------------
//  HTML templates
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
  table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
  th, td { text-align: left; padding: 0.5rem; border-bottom: 1px solid #30363d; }
  th { color: #58a6ff; }
  .opcode { color: #7ee787; }
  .comment { color: #8b949e; font-style: italic; }
  .addr { color: #79c0ff; }
  .data { color: #ff7b72; }
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
    <p style="margin-top: 2rem;"><a href="/decompile" class="btn-secondary btn">🔧 Decompile Binary</a></p>
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
        const formatted = formatHex(hex);
        binaryPanel.style.display = 'block';
        binaryPanel.textContent = formatted;
      } else {
        showToast('Could not load binary', 'error');
      }
    }

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
          if (binaryPanel.style.display === 'block') await fetchBinary();
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

const DECOMPILE_FORM_HTML = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>WEB_PROGRAMS – Decompile Binary</title>
  <style>${LAYOUT_CSS}</style>
</head>
<body>
  <div id="toast" class="toast"></div>
  <div class="card">
    <h1>🔧 Decompile Binary</h1>
    <p>Paste your compiled binary (hex format, with or without leading \\x) below.</p>
    <form id="decompileForm" method="POST" action="/decompile">
      <div class="editor-container">
        <textarea name="binary" id="binary" rows="10" cols="80" placeholder="e.g. 50424f32000000008b01000010030000..." style="width:100%; background:#0d1117; color:#c9d1d9; border:none; padding:1.5rem; font-family: 'JetBrains Mono', monospace; line-height: 1.5;"></textarea>
      </div>
      <div class="button-group">
        <button type="submit" class="btn" id="decompileBtn">Decompile</button>
        <div id="spinner" class="spinner" style="display:none;"></div>
      </div>
    </form>
  </div>
  <script>
    ${TOAST_JS}
    document.getElementById('decompileForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('decompileBtn');
      const spinner = document.getElementById('spinner');
      btn.disabled = true;
      spinner.style.display = 'inline-block';

      const binary = document.getElementById('binary').value;
      try {
        const res = await fetch('/decompile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ binary })
        });
        if (res.ok) {
          const html = await res.text();
          document.open();
          document.write(html);
          document.close();
        } else {
          const text = await res.text();
          showToast('Error: ' + text, 'error');
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

function decompileResultHTML(hexInput) {
  try {
    const { magic, entry, dataSize, codeSize, constants, disassembly } = disassembleBinary(hexInput);
    
    // Build a pretty disassembly with coloured spans
    const disasmHtml = disassembly.map(line => {
      const escaped = escapeHtml(line);
      // Colour address, mnemonic, and arguments
      const coloured = escaped.replace(/^([0-9a-f]{4}):\s+([A-Z_]+)(.*)$/, 
        '<span class="addr">$1:</span> <span class="opcode">$2</span><span class="data">$3</span>');
      return `<div class="disasm-line">${coloured}</div>`;
    }).join('');

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Decompiled Program</title>
  <style>${LAYOUT_CSS}</style>
  <style>
    /* Additional styles for a polished interface */
    .disasm-line { 
      font-family: 'JetBrains Mono', monospace; 
      white-space: pre; 
      padding: 2px 0;
      border-bottom: 1px solid #2d2d2d;
    }
    .disasm-line:hover { background: #1e1e1e; }
    .disasm-line .addr { color: #79c0ff; }
    .disasm-line .opcode { color: #7ee787; font-weight: bold; }
    .disasm-line .data { color: #ff7b72; }
    .section-header {
      cursor: pointer;
      user-select: none;
      padding: 0.5rem;
      background: #1f1f1f;
      border-radius: 8px;
      margin: 1rem 0 0.5rem;
      display: inline-block;
    }
    .section-header:hover { background: #2a2a2a; }
    .section-header:after {
      content: ' ▼';
      font-size: 0.8rem;
      color: #8b949e;
    }
    .section-header.collapsed:after { content: ' ▶'; }
    .section-content { transition: max-height 0.2s ease-out; overflow: hidden; }
    .section-content.collapsed { max-height: 0; }
    .constants-table {
      width: 100%;
      border-collapse: collapse;
      background: #0d1117;
      border-radius: 8px;
      overflow: hidden;
    }
    .constants-table th {
      background: #1f1f1f;
      color: #58a6ff;
      font-weight: 500;
      padding: 0.75rem;
      text-align: left;
    }
    .constants-table td {
      padding: 0.5rem 0.75rem;
      border-bottom: 1px solid #2d2d2d;
      font-family: 'JetBrains Mono', monospace;
    }
    .constants-table tr:last-child td { border-bottom: none; }
    .constants-table .type-tag {
      background: #2d2d2d;
      border-radius: 4px;
      padding: 2px 6px;
      font-size: 0.7rem;
      color: #8b949e;
      margin-left: 8px;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1 style="display: flex; align-items: center; gap: 1rem;">
      <span>🔍 Program Disassembly</span>
      <span style="font-size: 0.8rem; background: #1f1f1f; padding: 0.3rem 0.8rem; border-radius: 20px;">${magic}</span>
    </h1>

    <!-- Header Section (always visible) -->
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin: 2rem 0;">
      <div class="stat-card" style="background: #1f1f1f; border-radius: 12px; padding: 1rem;">
        <div style="color: #8b949e; font-size: 0.8rem;">Entry Point</div>
        <div style="font-size: 1.5rem; font-weight: bold; color: #79c0ff;">${entry}</div>
      </div>
      <div class="stat-card" style="background: #1f1f1f; border-radius: 12px; padding: 1rem;">
        <div style="color: #8b949e; font-size: 0.8rem;">Data Size</div>
        <div style="font-size: 1.5rem; font-weight: bold; color: #7ee787;">${dataSize} bytes</div>
      </div>
      <div class="stat-card" style="background: #1f1f1f; border-radius: 12px; padding: 1rem;">
        <div style="color: #8b949e; font-size: 0.8rem;">Code Size</div>
        <div style="font-size: 1.5rem; font-weight: bold; color: #ff7b72;">${codeSize} bytes</div>
      </div>
    </div>

    <!-- Constants Section (collapsible) -->
    <div class="section-header" onclick="toggleSection('constants')">Constants (${constants.length})</div>
    <div id="constants" class="section-content">
      <table class="constants-table">
        <thead><tr><th>Index</th><th>Value</th><th>Type</th></tr></thead>
        <tbody>
          ${constants.map((v, idx) => {
            let type = typeof v;
            if (v === null) type = 'null';
            else if (Array.isArray(v)) type = 'array';
            else if (type === 'object') type = 'object';
            const display = escapeHtml(JSON.stringify(v));
            return `<tr><td>${idx}</td><td>${display}</td><td><span class="type-tag">${type}</span></td></tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>

    <!-- Disassembly Section (collapsible, default open) -->
    <div class="section-header" onclick="toggleSection('disasm')">Disassembly (${disassembly.length} instructions)</div>
    <div id="disasm" class="section-content">
      <div class="binary-panel" style="white-space: pre; font-family: 'JetBrains Mono', monospace; max-height: 500px; overflow-y: auto;">
        ${disasmHtml}
      </div>
    </div>

    <p style="margin-top: 2rem;"><a href="/decompile" class="btn">← Decompile Another</a></p>
  </div>

  <script>
    function toggleSection(id) {
      const el = document.getElementById(id);
      const header = event.currentTarget;
      if (el.classList.contains('collapsed')) {
        el.classList.remove('collapsed');
        header.classList.remove('collapsed');
      } else {
        el.classList.add('collapsed');
        header.classList.add('collapsed');
      }
    }
    // Initially expand disassembly, collapse constants
    document.getElementById('constants').classList.add('collapsed');
    document.querySelector('.section-header').classList.add('collapsed');
  </script>
</body>
</html>`;
  } catch (err) {
    return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Error</title><style>${LAYOUT_CSS}</style></head>
<body><div class="card"><h1>❌ Decompilation Failed</h1><p>${escapeHtml(err.message)}</p><p><a href="/decompile" class="btn">← Try Again</a></p></div></body>
</html>`;
  }
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

    // --- CREATE PROGRAM (unchanged) ---
    if (request.method === 'POST' && path === '/') {
      // ... (unchanged, keep existing code)
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

    // --- PUBLIC VIEW (unchanged) ---
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

    // --- ADMIN VIEW (unchanged) ---
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

    // --- ADMIN UPDATE (unchanged) ---
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

    // --- GET BINARY HEX (unchanged) ---
    if (request.method === 'GET' && path.match(/^\/admin\/[A-Za-z0-9_-]+\/binary$/)) {
      const token = path.split('/')[2];
      try {
        const res = await supabaseRequest(`programs?admin_token=eq.${token}&select=binary`);
        const data = await res.json();
        if (!data.length) return new Response('Not found', { status: 404 });
        const binaryHex = data[0].binary;
        return new Response(binaryHex, { headers: { 'Content-Type': 'text/plain' } });
      } catch (err) {
        return new Response('Error: ' + err.message, { status: 500 });
      }
    }

    // --- DECOMPILE FORM (GET) ---
    if (request.method === 'GET' && path === '/decompile') {
      return new Response(DECOMPILE_FORM_HTML, { headers: { 'Content-Type': 'text/html' } });
    }

    // --- DECOMPILE RESULT (POST) ---
    if (request.method === 'POST' && path === '/decompile') {
      const contentType = request.headers.get('content-type') || '';
      let binaryHex = '';
      if (contentType.includes('application/x-www-form-urlencoded')) {
        const formData = await request.formData();
        binaryHex = formData.get('binary') || '';
      } else if (contentType.includes('application/json')) {
        const body = await request.json().catch(() => ({}));
        binaryHex = body.binary || '';
      } else {
        binaryHex = await request.text(); // fallback
      }
      if (!binaryHex.trim()) {
        return new Response('Missing binary input', { status: 400 });
      }
      const html = decompileResultHTML(binaryHex);
      return new Response(html, { headers: { 'Content-Type': 'text/html' } });
    }

    // --- ROOT (unchanged) ---
    if (request.method === 'GET' && path === '/') {
      return new Response(ROOT_HTML, { headers: { 'Content-Type': 'text/html' } });
    }

    return new Response('Not found', { status: 404 });
  },
};
