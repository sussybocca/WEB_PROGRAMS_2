import { Ai } from '@cloudflare/ai';
import { compileProgramBot, compileNetworkBots } from './compiler';

// ==================== ENHANCED OPCODE DEFINITIONS ====================
const OP = {
  // Basic stack operations
  PUSH_CONST:   0x01,
  POP:          0x02,
  DUP:          0x03,
  SWAP:         0x04,
  LOAD_VAR:     0x05,
  STORE_VAR:    0x06,
  LOAD_GLOBAL:  0x07,
  STORE_GLOBAL: 0x08,
  ADD:          0x09,
  SUB:          0x0A,
  MUL:          0x0B,
  DIV:          0x0C,
  MOD:          0x0D,
  EQ:           0x0E,
  NEQ:          0x0F,
  LT:           0x10,
  GT:           0x11,
  LTE:          0x12,
  GTE:          0x13,
  AND:          0x14,
  OR:           0x15,
  NOT:          0x16,
  BIT_AND:      0x17,
  BIT_OR:       0x18,
  BIT_XOR:      0x19,
  BIT_NOT:      0x1A,
  SHL:          0x1B,
  SHR:          0x1C,
  USHR:         0x1D,
  NEG:          0x1E,
  POS:          0x1F,
  JMP:          0x20,
  JZ:           0x21,
  JNZ:          0x22,
  CALL:         0x23,
  RETURN:       0x24,
  ENTER_FUNC:   0x25,
  EXIT_FUNC:    0x26,
  NEW_ARRAY:    0x27,
  NEW_OBJECT:   0x28,
  SET_PROP:     0x29,
  GET_PROP:     0x2A,
  SET_PROP_COMPUTED: 0x2B,
  GET_PROP_COMPUTED: 0x2C,
  DELETE_PROP:  0x2D,
  HAS_PROP:     0x2E,
  TYPEOF:       0x2F,
  NEW_CLASS:    0x30,
  DEFINE_METHOD: 0x31,
  INVOKE_SUPER: 0x32,
  INSTANCEOF:   0x33,
  IN_OP:        0x34,
  POW:          0x35,
  COALESCE:     0x36,
  IMPORT:       0x37,
  EXPORT:       0x38,
  IMPORT_DEFAULT: 0x39,
  EXPORT_DEFAULT: 0x3A,
  IMPORT_DYNAMIC: 0x3B,
  AWAIT:        0x3C,
  ASYNC_FUNC:   0x3D,
  YIELD:        0x3E,
  GENERATOR:    0x3F,
  GET_ITERATOR: 0x40,
  ITER_NEXT:    0x41,
  ITER_DONE:    0x42,
  THROW:        0x43,
  CATCH:        0x44,
  FINALLY:      0x45,
  END_CATCH:    0x46,
  DEBUGGER:     0xF0,
  HALT:         0xFF,
};

// Reverse mapping
const OP_NAME = Object.fromEntries(
  Object.entries(OP).map(([name, code]) => [code, name])
);

// ==================== GLOBAL HELPERS ====================
function escapeHtml(unsafe) {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/`/g, '&#96;');
}

function generateAdminToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function bufferToHex(buffer) {
  return '0x' + Buffer.from(buffer).toString('hex').toUpperCase();
}

function formatHex(hexString) {
  const hex = hexString.startsWith('0x') ? hexString.slice(2) : hexString.replace(/\\x/g, '');
  const pairs = hex.match(/.{1,2}/g) || [];
  const lines = [];
  for (let i = 0; i < pairs.length; i += 16) {
    const address = (i * 1).toString(16).padStart(8, '0');
    const hexPart = pairs.slice(i, i + 16).join(' ').padEnd(48);
    const asciiPart = pairs.slice(i, i + 16)
      .map(b => {
        const code = parseInt(b, 16);
        return code >= 32 && code <= 126 ? String.fromCharCode(code) : '.';
      })
      .join('');
    lines.push(`<span class="hex-address">${address}</span>  <span class="hex-bytes">${hexPart}</span>  <span class="hex-ascii">${asciiPart}</span>`);
  }
  return lines.join('\n');
}

function disassembleBinary(hexInput) {
  let clean = hexInput.replace(/\s+/g, '');
  if (clean.startsWith('0x')) clean = clean.slice(2);
  if (clean.startsWith('\\x')) clean = clean.slice(2);
  if (clean.length % 2 !== 0) throw new Error('Invalid hex length');
  
  const bytes = [];
  for (let i = 0; i < clean.length; i += 2) {
    bytes.push(parseInt(clean.substr(i, 2), 16));
  }

  let pos = 0;
  if (bytes.length < 16) throw new Error('Binary too short');
  
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  const version = (bytes[4] << 8) | bytes[5];
  const flags = (bytes[6] << 8) | bytes[7];
  const entry = (bytes[8] << 24) | (bytes[9] << 16) | (bytes[10] << 8) | bytes[11];
  const dataSize = (bytes[12] << 24) | (bytes[13] << 16) | (bytes[14] << 8) | bytes[15];
  const codeSize = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
  pos = 20;

  if (bytes.length < 20 + dataSize + codeSize) throw new Error('Binary size mismatch');

  const constants = [];
  const dataEnd = pos + dataSize;
  while (pos < dataEnd) {
    const type = bytes[pos++];
    let value;
    
    switch(type) {
      case 0x01: // String
        const strLen = (bytes[pos] << 24) | (bytes[pos+1] << 16) | (bytes[pos+2] << 8) | bytes[pos+3];
        pos += 4;
        const strBytes = bytes.slice(pos, pos + strLen);
        value = new TextDecoder().decode(new Uint8Array(strBytes));
        pos += strLen;
        break;
      case 0x02: // Number (double)
        const buf = new ArrayBuffer(8);
        const view = new DataView(buf);
        for (let i = 0; i < 8; i++) view.setUint8(i, bytes[pos + i]);
        value = view.getFloat64(0, true);
        pos += 8;
        break;
      case 0x03: // Integer
        value = (bytes[pos] << 24) | (bytes[pos+1] << 16) | (bytes[pos+2] << 8) | bytes[pos+3];
        pos += 4;
        break;
      case 0x04: // Boolean
        value = bytes[pos++] === 1;
        break;
      case 0x05: // Null
        value = null;
        break;
      case 0x06: // BigInt
        const bigBuf = new ArrayBuffer(8);
        const bigView = new DataView(bigBuf);
        for (let i = 0; i < 8; i++) bigView.setUint8(i, bytes[pos + i]);
        value = BigInt.asIntN(64, BigInt(bigView.getBigInt64(0, true)));
        pos += 8;
        break;
      case 0x07: // Array
        const arrLen = (bytes[pos] << 24) | (bytes[pos+1] << 16) | (bytes[pos+2] << 8) | bytes[pos+3];
        pos += 4;
        value = new Array(arrLen);
        for (let i = 0; i < arrLen; i++) {
          value[i] = `[complex]`;
        }
        break;
      case 0x08: // Object
        const objLen = (bytes[pos] << 24) | (bytes[pos+1] << 16) | (bytes[pos+2] << 8) | bytes[pos+3];
        pos += 4;
        value = {};
        for (let i = 0; i < objLen; i++) {
          pos += 8;
        }
        break;
      default:
        value = `[unknown type 0x${type.toString(16)}]`;
    }
    constants.push({ type, value });
  }

  const code = bytes.slice(pos, pos + codeSize);
  const disassembly = [];
  let i = 0;
  
  while (i < code.length) {
    const op = code[i];
    const mnemonic = OP_NAME[op] || `UNKNOWN_0x${op.toString(16).padStart(2,'0')}`;
    let line = {
      address: i,
      opcode: op,
      mnemonic: mnemonic,
      operands: [],
      bytes: []
    };
    
    let bytesForOp = [op];
    i++;

    if ([0x01, 0x05, 0x06, 0x07, 0x08, 0x29, 0x2A].includes(op)) {
      if (i + 3 >= code.length) throw new Error('Truncated instruction');
      const idx = (code[i] << 24) | (code[i+1] << 16) | (code[i+2] << 8) | code[i+3];
      const constVal = constants[idx];
      line.operands.push({ type: 'const', value: idx, resolved: constVal });
      bytesForOp.push(code[i], code[i+1], code[i+2], code[i+3]);
      i += 4;
    } else if ([0x20, 0x21, 0x22].includes(op)) {
      if (i + 1 >= code.length) throw new Error('Truncated jump');
      let offset = (code[i] << 8) | code[i+1];
      if (offset > 32767) offset -= 65536;
      line.operands.push({ type: 'offset', value: offset, target: i + 2 + offset });
      bytesForOp.push(code[i], code[i+1]);
      i += 2;
    } else if ([0x23, 0x27, 0x30].includes(op)) {
      if (i + 3 >= code.length) throw new Error('Truncated instruction');
      const arg = (code[i] << 24) | (code[i+1] << 16) | (code[i+2] << 8) | code[i+3];
      line.operands.push({ type: 'count', value: arg });
      bytesForOp.push(code[i], code[i+1], code[i+2], code[i+3]);
      i += 4;
    }
    
    line.bytes = bytesForOp.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
    disassembly.push(line);
  }

  return { magic, version, flags, entry, dataSize, codeSize, constants, disassembly };
}

// ==================== AI FEATURES ====================
async function handleAITransform(request, env) {
  try {
    const ai = new Ai(env.AI);
    const { prompt, sourceCode, targetLanguage, task } = await request.json();
    
    if (!prompt) {
      return new Response(JSON.stringify({ error: 'Missing prompt' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let systemPrompt;
    
    if (task === 'enhance') {
      systemPrompt = `You are an expert compiler engineer and language designer. You are modifying a custom compiler that compiles a JavaScript-like language to bytecode.

CRITICAL RULES:
1. Return ONLY the complete modified compiler code
2. NO explanations, NO markdown, NO backticks
3. The code MUST be valid JavaScript
4. Preserve ALL existing functionality and exports
5. Keep the same structure and opcode definitions
6. Add the requested feature seamlessly

The compiler has these opcodes: ${Object.keys(OP).slice(0, 30).join(', ')}...

Current compiler source:
${sourceCode}

User requested enhancement: ${prompt}

Return ONLY the complete modified code:`;
    } else if (task === 'debug') {
      systemPrompt = `You are a debugging expert. Analyze this code and fix any bugs or issues.

Code to debug:
${sourceCode}

User description of issue: ${prompt}

Return ONLY the fixed code with NO explanations:`;
    } else if (task === 'optimize') {
      systemPrompt = `You are a performance optimization expert. Optimize this code for better performance:

${sourceCode}

Optimization goals: ${prompt}

Return ONLY the optimized code with NO explanations:`;
    } else {
      systemPrompt = `You are a programming language expert. Generate code for a custom language compiler.
The language supports variables, functions, classes, loops, conditionals, and more.
Based on the user's description, generate appropriate source code.

Example format:
function greet(name) {
  return "Hello, " + name;
}

class Calculator {
  add(a, b) { return a + b; }
}

User request: ${prompt}

Return ONLY the code without explanation.`;
    }

    const response = await ai.run('@cf/meta/llama-2-7b-chat-int8', {
      prompt: systemPrompt,
      temperature: 0.2,
      max_tokens: 4000,
    });

    let generatedCode = response.response || response;
    
    generatedCode = generatedCode.replace(/```javascript\n?/g, '');
    generatedCode = generatedCode.replace(/```\n?/g, '');
    generatedCode = generatedCode.replace(/^Here'?s?(?: the)? (?:modified|enhanced|optimized|debugged)? code:?\s*/i, '');
    generatedCode = generatedCode.trim();
    
    if (sourceCode) {
      try {
        new Function(generatedCode);
        
        const hasProgramBot = generatedCode.includes('export function compileProgramBot') || 
                              generatedCode.includes('export const compileProgramBot');
        const hasNetworkBots = generatedCode.includes('export function compileNetworkBots') || 
                               generatedCode.includes('export const compileNetworkBots');
        
        if (!hasProgramBot || !hasNetworkBots) {
          throw new Error('Generated code missing required exports (compileProgramBot or compileNetworkBots)');
        }
        
        return new Response(JSON.stringify({ 
          success: true, 
          transformed: generatedCode,
          original: sourceCode,
          stats: {
            originalLength: sourceCode.length,
            newLength: generatedCode.length,
            diff: generatedCode.length - sourceCode.length
          }
        }), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ 
          error: 'AI generated invalid code',
          details: err.message,
          aiResponse: generatedCode,
          preview: generatedCode.substring(0, 500) + (generatedCode.length > 500 ? '...' : '')
        }), { status: 400 });
      }
    } else {
      return new Response(JSON.stringify({ 
        success: true, 
        generated: generatedCode 
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function handleAIAssistedCompile(request, env) {
  try {
    const ai = new Ai(env.AI);
    const { prompt, type = 'program-bot', complexity = 'medium' } = await request.json();
    
    if (!prompt) {
      return new Response(JSON.stringify({ error: 'Missing prompt' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const complexityPrompts = {
      simple: 'Generate simple, beginner-friendly code with clear comments.',
      medium: 'Generate moderately complex code with good practices and some advanced features.',
      complex: 'Generate advanced, production-ready code with error handling, optimizations, and best practices.'
    };

    const systemPrompt = `You are a programming language expert. Generate code for a custom language compiler.
The language supports variables, functions, classes, loops, conditionals, modules, async/await, and more.

${complexityPrompts[complexity] || complexityPrompts.medium}

Based on the user's description, generate appropriate source code.

Example formats:

// Function example
function fibonacci(n) {
  if (n <= 1) return n;
  return fibonacci(n-1) + fibonacci(n-2);
}

// Class example
class DataProcessor {
  constructor(data) {
    this.data = data;
    this.processed = [];
  }
  
  process() {
    for (let item of this.data) {
      this.processed.push(this.transform(item));
    }
    return this.processed;
  }
  
  transform(item) {
    return item * 2;
  }
}

// Async example
async function fetchData(url) {
  try {
    const response = await fetch(url);
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Fetch failed:', error);
    return null;
  }
}

User request: ${prompt}

Return ONLY the code without explanation.`;

    const response = await ai.run('@cf/meta/llama-2-7b-chat-int8', {
      prompt: systemPrompt,
      temperature: 0.3,
      max_tokens: 2500,
    });

    let generatedCode = response.response || response;
    
    const codeMatch = generatedCode.match(/```(?:\w+)?\n([\s\S]+?)```/);
    const cleanCode = codeMatch ? codeMatch[1] : generatedCode;

    let binaryBuffer;
    try {
      if (type === 'program-bot') {
        binaryBuffer = compileProgramBot(cleanCode);
      } else {
        binaryBuffer = compileNetworkBots(cleanCode);
      }
    } catch (err) {
      return new Response(JSON.stringify({ 
        error: 'Compilation failed', 
        details: err.message,
        generatedCode: cleanCode,
        suggestion: 'Try simplifying the code or check for syntax errors.'
      }), { status: 400 });
    }

    const adminToken = generateAdminToken();
    const insertRes = await supabaseRequest(env, 'programs', {
      method: 'POST',
      headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify({
        admin_token: adminToken,
        source_code: cleanCode,
        binary: bufferToHex(binaryBuffer),
      }),
    });

    const newRecord = await insertRes.json();
    const programId = newRecord[0].id;
    const baseUrl = `${new URL(request.url).protocol}//${new URL(request.url).host}`;

    const lines = cleanCode.split('\n').length;
    const functions = (cleanCode.match(/function\s+\w+\s*\(/g) || []).length;
    const classes = (cleanCode.match(/class\s+\w+/g) || []).length;
    const asyncOps = (cleanCode.match(/async|await|Promise/g) || []).length;

    return new Response(JSON.stringify({ 
      success: true,
      programId,
      sourceCode: cleanCode,
      publicUrl: `${baseUrl}/${programId}`,
      adminUrl: `${baseUrl}/admin/${adminToken}`,
      binary: bufferToHex(binaryBuffer),
      stats: {
        lines,
        functions,
        classes,
        asyncOps,
        complexity
      }
    }), {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// ==================== SUPABASE HELPER ====================
async function supabaseRequest(env, pathSegment, options = {}) {
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

// ==================== IMMERSIVE UI STYLES ====================
const LAYOUT_CSS = `
  :root {
    --bg-primary: #0a0c10;
    --bg-secondary: #161b22;
    --bg-tertiary: #1f1f1f;
    --accent-primary: #ff7b72;
    --accent-secondary: #79c0ff;
    --accent-success: #7ee787;
    --accent-warning: #ffa657;
    --accent-ai: #bc8cff;
    --text-primary: #e6edf3;
    --text-secondary: #b1bac4;
    --text-tertiary: #8b949e;
    --border-color: #30363d;
    --glow-color: rgba(121, 192, 255, 0.4);
  }

  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  body {
    font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif;
    background: linear-gradient(135deg, var(--bg-primary) 0%, #010409 100%);
    color: var(--text-primary);
    line-height: 1.6;
    min-height: 100vh;
    position: relative;
    overflow-x: hidden;
  }

  body::before {
    content: '';
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: 
      radial-gradient(circle at 20% 50%, rgba(255, 123, 114, 0.05) 0%, transparent 50%),
      radial-gradient(circle at 80% 80%, rgba(121, 192, 255, 0.05) 0%, transparent 50%),
      repeating-linear-gradient(45deg, rgba(48, 54, 61, 0.1) 0px, rgba(48, 54, 61, 0.1) 1px, transparent 1px, transparent 10px);
    pointer-events: none;
    z-index: 0;
  }

  .container {
    max-width: 1400px;
    margin: 0 auto;
    padding: 2rem;
    position: relative;
    z-index: 1;
  }

  h1, h2, h3, h4 {
    font-weight: 600;
    letter-spacing: -0.02em;
    background: linear-gradient(135deg, var(--text-primary) 0%, var(--accent-secondary) 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    margin-bottom: 1rem;
  }

  .card {
    background: rgba(22, 27, 34, 0.8);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border: 1px solid var(--border-color);
    border-radius: 24px;
    padding: 2rem;
    margin: 1.5rem 0;
    box-shadow: 
      0 20px 30px -10px rgba(0,0,0,0.5),
      0 0 0 1px rgba(255,255,255,0.05) inset,
      0 0 20px var(--glow-color);
    transition: all 0.3s ease;
  }

  .card:hover {
    transform: translateY(-2px);
    box-shadow: 
      0 25px 35px -12px rgba(0,0,0,0.6),
      0 0 0 1px rgba(255,255,255,0.1) inset,
      0 0 30px var(--glow-color);
  }

  .btn {
    background: linear-gradient(135deg, #238636 0%, #2ea043 100%);
    color: white;
    border: none;
    padding: 0.8rem 1.8rem;
    border-radius: 12px;
    font-weight: 600;
    cursor: pointer;
    font-size: 1rem;
    transition: all 0.2s;
    margin-right: 0.75rem;
    box-shadow: 0 4px 12px rgba(35, 134, 54, 0.3);
    position: relative;
    overflow: hidden;
  }

  .btn::before {
    content: '';
    position: absolute;
    top: 0;
    left: -100%;
    width: 100%;
    height: 100%;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
    transition: left 0.5s;
  }

  .btn:hover::before {
    left: 100%;
  }

  .btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 20px rgba(35, 134, 54, 0.4);
  }

  .btn:active {
    transform: translateY(1px);
  }

  .btn-secondary {
    background: linear-gradient(135deg, #21262d 0%, #30363d 100%);
    box-shadow: 0 4px 12px rgba(33, 38, 45, 0.3);
  }

  .btn-ai {
    background: linear-gradient(135deg, #6f42c1 0%, #7b4fd0 100%);
    box-shadow: 0 4px 12px rgba(111, 66, 193, 0.3);
  }

  .btn-danger {
    background: linear-gradient(135deg, #da3633 0%, #f85149 100%);
    box-shadow: 0 4px 12px rgba(218, 54, 51, 0.3);
  }

  .btn-outline {
    background: transparent;
    border: 1px solid var(--border-color);
    color: var(--text-primary);
    box-shadow: none;
  }

  .btn-outline:hover {
    background: rgba(255,255,255,0.05);
    border-color: var(--accent-secondary);
  }

  .meta {
    display: flex;
    gap: 2rem;
    color: var(--text-tertiary);
    font-size: 0.9rem;
    padding-bottom: 0.75rem;
    margin-bottom: 1.5rem;
    border-bottom: 1px solid var(--border-color);
  }

  .meta-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .meta-item i {
    color: var(--accent-secondary);
  }

  .binary-panel {
    background: #0d1117;
    border: 1px solid var(--border-color);
    border-radius: 16px;
    padding: 1.5rem;
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    font-size: 0.85rem;
    overflow-x: auto;
    white-space: pre;
    color: var(--accent-success);
    max-height: 500px;
    overflow-y: auto;
    box-shadow: inset 0 0 20px rgba(0,0,0,0.8);
    position: relative;
  }

  .binary-panel::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 2px;
    background: linear-gradient(90deg, var(--accent-primary), var(--accent-secondary), var(--accent-success));
  }

  .editor-container {
    border: 1px solid var(--border-color);
    border-radius: 16px;
    overflow: hidden;
    margin: 1.5rem 0;
    box-shadow: 0 8px 20px rgba(0,0,0,0.6);
    transition: all 0.3s;
  }

  .editor-container:focus-within {
    border-color: var(--accent-secondary);
    box-shadow: 0 0 0 2px var(--glow-color);
  }

  .CodeMirror {
    height: auto;
    min-height: 500px;
    font-size: 14px;
    background: #0d1117 !important;
  }

  .toast {
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 1rem 1.5rem;
    border-radius: 12px;
    background: var(--bg-tertiary);
    color: var(--text-primary);
    font-weight: 500;
    box-shadow: 0 10px 25px rgba(0,0,0,0.5);
    z-index: 9999;
    display: none;
    border-left: 4px solid var(--accent-success);
    backdrop-filter: blur(10px);
    animation: slideIn 0.3s ease;
  }

  @keyframes slideIn {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }

  .toast.error { border-left-color: #f85149; }
  .toast.warning { border-left-color: #d29922; }
  .toast.info { border-left-color: var(--accent-secondary); }

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

  .button-group {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.75rem;
    margin: 1rem 0;
  }

  .ai-prompt {
    width: 100%;
    padding: 1rem 1.2rem;
    background: rgba(13, 17, 23, 0.8);
    backdrop-filter: blur(5px);
    border: 1px solid var(--border-color);
    border-radius: 16px;
    color: var(--text-primary);
    margin-bottom: 1rem;
    font-size: 1rem;
    transition: all 0.2s;
  }

  .ai-prompt:focus {
    outline: none;
    border-color: var(--accent-ai);
    box-shadow: 0 0 0 3px rgba(188, 140, 255, 0.2);
  }

  .ai-response {
    background: rgba(31, 31, 31, 0.8);
    backdrop-filter: blur(5px);
    border-left: 4px solid var(--accent-ai);
    padding: 1.5rem;
    border-radius: 16px;
    margin: 1.5rem 0;
    animation: fadeIn 0.3s ease;
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .badge {
    background: linear-gradient(135deg, var(--accent-ai), #9d7ad9);
    color: white;
    padding: 0.3rem 0.8rem;
    border-radius: 30px;
    font-size: 0.8rem;
    font-weight: 600;
    letter-spacing: 0.5px;
    display: inline-block;
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 1rem;
    margin: 1.5rem 0;
  }

  .stat-card {
    background: rgba(22, 27, 34, 0.6);
    backdrop-filter: blur(5px);
    border: 1px solid var(--border-color);
    border-radius: 16px;
    padding: 1.2rem;
    text-align: center;
    transition: all 0.2s;
  }

  .stat-card:hover {
    transform: translateY(-2px);
    border-color: var(--accent-secondary);
  }

  .stat-value {
    font-size: 2rem;
    font-weight: 700;
    background: linear-gradient(135deg, var(--text-primary), var(--accent-secondary));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .stat-label {
    color: var(--text-tertiary);
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .tabs {
    display: flex;
    gap: 0.5rem;
    border-bottom: 1px solid var(--border-color);
    margin-bottom: 1.5rem;
    padding-bottom: 0.5rem;
  }

  .tab {
    padding: 0.6rem 1.2rem;
    border-radius: 8px 8px 0 0;
    cursor: pointer;
    color: var(--text-tertiary);
    transition: all 0.2s;
  }

  .tab.active {
    color: var(--text-primary);
    background: rgba(255,255,255,0.05);
    border-bottom: 2px solid var(--accent-secondary);
  }

  .tab:hover {
    color: var(--text-primary);
    background: rgba(255,255,255,0.02);
  }

  .hex-viewer {
    font-family: 'JetBrains Mono', monospace;
    line-height: 1.6;
  }

  .hex-address {
    color: var(--accent-secondary);
    user-select: none;
  }

  .hex-bytes {
    color: var(--accent-success);
  }

  .hex-ascii {
    color: var(--text-tertiary);
  }

  .diff-view {
    background: #0d1117;
    border-radius: 12px;
    padding: 1rem;
    overflow-x: auto;
  }

  .diff-line {
    font-family: 'JetBrains Mono', monospace;
    white-space: pre;
    padding: 2px 0;
  }

  .diff-added {
    background: rgba(46, 160, 67, 0.15);
    color: #7ee787;
  }

  .diff-removed {
    background: rgba(248, 81, 73, 0.15);
    color: #f85149;
  }

  .modal {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0,0,0,0.8);
    backdrop-filter: blur(5px);
    display: none;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  }

  .modal.active {
    display: flex;
  }

  .modal-content {
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 24px;
    padding: 2rem;
    max-width: 800px;
    width: 90%;
    max-height: 80vh;
    overflow-y: auto;
    box-shadow: 0 30px 40px rgba(0,0,0,0.7);
  }

  .progress-bar {
    width: 100%;
    height: 4px;
    background: var(--border-color);
    border-radius: 2px;
    overflow: hidden;
    margin: 1rem 0;
  }

  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--accent-success), var(--accent-secondary));
    width: 0%;
    transition: width 0.3s;
  }

  .typing-effect {
    border-right: 2px solid var(--accent-ai);
    white-space: nowrap;
    overflow: hidden;
    animation: typing 3.5s steps(40, end), blink-caret 0.75s step-end infinite;
  }

  @keyframes typing {
    from { width: 0; }
    to { width: 100%; }
  }

  @keyframes blink-caret {
    from, to { border-color: transparent; }
    50% { border-color: var(--accent-ai); }
  }

  .glow-text {
    text-shadow: 0 0 10px currentColor;
  }

  .particle-bg {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 0;
  }
`;

// ==================== TOAST JS ====================
const TOAST_JS = `
function showToast(message, type = 'success', duration = 4000) {
  const toast = document.getElementById('toast');
  toast.className = 'toast ' + type;
  toast.style.display = 'block';
  
  const icons = {
    success: '✅',
    error: '❌',
    warning: '⚠️',
    info: 'ℹ️'
  };
  
  toast.innerHTML = icons[type] + ' ' + message;
  
  setTimeout(() => {
    toast.style.display = 'none';
  }, duration);
}

function showModal(id) {
  document.getElementById(id).classList.add('active');
}

function hideModal(id) {
  document.getElementById(id).classList.remove('active');
}

function updateProgress(value) {
  const bar = document.getElementById('progressFill');
  if (bar) bar.style.width = value + '%';
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    showToast('Copied to clipboard!', 'success');
  }).catch(() => {
    showToast('Failed to copy', 'error');
  });
}

function downloadAsFile(content, filename) {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
`;

// ==================== ROOT HTML ====================
const ROOT_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WEB_PROGRAMS – Neural Code Forge</title>
  <style>${LAYOUT_CSS}</style>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/6.65.7/codemirror.min.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/6.65.7/theme/dracula.min.css">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/6.65.7/codemirror.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/6.65.7/mode/javascript/javascript.min.js"></script>
</head>
<body>
  <div class="particle-bg" id="particleBg"></div>
  <div id="toast" class="toast"></div>
  
  <!-- Modals -->
  <div id="compilerModal" class="modal">
    <div class="modal-content">
      <h2><i class="fas fa-code"></i> Enhanced Compiler Preview</h2>
      <div id="compilerPreview" class="binary-panel" style="max-height: 400px;"></div>
      <div class="button-group" style="margin-top: 1rem;">
        <button class="btn btn-secondary" onclick="hideModal('compilerModal')">Close</button>
        <button class="btn" id="applyCompilerBtn">Apply Changes</button>
        <button class="btn btn-outline" id="downloadCompilerBtn">Download</button>
      </div>
    </div>
  </div>

  <div id="statsModal" class="modal">
    <div class="modal-content">
      <h2><i class="fas fa-chart-bar"></i> Code Statistics</h2>
      <div id="statsContent"></div>
      <div class="button-group" style="margin-top: 1rem;">
        <button class="btn btn-secondary" onclick="hideModal('statsModal')">Close</button>
      </div>
    </div>
  </div>

  <div class="container">
    <div class="card">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 2rem;">
        <div>
          <h1 style="font-size: 2.5rem; margin: 0;">⚡ NEURAL CODE FORGE</h1>
          <p style="color: var(--text-tertiary);">AI-Powered Program Synthesis & Compiler Enhancement</p>
        </div>
        <div>
          <span class="badge">v3.0 AI</span>
          <span class="badge" style="background: linear-gradient(135deg, #ff7b72, #ffa657);">BETA</span>
        </div>
      </div>

      <!-- AI Assistant Section -->
      <div style="background: rgba(31, 31, 31, 0.6); border-radius: 24px; padding: 2rem; margin: 2rem 0;">
        <h2 style="display: flex; align-items: center; gap: 1rem;">
          <i class="fas fa-robot" style="color: var(--accent-ai);"></i>
          Neural AI Assistant
        </h2>
        
        <div class="tabs">
          <div class="tab active" data-tab="generate">Generate</div>
          <div class="tab" data-tab="enhance">Enhance</div>
          <div class="tab" data-tab="debug">Debug</div>
          <div class="tab" data-tab="optimize">Optimize</div>
        </div>

        <!-- Generate Tab -->
        <div id="generateTab" class="tab-content" style="display: block;">
          <textarea id="aiPrompt" class="ai-prompt" rows="2" placeholder="Describe what you want to create... e.g., 'Create a REST API client with fetch and error handling'"></textarea>
          
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
            <div>
              <label style="color: var(--text-secondary); display: block; margin-bottom: 0.5rem;">Complexity</label>
              <select id="complexity" style="width: 100%; padding: 0.8rem; background: #0d1117; color: var(--text-primary); border: 1px solid var(--border-color); border-radius: 12px;">
                <option value="simple">Simple</option>
                <option value="medium" selected>Medium</option>
                <option value="complex">Complex</option>
              </select>
            </div>
            <div>
              <label style="color: var(--text-secondary); display: block; margin-bottom: 0.5rem;">Program Type</label>
              <select id="aiType" style="width: 100%; padding: 0.8rem; background: #0d1117; color: var(--text-primary); border: 1px solid var(--border-color); border-radius: 12px;">
                <option value="program-bot">Program Bot</option>
                <option value="network-bots">Network Bots</option>
              </select>
            </div>
          </div>

          <div class="button-group">
            <button id="generateWithAI" class="btn btn-ai">
              <i class="fas fa-magic"></i> Generate with AI
            </button>
            <button id="showExamples" class="btn btn-outline">
              <i class="fas fa-lightbulb"></i> Examples
            </button>
          </div>
        </div>

        <!-- Enhance Tab -->
        <div id="enhanceTab" class="tab-content" style="display: none;">
          <textarea id="enhancePrompt" class="ai-prompt" rows="3" placeholder="Describe how to enhance the compiler... e.g., 'Add support for async/await with Promise chaining'"></textarea>
          <div class="button-group">
            <button id="enhanceCompiler" class="btn btn-ai">
              <i class="fas fa-upgrade"></i> Enhance Compiler
            </button>
          </div>
          <div style="margin-top: 1rem;">
            <label style="color: var(--text-secondary);">Current Compiler Version:</label>
            <span id="compilerVersion" style="color: var(--accent-success); margin-left: 1rem;">v1.0 (Default)</span>
            <button id="resetCompiler" class="btn btn-outline btn-small" style="margin-left: 1rem;">
              <i class="fas fa-undo"></i> Reset
            </button>
          </div>
        </div>

        <!-- Debug Tab -->
        <div id="debugTab" class="tab-content" style="display: none;">
          <textarea id="debugPrompt" class="ai-prompt" rows="3" placeholder="Describe the bug or paste error message..."></textarea>
          <div class="button-group">
            <button id="debugCode" class="btn btn-danger">
              <i class="fas fa-bug"></i> Debug Code
            </button>
          </div>
        </div>

        <!-- Optimize Tab -->
        <div id="optimizeTab" class="tab-content" style="display: none;">
          <textarea id="optimizePrompt" class="ai-prompt" rows="3" placeholder="Optimization goals... e.g., 'Make it faster and use less memory'"></textarea>
          <div class="button-group">
            <button id="optimizeCode" class="btn btn-secondary">
              <i class="fas fa-rocket"></i> Optimize
            </button>
          </div>
        </div>

        <div id="aiResponse" class="ai-response" style="display:none;"></div>
      </div>

      <!-- Code Editor Section -->
      <h2 style="display: flex; align-items: center; gap: 1rem;">
        <i class="fas fa-pen-fancy"></i>
        Program Editor
        <span style="font-size: 0.9rem; color: var(--text-tertiary);" id="cursorPosition"></span>
      </h2>

      <div class="editor-container">
        <textarea name="source" id="source" rows="20" cols="80" placeholder="// Enter your source code here..." style="display:none;"></textarea>
        <div id="editor"></div>
      </div>

      <!-- Stats and Controls -->
      <div class="stats-grid" id="liveStats">
        <div class="stat-card">
          <div class="stat-value" id="lineCount">0</div>
          <div class="stat-label">Lines</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" id="charCount">0</div>
          <div class="stat-label">Characters</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" id="functionCount">0</div>
          <div class="stat-label">Functions</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" id="classCount">0</div>
          <div class="stat-label">Classes</div>
        </div>
      </div>

      <div class="button-group">
        <button id="createBtn" class="btn">
          <i class="fas fa-play"></i> Compile & Create
        </button>
        <button id="formatBtn" class="btn btn-secondary">
          <i class="fas fa-align-left"></i> Format Code
        </button>
        <button id="analyzeBtn" class="btn btn-outline">
          <i class="fas fa-chart-simple"></i> Analyze
        </button>
        <button id="clearBtn" class="btn btn-outline">
          <i class="fas fa-trash"></i> Clear
        </button>
      </div>

      <p style="margin-top: 2rem;">
        <a href="/decompile" class="btn-secondary btn">
          <i class="fas fa-microchip"></i> Decompile Binary
        </a>
      </p>
    </div>
  </div>

  <script>
    ${TOAST_JS}

    // Initialize CodeMirror
    const sourceTextarea = document.getElementById('source');
    const editor = document.getElementById('editor');
    const cm = CodeMirror(editor, {
      lineNumbers: true,
      mode: 'javascript',
      theme: 'dracula',
      value: localStorage.getItem('savedCode') || '',
      lineWrapping: true,
      indentUnit: 2,
      tabSize: 2,
      autoCloseBrackets: true,
      matchBrackets: true,
      extraKeys: {
        'Ctrl-S': function() {
          saveCode();
        },
        'Ctrl-Enter': function() {
          document.getElementById('createBtn').click();
        }
      }
    });

    // Auto-save to localStorage
    cm.on('change', function() {
      const code = cm.getValue();
      localStorage.setItem('savedCode', code);
      updateStats(code);
    });

    cm.on('cursorActivity', function() {
      const pos = cm.getCursor();
      document.getElementById('cursorPosition').textContent = 
        'Ln ' + (pos.line + 1) + ', Col ' + (pos.ch + 1);
    });

    function updateStats(code) {
      const lines = code.split('\\n').length;
      const chars = code.length;
      const functions = (code.match(/function\\s+\\w+\\s*\\(/g) || []).length;
      const classes = (code.match(/class\\s+\\w+/g) || []).length;
      
      document.getElementById('lineCount').textContent = lines;
      document.getElementById('charCount').textContent = chars;
      document.getElementById('functionCount').textContent = functions;
      document.getElementById('classCount').textContent = classes;
    }

    function saveCode() {
      const code = cm.getValue();
      localStorage.setItem('savedCode', code);
      showToast('Code saved to localStorage', 'success');
    }

    // Tab switching
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', function() {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        this.classList.add('active');
        
        const tabName = this.dataset.tab;
        document.querySelectorAll('.tab-content').forEach(content => {
          content.style.display = 'none';
        });
        document.getElementById(tabName + 'Tab').style.display = 'block';
      });
    });

    // Generate with AI
    document.getElementById('generateWithAI').addEventListener('click', async () => {
      const prompt = document.getElementById('aiPrompt').value;
      const type = document.getElementById('aiType').value;
      const complexity = document.getElementById('complexity').value;
      const aiResponse = document.getElementById('aiResponse');
      const btn = document.getElementById('generateWithAI');
      
      if (!prompt) {
        showToast('Please enter a prompt', 'warning');
        return;
      }

      btn.disabled = true;
      btn.innerHTML = 'Generating... <span class="spinner" style="display:inline-block;"></span>';
      aiResponse.style.display = 'none';

      try {
        const res = await fetch('/api/ai/compile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, type, complexity })
        });
        
        const data = await res.json();
        
        if (res.ok) {
          cm.setValue(data.sourceCode);
          showToast('Code generated successfully!');
          
          aiResponse.innerHTML = '<strong>✅ Generated Program</strong>' +
            '<p>Program ID: ' + data.programId + '</p>' +
            '<p>Lines: ' + data.stats.lines + ' | Functions: ' + data.stats.functions + ' | Classes: ' + data.stats.classes + '</p>' +
            '<a href="' + data.publicUrl + '" target="_blank" class="btn">View Public</a> ' +
            '<a href="' + data.adminUrl + '" target="_blank" class="btn btn-secondary">Admin</a>';
          aiResponse.style.display = 'block';
        } else {
          showToast('Error: ' + (data.details || data.error), 'error');
          if (data.generatedCode) {
            aiResponse.innerHTML = '<strong>⚠️ Generated Code (with errors):</strong>' +
              '<pre style="background:#1f1f1f; padding:1rem; border-radius:8px; margin-top:1rem; max-height:300px; overflow:auto;">' +
              escapeHtml(data.generatedCode) + '</pre>';
            aiResponse.style.display = 'block';
          }
        }
      } catch (err) {
        showToast('Network error: ' + err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-magic"></i> Generate with AI';
      }
    });

    // Enhance Compiler
    document.getElementById('enhanceCompiler').addEventListener('click', async () => {
      const prompt = document.getElementById('enhancePrompt').value;
      if (!prompt) {
        showToast('Please describe how to enhance the compiler', 'warning');
        return;
      }

      const btn = document.getElementById('enhanceCompiler');
      btn.disabled = true;
      btn.innerHTML = 'Enhancing... <span class="spinner" style="display:inline-block;"></span>';

      try {
        // Get current compiler source (in production, fetch from your server)
        const compilerRes = await fetch('/api/compiler/source');
        const sourceCode = await compilerRes.text();

        const res = await fetch('/api/ai/transform', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            prompt, 
            sourceCode,
            task: 'enhance'
          })
        });
        
        const data = await res.json();
        
        if (res.ok) {
          localStorage.setItem('enhancedCompiler', data.transformed);
          localStorage.setItem('compilerDate', new Date().toISOString());
          
          document.getElementById('compilerVersion').textContent = 'v1.0 (Enhanced)';
          document.getElementById('compilerPreview').textContent = data.transformed.substring(0, 1000) + '...';
          showModal('compilerModal');
          showToast('Compiler enhanced successfully!');
        } else {
          showToast('Error: ' + data.error, 'error');
          if (data.aiResponse) {
            const aiResponse = document.getElementById('aiResponse');
            aiResponse.innerHTML = '<strong>⚠️ AI Response (with errors):</strong>' +
              '<pre style="background:#1f1f1f; padding:1rem; border-radius:8px; margin-top:1rem; max-height:300px; overflow:auto;">' +
              escapeHtml(data.aiResponse) + '</pre>';
            aiResponse.style.display = 'block';
          }
        }
      } catch (err) {
        showToast('Network error: ' + err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-upgrade"></i> Enhance Compiler';
      }
    });

    // Debug Code
    document.getElementById('debugCode').addEventListener('click', async () => {
      const prompt = document.getElementById('debugPrompt').value;
      const code = cm.getValue();
      
      if (!code) {
        showToast('No code to debug', 'warning');
        return;
      }

      const btn = document.getElementById('debugCode');
      btn.disabled = true;
      btn.innerHTML = 'Debugging... <span class="spinner" style="display:inline-block;"></span>';

      try {
        const res = await fetch('/api/ai/transform', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            prompt: prompt || 'Fix any bugs or issues in this code',
            sourceCode: code,
            task: 'debug'
          })
        });
        
        const data = await res.json();
        
        if (res.ok) {
          cm.setValue(data.transformed);
          showToast('Code debugged successfully!');
        } else {
          showToast('Error: ' + data.error, 'error');
        }
      } catch (err) {
        showToast('Network error: ' + err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-bug"></i> Debug Code';
      }
    });

    // Optimize Code
    document.getElementById('optimizeCode').addEventListener('click', async () => {
      const prompt = document.getElementById('optimizePrompt').value;
      const code = cm.getValue();
      
      if (!code) {
        showToast('No code to optimize', 'warning');
        return;
      }

      const btn = document.getElementById('optimizeCode');
      btn.disabled = true;
      btn.innerHTML = 'Optimizing... <span class="spinner" style="display:inline-block;"></span>';

      try {
        const res = await fetch('/api/ai/transform', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            prompt: prompt || 'Optimize this code for performance',
            sourceCode: code,
            task: 'optimize'
          })
        });
        
        const data = await res.json();
        
        if (res.ok) {
          cm.setValue(data.transformed);
          showToast('Code optimized successfully!');
        } else {
          showToast('Error: ' + data.error, 'error');
        }
      } catch (err) {
        showToast('Network error: ' + err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-rocket"></i> Optimize';
      }
    });

    // Reset Compiler
    document.getElementById('resetCompiler').addEventListener('click', () => {
      localStorage.removeItem('enhancedCompiler');
      document.getElementById('compilerVersion').textContent = 'v1.0 (Default)';
      showToast('Compiler reset to default');
    });

    // Apply Compiler Changes
    document.getElementById('applyCompilerBtn').addEventListener('click', () => {
      const enhanced = localStorage.getItem('enhancedCompiler');
      if (enhanced) {
        // In a real implementation, you'd reload the compiler module
        showToast('Compiler updated! Reloading page...', 'success');
        setTimeout(() => location.reload(), 1500);
      }
    });

    // Download Compiler
    document.getElementById('downloadCompilerBtn').addEventListener('click', () => {
      const enhanced = localStorage.getItem('enhancedCompiler');
      if (enhanced) {
        downloadAsFile(enhanced, 'enhanced-compiler.js');
      }
    });

    // Show Examples
    document.getElementById('showExamples').addEventListener('click', () => {
      const examples = [
        '// Calculator with basic operations\nclass Calculator {\n  constructor() {\n    this.result = 0;\n  }\n  \n  add(x) { this.result += x; return this; }\n  subtract(x) { this.result -= x; return this; }\n  multiply(x) { this.result *= x; return this; }\n  divide(x) { this.result /= x; return this; }\n  \n  getResult() { return this.result; }\n}\n\n// Usage\nconst calc = new Calculator();\ncalc.add(10).subtract(3).multiply(4);\nconsole.log(calc.getResult());',
        
        '// Async data fetcher\nasync function fetchData(urls) {\n  try {\n    const promises = urls.map(async url => {\n      const response = await fetch(url);\n      if (!response.ok) throw new Error(\`HTTP \${response.status}\`);\n      return await response.json();\n    });\n    \n    return await Promise.all(promises);\n  } catch (error) {\n    console.error(\"Fetch failed:\", error);\n    return [];\n  }\n}',
        
        '// Event emitter class\nclass EventEmitter {\n  constructor() {\n    this.events = {};\n  }\n  \n  on(event, listener) {\n    if (!this.events[event]) this.events[event] = [];\n    this.events[event].push(listener);\n    return this;\n  }\n  \n  emit(event, ...args) {\n    if (this.events[event]) {\n      this.events[event].forEach(listener => listener(...args));\n    }\n    return this;\n  }\n  \n  off(event, listener) {\n    if (this.events[event]) {\n      this.events[event] = this.events[event].filter(l => l !== listener);\n    }\n    return this;\n  }\n}'
      ];
      
      const randomExample = examples[Math.floor(Math.random() * examples.length)];
      cm.setValue(randomExample);
      showToast('Example loaded!');
    });

    // Format Code
    document.getElementById('formatBtn').addEventListener('click', () => {
      try {
        const code = cm.getValue();
        // Simple formatting - in production use prettier
        const formatted = code
          .split('\\n')
          .map(line => line.trim())
          .join('\\n');
        cm.setValue(formatted);
        showToast('Code formatted');
      } catch (err) {
        showToast('Format failed: ' + err.message, 'error');
      }
    });

    // Analyze Code
    document.getElementById('analyzeBtn').addEventListener('click', () => {
      const code = cm.getValue();
      const stats = document.getElementById('statsContent');
      
      const lines = code.split('\\n').length;
      const chars = code.length;
      const functions = (code.match(/function\\s+\\w+\\s*\\(/g) || []).length;
      const classes = (code.match(/class\\s+\\w+/g) || []).length;
      const asyncs = (code.match(/async|await|Promise/g) || []).length;
      const comments = (code.match(/\\/\\/.*|\\/\\*[\\s\\S]*?\\*\\//g) || []).length;
      const loops = (code.match(/for\\s*\\(|while\\s*\\(/g) || []).length;
      
      stats.innerHTML = '<div class="stats-grid" style="grid-template-columns: repeat(2,1fr);">' +
        '<div class="stat-card"><div class="stat-value">' + lines + '</div><div class="stat-label">Lines</div></div>' +
        '<div class="stat-card"><div class="stat-value">' + chars + '</div><div class="stat-label">Characters</div></div>' +
        '<div class="stat-card"><div class="stat-value">' + functions + '</div><div class="stat-label">Functions</div></div>' +
        '<div class="stat-card"><div class="stat-value">' + classes + '</div><div class="stat-label">Classes</div></div>' +
        '<div class="stat-card"><div class="stat-value">' + asyncs + '</div><div class="stat-label">Async Ops</div></div>' +
        '<div class="stat-card"><div class="stat-value">' + comments + '</div><div class="stat-label">Comments</div></div>' +
        '<div class="stat-card"><div class="stat-value">' + loops + '</div><div class="stat-label">Loops</div></div>' +
        '</div>';
      
      showModal('statsModal');
    });

    // Clear Editor
    document.getElementById('clearBtn').addEventListener('click', () => {
      if (confirm('Clear all code? This cannot be undone.')) {
        cm.setValue('');
        localStorage.removeItem('savedCode');
        showToast('Editor cleared');
      }
    });

    // Create Program (existing functionality)
    document.getElementById('createBtn').addEventListener('click', async () => {
      const source = cm.getValue();
      const type = document.getElementById('type').value;
      const btn = document.getElementById('createBtn');
      const spinner = document.getElementById('spinner');
      
      if (!source) {
        showToast('Please enter source code', 'warning');
        return;
      }

      btn.disabled = true;
      spinner.style.display = 'inline-block';

      try {
        const res = await fetch('/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source, type })
        });
        const data = await res.json();
        if (res.ok) {
          showToast('Program created! Redirecting...');
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

    // Initial stats update
    updateStats(cm.getValue());

    // Load enhanced compiler version from localStorage
    if (localStorage.getItem('enhancedCompiler')) {
      document.getElementById('compilerVersion').textContent = 'v1.0 (Enhanced)';
    }

    // EscapeHtml function for safe display
    function escapeHtml(unsafe) {
      return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }
  </script>
</body>
</html>`;

// ==================== DECOMPILE FORM HTML ====================
const DECOMPILE_FORM_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>WEB_PROGRAMS – Decompile Binary</title>
  <style>${LAYOUT_CSS}</style>
</head>
<body>
  <div id="toast" class="toast"></div>
  <div class="card">
    <h1><i class="fas fa-microchip"></i> Decompile Binary</h1>
    <p>Paste your compiled binary (hex format) below.</p>
    <form id="decompileForm" method="POST" action="/decompile">
      <div class="editor-container">
        <textarea name="binary" id="binary" rows="10" cols="80" placeholder="e.g. 0x50424F330001000008000000..." style="width:100%; background:#0d1117; color:#c9d1d9; border:none; padding:1.5rem; font-family: 'JetBrains Mono', monospace; line-height: 1.5;"></textarea>
      </div>
      <div class="button-group">
        <button type="submit" class="btn" id="decompileBtn">
          <i class="fas fa-rotate-left"></i> Decompile
        </button>
        <a href="/" class="btn btn-outline">
          <i class="fas fa-arrow-left"></i> Back
        </a>
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
</html>`;

// ==================== PUBLIC VIEW HTML ====================
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
  <div class="container">
    <div class="card">
      <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 2rem;">
        <i class="fas fa-file-code" style="font-size: 2rem; color: var(--accent-secondary);"></i>
        <h1 style="margin: 0;">Program ${id.substring(0, 8)}...</h1>
      </div>
      <div class="meta">
        <div class="meta-item"><i class="far fa-calendar"></i> Created: ${new Date(program.created_at).toLocaleString()}</div>
        <div class="meta-item"><i class="far fa-clock"></i> Updated: ${new Date(program.updated_at).toLocaleString()}</div>
      </div>
      <h2>Source Code</h2>
      <div class="binary-panel" style="background: #0d1117;">
        <pre><code class="language-javascript">${escapeHtml(program.source_code)}</code></pre>
      </div>
      <p style="margin-top: 2rem;">
        <a href="/admin/${program.admin_token}" target="_blank" class="btn">
          <i class="fas fa-lock"></i> Admin Access
        </a>
        <a href="/" class="btn btn-outline">
          <i class="fas fa-home"></i> Home
        </a>
      </p>
      <script>hljs.highlightAll();</script>
    </div>
  </div>
</body>
</html>`;
}

// ==================== ADMIN VIEW HTML ====================
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
  <div class="container">
    <div class="card">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 2rem;">
        <div>
          <h1 style="margin: 0;"><i class="fas fa-pen-fancy"></i> Edit Program</h1>
          <p style="color: var(--text-tertiary);">ID: ${program.id}</p>
        </div>
        <a href="/" class="btn btn-outline">
          <i class="fas fa-home"></i> Home
        </a>
      </div>

      <div class="meta">
        <div class="meta-item"><i class="far fa-calendar"></i> Created: ${new Date(program.created_at).toLocaleString()}</div>
        <div class="meta-item"><i class="far fa-clock"></i> Updated: ${new Date(program.updated_at).toLocaleString()}</div>
      </div>

      <textarea id="source-textarea" style="display:none;">${escapeHtml(program.source_code)}</textarea>
      <div class="editor-container">
        <div id="editor"></div>
      </div>

      <div class="stats-grid" style="margin: 1rem 0;">
        <div class="stat-card"><div class="stat-value" id="lineCount">0</div><div class="stat-label">Lines</div></div>
        <div class="stat-card"><div class="stat-value" id="charCount">0</div><div class="stat-label">Chars</div></div>
      </div>

      <div class="button-group">
        <button id="saveBtn" class="btn">
          <i class="fas fa-save"></i> Save & Recompile
        </button>
        <button id="viewBinaryBtn" class="btn btn-secondary">
          <i class="fas fa-eye"></i> View Binary
        </button>
        <button id="copyBinaryBtn" class="btn btn-outline">
          <i class="fas fa-copy"></i> Copy Binary
        </button>
        <div id="spinner" class="spinner" style="display:none;"></div>
      </div>

      <div id="binary-panel" class="binary-panel" style="display:none; margin-top: 1rem;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
          <span><i class="fas fa-binary"></i> Binary (hex)</span>
          <button class="btn btn-outline btn-small" onclick="copyBinary()">Copy</button>
        </div>
        <div id="binaryContent" style="font-family: 'JetBrains Mono', monospace; white-space: pre;"></div>
      </div>
    </div>
  </div>

  <script>
    ${TOAST_JS}
    const sourceTextarea = document.getElementById('source-textarea');
    const cm = CodeMirror(document.getElementById('editor'), {
      lineNumbers: true,
      mode: 'javascript',
      theme: 'dracula',
      value: sourceTextarea.value,
      lineWrapping: true,
      indentUnit: 2,
      tabSize: 2
    });

    function updateStats() {
      const code = cm.getValue();
      document.getElementById('lineCount').textContent = code.split('\\n').length;
      document.getElementById('charCount').textContent = code.length;
    }
    
    cm.on('change', updateStats);
    updateStats();

    const saveBtn = document.getElementById('saveBtn');
    const spinner = document.getElementById('spinner');
    const binaryPanel = document.getElementById('binary-panel');
    const binaryContent = document.getElementById('binaryContent');

    async function fetchBinary() {
      const res = await fetch(window.location.href + '/binary');
      if (res.ok) {
        const hex = await res.text();
        binaryContent.textContent = formatHex(hex);
        binaryPanel.style.display = 'block';
      } else {
        showToast('Could not load binary', 'error');
      }
    }

    function formatHex(hexString) {
      const hex = hexString.startsWith('0x') ? hexString.slice(2) : hexString.replace(/\\\\x/g, '');
      const pairs = hex.match(/.{1,2}/g) || [];
      const lines = [];
      for (let i = 0; i < pairs.length; i += 16) {
        lines.push(pairs.slice(i, i + 16).join(' '));
      }
      return lines.join('\\n');
    }

    window.copyBinary = function() {
      navigator.clipboard.writeText(binaryContent.textContent).then(() => {
        showToast('Binary copied!');
      });
    };

    document.getElementById('viewBinaryBtn').addEventListener('click', fetchBinary);
    
    document.getElementById('copyBinaryBtn').addEventListener('click', () => {
      if (binaryContent.textContent) {
        copyBinary();
      } else {
        fetchBinary().then(copyBinary);
      }
    });

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

// ==================== DECOMPILE RESULT HTML ====================
function decompileResultHTML(hexInput) {
  try {
    const { magic, version, flags, entry, dataSize, codeSize, constants, disassembly } = disassembleBinary(hexInput);
    
    const disasmHtml = disassembly.map(line => {
      const bytes = line.bytes.padEnd(20);
      const operands = line.operands.map(op => {
        if (op.type === 'const') {
          return `[${op.value}: ${JSON.stringify(op.resolved?.value)}]`;
        } else if (op.type === 'offset') {
          return `→0x${op.target.toString(16).padStart(4, '0')}`;
        } else {
          return op.value;
        }
      }).join(' ');
      
      return `<div class="disasm-line">
        <span class="hex-address">0x${line.address.toString(16).padStart(4, '0')}</span>
        <span class="hex-bytes">${bytes}</span>
        <span class="opcode">${line.mnemonic}</span>
        <span class="data"> ${operands}</span>
      </div>`;
    }).join('');

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Decompiled Program</title>
  <style>${LAYOUT_CSS}</style>
  <style>
    .disasm-line { 
      font-family: 'JetBrains Mono', monospace; 
      white-space: pre; 
      padding: 4px 8px;
      border-bottom: 1px solid #2d2d2d;
    }
    .disasm-line:hover { background: #1e1e1e; }
    .hex-address { color: #79c0ff; margin-right: 1rem; }
    .hex-bytes { color: #7ee787; margin-right: 2rem; }
    .opcode { color: #ff7b72; font-weight: bold; margin-right: 1rem; }
    .data { color: #d2a8ff; }
    .section-header {
      cursor: pointer;
      user-select: none;
      padding: 0.75rem 1rem;
      background: #1f1f1f;
      border-radius: 8px;
      margin: 1rem 0 0.5rem;
      display: inline-block;
    }
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
      padding: 0.75rem;
      text-align: left;
    }
    .constants-table td {
      padding: 0.5rem 0.75rem;
      border-bottom: 1px solid #2d2d2d;
      font-family: 'JetBrains Mono', monospace;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div style="display: flex; align-items: center; justify-content: space-between;">
        <h1><i class="fas fa-microchip"></i> Program Disassembly</h1>
        <span class="badge">${magic} v${version}</span>
      </div>

      <div class="stats-grid">
        <div class="stat-card"><div class="stat-value">0x${entry.toString(16)}</div><div class="stat-label">Entry Point</div></div>
        <div class="stat-card"><div class="stat-value">${dataSize}</div><div class="stat-label">Data Bytes</div></div>
        <div class="stat-card"><div class="stat-value">${codeSize}</div><div class="stat-label">Code Bytes</div></div>
        <div class="stat-card"><div class="stat-value">${constants.length}</div><div class="stat-label">Constants</div></div>
      </div>

      <div class="section-header" onclick="toggleSection('constants')">Constants (${constants.length})</div>
      <div id="constants" class="section-content">
        <table class="constants-table">
          <thead><tr><th>Index</th><th>Type</th><th>Value</th></tr></thead>
          <tbody>
            ${constants.map((c, idx) => {
              const typeMap = {1:'String',2:'Number',3:'Integer',4:'Boolean',5:'Null',6:'BigInt',7:'Array',8:'Object'};
              const typeName = typeMap[c.type] || 'Unknown';
              const value = typeof c.value === 'string' ? escapeHtml(c.value) : JSON.stringify(c.value);
              return `<tr><td>${idx}</td><td>${typeName}</td><td>${value}</td></tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>

      <div class="section-header" onclick="toggleSection('disasm')">Disassembly (${disassembly.length} instructions)</div>
      <div id="disasm" class="section-content">
        <div class="binary-panel" style="max-height: 500px; overflow-y: auto;">
          ${disasmHtml}
        </div>
      </div>

      <div class="button-group" style="margin-top: 2rem;">
        <a href="/decompile" class="btn">
          <i class="fas fa-rotate-left"></i> Decompile Another
        </a>
        <a href="/" class="btn btn-outline">
          <i class="fas fa-home"></i> Home
        </a>
      </div>
    </div>
  </div>

  <script>
    function toggleSection(id) {
      const el = document.getElementById(id);
      const header = event.currentTarget;
      el.classList.toggle('collapsed');
      header.classList.toggle('collapsed');
    }
    document.getElementById('constants').classList.add('collapsed');
    document.querySelector('.section-header').classList.add('collapsed');
  </script>
</body>
</html>`;
  } catch (err) {
    return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Error</title><style>${LAYOUT_CSS}</style></head>
<body><div class="container"><div class="card"><h1><i class="fas fa-exclamation-triangle" style="color: #f85149;"></i> Decompilation Failed</h1><p>${escapeHtml(err.message)}</p><a href="/decompile" class="btn"><i class="fas fa-rotate-left"></i> Try Again</a></div></div></body>
</html>`;
  }
}

// ==================== WORKER ====================
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

    // AI Endpoints
    if (request.method === 'POST' && path === '/api/ai/transform') {
      return handleAITransform(request, env);
    }

    if (request.method === 'POST' && path === '/api/ai/compile') {
      return handleAIAssistedCompile(request, env);
    }

    if (request.method === 'GET' && path === '/api/compiler/source') {
      // In production, fetch from KV or return default
      const defaultCompiler = '// Default compiler source would be here';
      return new Response(defaultCompiler, {
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    // CREATE PROGRAM
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
        const insertRes = await supabaseRequest(env, 'programs', {
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

    // PUBLIC VIEW
    const publicMatch = path.match(/^\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
    if (request.method === 'GET' && publicMatch) {
      const id = publicMatch[1];
      try {
        const res = await supabaseRequest(env, `programs?id=eq.${id}&select=source_code,created_at,updated_at,admin_token`);
        const data = await res.json();
        if (!data.length) return new Response('Not found', { status: 404 });
        const program = data[0];
        const html = publicViewHTML(id, program);
        return new Response(html, { headers: { 'Content-Type': 'text/html' } });
      } catch (err) {
        return new Response('Error: ' + err.message, { status: 500 });
      }
    }

    // ADMIN VIEW
    const adminMatch = path.match(/^\/admin\/([A-Za-z0-9_-]+)$/);
    if (request.method === 'GET' && adminMatch && !path.endsWith('/binary')) {
      const token = adminMatch[1];
      try {
        const res = await supabaseRequest(env, `programs?admin_token=eq.${token}&select=id,source_code,created_at,updated_at`);
        const data = await res.json();
        if (!data.length) return new Response('Not found', { status: 404 });
        const program = data[0];
        const html = adminViewHTML(program);
        return new Response(html, { headers: { 'Content-Type': 'text/html' } });
      } catch (err) {
        return new Response('Error: ' + err.message, { status: 500 });
      }
    }

    // ADMIN UPDATE
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
        await supabaseRequest(env, `programs?admin_token=eq.${token}`, {
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

    // GET BINARY HEX
    if (request.method === 'GET' && path.match(/^\/admin\/[A-Za-z0-9_-]+\/binary$/)) {
      const token = path.split('/')[2];
      try {
        const res = await supabaseRequest(env, `programs?admin_token=eq.${token}&select=binary`);
        const data = await res.json();
        if (!data.length) return new Response('Not found', { status: 404 });
        const binaryHex = data[0].binary;
        return new Response(binaryHex, { headers: { 'Content-Type': 'text/plain' } });
      } catch (err) {
        return new Response('Error: ' + err.message, { status: 500 });
      }
    }

    // DECOMPILE FORM
    if (request.method === 'GET' && path === '/decompile') {
      return new Response(DECOMPILE_FORM_HTML, { headers: { 'Content-Type': 'text/html' } });
    }

    // DECOMPILE RESULT
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
        binaryHex = await request.text();
      }
      if (!binaryHex.trim()) {
        return new Response('Missing binary input', { status: 400 });
      }
      const html = decompileResultHTML(binaryHex);
      return new Response(html, { headers: { 'Content-Type': 'text/html' } });
    }

    // ROOT
    if (request.method === 'GET' && path === '/') {
      return new Response(ROOT_HTML, { headers: { 'Content-Type': 'text/html' } });
    }

    return new Response('Not found', { status: 404 });
  },
};
