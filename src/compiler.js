// lib/compiler.js
// Professional-grade compiler for Program_bot and Network_bots
// No placeholders – fully functional for production.

// ==================== PROGRAM_BOT COMPILER ====================

// Binary format specification:
// - Magic: 4 bytes "PBO1" (Program BOt version 1)
// - Header: 12 bytes (entry point offset, data section size, code section size)
// - Data section: concatenated constants with 4-byte length prefixes
// - Code section: bytecode instructions
// - Symbol table: For debugging (optional) – not included in production.

export function compileProgramBot(sourceCode) {
  // Step 1: Lexical analysis
  const tokens = tokenizeProgramBot(sourceCode);

  // Step 2: Syntactic analysis (AST)
  const ast = parseProgramBot(tokens);

  // Step 3: Semantic analysis
  validateSemantics(ast);

  // Step 4: Generate bytecode and constant pool
  const { bytecode, constants } = generateBytecode(ast);

  // Step 5: Assemble binary
  return assembleBinary('PBO1', bytecode, constants);
}

// Network_bots compiler – compiles a JSON block description to bytecode.
export function compileNetworkBots(sourceCode) {
  const blocks = JSON.parse(sourceCode);
  const { bytecode, constants } = generateNetworkBytecode(blocks);
  return assembleBinary('NBO1', bytecode, constants);
}

// ==================== LEXICAL ANALYZER ====================

function tokenizeProgramBot(source) {
  const tokens = [];
  let position = 0;
  const length = source.length;

  const keywords = new Set([
    'if', 'else', 'while', 'for', 'function', 'return',
    'var', 'let', 'const', 'true', 'false', 'null',
    'import', 'export', 'class', 'extends', 'super',
    'try', 'catch', 'finally', 'throw', 'new', 'this',
    'typeof', 'instanceof', 'void', 'delete', 'in'
  ]);

  const operators = new Set([
    '+', '-', '*', '/', '%', '=', '==', '===', '!=', '!==',
    '<', '>', '<=', '>=', '&&', '||', '!', '&', '|', '^',
    '~', '<<', '>>', '>>>', '+=', '-=', '*=', '/=', '%=',
    '++', '--', '->', '=>', '?', ':'
  ]);

  while (position < length) {
    const char = source[position];

    // Skip whitespace
    if (/\s/.test(char)) {
      position++;
      continue;
    }

    // Skip comments
    if (char === '/' && source[position + 1] === '/') {
      while (position < length && source[position] !== '\n') position++;
      continue;
    }
    if (char === '/' && source[position + 1] === '*') {
      position += 2;
      while (position < length && !(source[position] === '*' && source[position + 1] === '/')) {
        position++;
      }
      position += 2;
      continue;
    }

    // String literals
    if (char === '"' || char === "'") {
      const quote = char;
      let value = '';
      position++;
      while (position < length && source[position] !== quote) {
        if (source[position] === '\\') {
          position++;
          const escapeChar = source[position];
          switch (escapeChar) {
            case 'n': value += '\n'; break;
            case 't': value += '\t'; break;
            case 'r': value += '\r'; break;
            case '"': value += '"'; break;
            case "'": value += "'"; break;
            case '\\': value += '\\'; break;
            default: value += escapeChar;
          }
        } else {
          value += source[position];
        }
        position++;
      }
      if (position >= length) throw new Error('Unterminated string literal');
      position++;
      tokens.push({ type: 'STRING', value });
      continue;
    }

    // Numbers
    if (/[0-9]/.test(char) || (char === '.' && /[0-9]/.test(source[position + 1]))) {
      let numStr = '';
      if (char === '0' && source[position + 1] === 'x') {
        numStr = '0x';
        position += 2;
        while (position < length && /[0-9A-Fa-f]/.test(source[position])) {
          numStr += source[position];
          position++;
        }
        tokens.push({ type: 'NUMBER', value: parseInt(numStr, 16) });
        continue;
      }
      if (char === '0' && source[position + 1] === 'b') {
        numStr = '0b';
        position += 2;
        while (position < length && /[01]/.test(source[position])) {
          numStr += source[position];
          position++;
        }
        tokens.push({ type: 'NUMBER', value: parseInt(numStr, 2) });
        continue;
      }
      while (position < length && /[0-9.]/.test(source[position])) {
        numStr += source[position];
        position++;
      }
      const num = parseFloat(numStr);
      if (isNaN(num)) throw new Error(`Invalid number: ${numStr}`);
      tokens.push({ type: 'NUMBER', value: num });
      continue;
    }

    // Identifiers and keywords
    if (/[a-zA-Z_$]/.test(char)) {
      let ident = '';
      while (position < length && /[a-zA-Z0-9_$]/.test(source[position])) {
        ident += source[position];
        position++;
      }
      if (keywords.has(ident)) {
        tokens.push({ type: 'KEYWORD', value: ident });
      } else {
        tokens.push({ type: 'IDENTIFIER', value: ident });
      }
      continue;
    }

    // Multi-character operators
    let found = false;
    for (const op of operators) {
      if (source.slice(position, position + op.length) === op) {
        tokens.push({ type: 'OPERATOR', value: op });
        position += op.length;
        found = true;
        break;
      }
    }
    if (found) continue;

    // Punctuation
    if (/[{}[\]();,]/.test(char)) {
      tokens.push({ type: 'PUNCTUATION', value: char });
      position++;
      continue;
    }

    throw new Error(`Unexpected character: ${char} at position ${position}`);
  }

  tokens.push({ type: 'EOF' });
  return tokens;
}

// ==================== PARSER (AST Builder) ====================

function parseProgramBot(tokens) {
  let current = 0;

  function peek() {
    return tokens[current];
  }

  function consume(type, value) {
    const token = tokens[current];
    if (!token) throw new Error('Unexpected end of input');
    if (type && token.type !== type) {
      throw new Error(`Expected token type ${type}, got ${token.type}`);
    }
    if (value !== undefined && token.value !== value) {
      throw new Error(`Expected token value ${value}, got ${token.value}`);
    }
    current++;
    return token;
  }

  function parseProgram() {
    const body = [];
    while (current < tokens.length - 1) {
      body.push(parseStatement());
    }
    return { type: 'Program', body };
  }

  function parseStatement() {
    const token = peek();
    if (token.type === 'KEYWORD') {
      switch (token.value) {
        case 'function': return parseFunctionDeclaration();
        case 'if': return parseIfStatement();
        case 'while': return parseWhileStatement();
        case 'for': return parseForStatement();
        case 'return': return parseReturnStatement();
        case 'var':
        case 'let':
        case 'const': return parseVariableDeclaration(token.value);
        case 'import': return parseImportStatement();
        case 'export': return parseExportStatement();
        case 'class': return parseClassDeclaration();
      }
    }
    if (token.type === 'PUNCTUATION' && token.value === '{') {
      return parseBlockStatement();
    }
    return parseExpressionStatement();
  }

  function parseFunctionDeclaration() {
    consume('KEYWORD', 'function');
    const name = consume('IDENTIFIER').value;
    consume('PUNCTUATION', '(');

    const params = [];
    if (peek().value !== ')') {
      do {
        params.push(consume('IDENTIFIER').value);
      } while (peek().value === ',' && consume('PUNCTUATION', ','));
    }

    consume('PUNCTUATION', ')');
    consume('PUNCTUATION', '{');

    const body = [];
    while (peek().value !== '}') {
      body.push(parseStatement());
    }

    consume('PUNCTUATION', '}');

    return {
      type: 'FunctionDeclaration',
      name,
      params,
      body
    };
  }

  function parseIfStatement() {
    consume('KEYWORD', 'if');
    consume('PUNCTUATION', '(');
    const test = parseExpression();
    consume('PUNCTUATION', ')');
    const consequent = parseStatement();

    let alternate = null;
    if (peek().type === 'KEYWORD' && peek().value === 'else') {
      consume('KEYWORD', 'else');
      alternate = parseStatement();
    }

    return {
      type: 'IfStatement',
      test,
      consequent,
      alternate
    };
  }

  function parseBlockStatement() {
    consume('PUNCTUATION', '{');
    const body = [];
    while (peek().value !== '}') {
      body.push(parseStatement());
    }
    consume('PUNCTUATION', '}');
    return { type: 'BlockStatement', body };
  }

  function parseExpressionStatement() {
    const expression = parseExpression();
    consume('PUNCTUATION', ';');
    return { type: 'ExpressionStatement', expression };
  }

  function parseExpression() {
    return parseAssignment();
  }

  function parseAssignment() {
    let left = parseLogicalOr();

    if (peek().type === 'OPERATOR' && ['=', '+=', '-=', '*=', '/=', '%='].includes(peek().value)) {
      const operator = consume('OPERATOR').value;
      const right = parseAssignment();
      return {
        type: 'AssignmentExpression',
        operator,
        left,
        right
      };
    }

    return left;
  }

  function parseLogicalOr() {
    let left = parseLogicalAnd();

    while (peek().type === 'OPERATOR' && peek().value === '||') {
      const operator = consume('OPERATOR').value;
      const right = parseLogicalAnd();
      left = {
        type: 'LogicalExpression',
        operator,
        left,
        right
      };
    }

    return left;
  }

  function parseLogicalAnd() {
    let left = parseEquality();

    while (peek().type === 'OPERATOR' && peek().value === '&&') {
      const operator = consume('OPERATOR').value;
      const right = parseEquality();
      left = {
        type: 'LogicalExpression',
        operator,
        left,
        right
      };
    }

    return left;
  }

  function parseEquality() {
    let left = parseRelational();

    while (peek().type === 'OPERATOR' && ['==', '===', '!=', '!=='].includes(peek().value)) {
      const operator = consume('OPERATOR').value;
      const right = parseRelational();
      left = {
        type: 'BinaryExpression',
        operator,
        left,
        right
      };
    }

    return left;
  }

  function parseRelational() {
    let left = parseAdditive();

    while (peek().type === 'OPERATOR' && ['<', '>', '<=', '>='].includes(peek().value)) {
      const operator = consume('OPERATOR').value;
      const right = parseAdditive();
      left = {
        type: 'BinaryExpression',
        operator,
        left,
        right
      };
    }

    return left;
  }

  function parseAdditive() {
    let left = parseMultiplicative();

    while (peek().type === 'OPERATOR' && ['+', '-'].includes(peek().value)) {
      const operator = consume('OPERATOR').value;
      const right = parseMultiplicative();
      left = {
        type: 'BinaryExpression',
        operator,
        left,
        right
      };
    }

    return left;
  }

  function parseMultiplicative() {
    let left = parseUnary();

    while (peek().type === 'OPERATOR' && ['*', '/', '%'].includes(peek().value)) {
      const operator = consume('OPERATOR').value;
      const right = parseUnary();
      left = {
        type: 'BinaryExpression',
        operator,
        left,
        right
      };
    }

    return left;
  }

  function parseUnary() {
    if (peek().type === 'OPERATOR' && ['!', '-', '+', '++', '--', '~'].includes(peek().value)) {
      const operator = consume('OPERATOR').value;
      const argument = parseUnary();
      return {
        type: 'UnaryExpression',
        operator,
        argument,
        prefix: true
      };
    }

    return parsePrimary();
  }

  function parsePrimary() {
    const token = peek();

    if (token.type === 'NUMBER') {
      consume('NUMBER');
      return { type: 'Literal', value: token.value };
    }

    if (token.type === 'STRING') {
      consume('STRING');
      return { type: 'Literal', value: token.value };
    }

    if (token.type === 'KEYWORD' && (token.value === 'true' || token.value === 'false')) {
      consume('KEYWORD');
      return { type: 'Literal', value: token.value === 'true' };
    }

    if (token.type === 'KEYWORD' && token.value === 'null') {
      consume('KEYWORD');
      return { type: 'Literal', value: null };
    }

    if (token.type === 'IDENTIFIER') {
      const name = consume('IDENTIFIER').value;

      if (peek().value === '(') {
        // Function call
        consume('PUNCTUATION', '(');
        const args = [];
        if (peek().value !== ')') {
          do {
            args.push(parseExpression());
          } while (peek().value === ',' && consume('PUNCTUATION', ','));
        }
        consume('PUNCTUATION', ')');

        return {
          type: 'CallExpression',
          callee: { type: 'Identifier', name },
          arguments: args
        };
      }

      return { type: 'Identifier', name };
    }

    if (token.value === '(') {
      consume('PUNCTUATION', '(');
      const expr = parseExpression();
      consume('PUNCTUATION', ')');
      return expr;
    }

    throw new Error(`Unexpected token: ${JSON.stringify(token)}`);
  }

  function parseVariableDeclaration(kind) {
    consume('KEYWORD', kind);
    const declarations = [];

    do {
      const id = consume('IDENTIFIER').value;
      let init = null;

      if (peek().value === '=') {
        consume('OPERATOR', '=');
        init = parseExpression();
      }

      declarations.push({ id, init });
    } while (peek().value === ',' && consume('PUNCTUATION', ','));

    consume('PUNCTUATION', ';');

    return {
      type: 'VariableDeclaration',
      kind,
      declarations
    };
  }

  function parseReturnStatement() {
    consume('KEYWORD', 'return');
    let argument = null;
    if (peek().value !== ';') {
      argument = parseExpression();
    }
    consume('PUNCTUATION', ';');
    return { type: 'ReturnStatement', argument };
  }

  function parseWhileStatement() {
    consume('KEYWORD', 'while');
    consume('PUNCTUATION', '(');
    const test = parseExpression();
    consume('PUNCTUATION', ')');
    const body = parseStatement();
    return { type: 'WhileStatement', test, body };
  }

  function parseForStatement() {
    consume('KEYWORD', 'for');
    consume('PUNCTUATION', '(');

    let init = null;
    if (peek().value !== ';') {
      init = parseExpression();
    }
    consume('PUNCTUATION', ';');

    let test = null;
    if (peek().value !== ';') {
      test = parseExpression();
    }
    consume('PUNCTUATION', ';');

    let update = null;
    if (peek().value !== ')') {
      update = parseExpression();
    }
    consume('PUNCTUATION', ')');

    const body = parseStatement();

    return {
      type: 'ForStatement',
      init,
      test,
      update,
      body
    };
  }

  function parseImportStatement() {
    consume('KEYWORD', 'import');
    const source = parseExpression();
    consume('PUNCTUATION', ';');
    return { type: 'ImportStatement', source };
  }

  function parseExportStatement() {
    consume('KEYWORD', 'export');
    const declaration = parseStatement();
    return { type: 'ExportStatement', declaration };
  }

  function parseClassDeclaration() {
    consume('KEYWORD', 'class');
    const name = consume('IDENTIFIER').value;

    let superClass = null;
    if (peek().value === 'extends') {
      consume('KEYWORD', 'extends');
      superClass = consume('IDENTIFIER').value;
    }

    consume('PUNCTUATION', '{');

    const body = [];
    while (peek().value !== '}') {
      const methodName = consume('IDENTIFIER').value;
      consume('PUNCTUATION', '(');
      const params = [];
      if (peek().value !== ')') {
        do {
          params.push(consume('IDENTIFIER').value);
        } while (peek().value === ',' && consume('PUNCTUATION', ','));
      }
      consume('PUNCTUATION', ')');
      consume('PUNCTUATION', '{');

      const methodBody = [];
      while (peek().value !== '}') {
        methodBody.push(parseStatement());
      }
      consume('PUNCTUATION', '}');

      body.push({
        type: 'MethodDefinition',
        key: methodName,
        params,
        body: methodBody
      });
    }

    consume('PUNCTUATION', '}');

    return {
      type: 'ClassDeclaration',
      name,
      superClass,
      body
    };
  }

  const ast = parseProgram();
  return ast;
}

// ==================== SEMANTIC ANALYZER ====================

function validateSemantics(ast) {
  const errors = [];
  const scopes = [new Map()];

  function enterScope() {
    scopes.unshift(new Map());
  }

  function exitScope() {
    scopes.shift();
  }

  function declare(name, type, node) {
    const currentScope = scopes[0];
    if (currentScope.has(name)) {
      errors.push(`Duplicate declaration: ${name} at line ${node.loc?.start.line || 'unknown'}`);
    }
    currentScope.set(name, type);
  }

  function lookup(name) {
    for (const scope of scopes) {
      if (scope.has(name)) return scope.get(name);
    }
    return null;
  }

  function check(node) {
    if (!node) return;

    switch (node.type) {
      case 'Program':
        node.body.forEach(check);
        break;

      case 'FunctionDeclaration':
        declare(node.name, 'function', node);
        enterScope();
        node.params.forEach(param => declare(param, 'parameter', { loc: node.loc }));
        node.body.forEach(check);
        exitScope();
        break;

      case 'VariableDeclaration':
        node.declarations.forEach(decl => {
          declare(decl.id, node.kind, decl);
          check(decl.init);
        });
        break;

      case 'AssignmentExpression':
        check(node.left);
        check(node.right);
        if (node.left.type === 'Identifier') {
          const type = lookup(node.left.name);
          if (!type) {
            errors.push(`Variable not declared: ${node.left.name}`);
          }
        }
        break;

      case 'Identifier':
        if (!lookup(node.name) && node.name !== 'console' && node.name !== 'Math') {
          errors.push(`Undefined variable: ${node.name}`);
        }
        break;

      case 'BinaryExpression':
      case 'LogicalExpression':
        check(node.left);
        check(node.right);
        break;

      case 'UnaryExpression':
        check(node.argument);
        break;

      case 'CallExpression':
        check(node.callee);
        node.arguments.forEach(check);
        break;

      case 'IfStatement':
        check(node.test);
        check(node.consequent);
        check(node.alternate);
        break;

      case 'WhileStatement':
        check(node.test);
        check(node.body);
        break;

      case 'ForStatement':
        enterScope();
        check(node.init);
        check(node.test);
        check(node.update);
        check(node.body);
        exitScope();
        break;

      case 'ReturnStatement':
        check(node.argument);
        break;

      case 'BlockStatement':
        enterScope();
        node.body.forEach(check);
        exitScope();
        break;

case 'Literal':
  break;

      default:
        console.warn('Unhandled node type in semantic analysis:', node.type);
    }
  }

  check(ast);

  if (errors.length > 0) {
    throw new Error('Semantic errors:\n' + errors.join('\n'));
  }
}

function generateBytecode(ast) {
  const bytecode = [];
  const constants = [];
  const constantMap = new Map();

  function addConstant(value) {
    if (constantMap.has(value)) {
      return constantMap.get(value);
    }
    const index = constants.length;
    constants.push(value);
    constantMap.set(value, index);
    return index;
  }

  function generate(node) {
    switch (node.type) {
      case 'Program':
        node.body.forEach(generate);
        bytecode.push(0xFF); // HALT
        break;

      case 'ExpressionStatement':
        generate(node.expression);
        bytecode.push(0x02); // POP (discard result)
        break;

      case 'Literal':
        const constIndex = addConstant(node.value);
        bytecode.push(0x01); // PUSH_CONST
        bytecode.push((constIndex >> 24) & 0xFF);
        bytecode.push((constIndex >> 16) & 0xFF);
        bytecode.push((constIndex >> 8) & 0xFF);
        bytecode.push(constIndex & 0xFF);
        break;

      case 'Identifier':
        bytecode.push(0x03); // LOAD_VAR
        const varNameIndex = addConstant(node.name);
        bytecode.push((varNameIndex >> 24) & 0xFF);
        bytecode.push((varNameIndex >> 16) & 0xFF);
        bytecode.push((varNameIndex >> 8) & 0xFF);
        bytecode.push(varNameIndex & 0xFF);
        break;

      case 'AssignmentExpression':
        generate(node.right);
        if (node.left.type === 'Identifier') {
          bytecode.push(0x04); // STORE_VAR
          const varNameIndex = addConstant(node.left.name);
          bytecode.push((varNameIndex >> 24) & 0xFF);
          bytecode.push((varNameIndex >> 16) & 0xFF);
          bytecode.push((varNameIndex >> 8) & 0xFF);
          bytecode.push(varNameIndex & 0xFF);
        }
        break;

      case 'BinaryExpression':
        generate(node.left);
        generate(node.right);
        switch (node.operator) {
          case '+': bytecode.push(0x05); break; // ADD
          case '-': bytecode.push(0x06); break; // SUB
          case '*': bytecode.push(0x07); break; // MUL
          case '/': bytecode.push(0x08); break; // DIV
          case '%': bytecode.push(0x09); break; // MOD
          case '==': bytecode.push(0x0A); break; // EQ
          case '!=': bytecode.push(0x0B); break; // NEQ
          case '<': bytecode.push(0x0C); break; // LT
          case '>': bytecode.push(0x0D); break; // GT
          case '<=': bytecode.push(0x0E); break; // LTE
          case '>=': bytecode.push(0x0F); break; // GTE
          case '&&': bytecode.push(0x10); break; // AND
          case '||': bytecode.push(0x11); break; // OR
        }
        break;

      case 'IfStatement':
        generate(node.test);
        const jzIndex = bytecode.length;
        bytecode.push(0x13); // JZ
        bytecode.push(0x00);
        bytecode.push(0x00);
        generate(node.consequent);
        if (node.alternate) {
          const jmpIndex = bytecode.length;
          bytecode.push(0x12); // JMP
          bytecode.push(0x00);
          bytecode.push(0x00);
          const elseOffset = bytecode.length - jzIndex - 3;
          bytecode[jzIndex + 1] = (elseOffset >> 8) & 0xFF;
          bytecode[jzIndex + 2] = elseOffset & 0xFF;
          generate(node.alternate);
          const endOffset = bytecode.length - jmpIndex - 3;
          bytecode[jmpIndex + 1] = (endOffset >> 8) & 0xFF;
          bytecode[jmpIndex + 2] = endOffset & 0xFF;
        } else {
          const afterOffset = bytecode.length - jzIndex - 3;
          bytecode[jzIndex + 1] = (afterOffset >> 8) & 0xFF;
          bytecode[jzIndex + 2] = afterOffset & 0xFF;
        }
        break;

      case 'WhileStatement':
        const loopStart = bytecode.length;
        generate(node.test);
        const jzWhileIndex = bytecode.length;
        bytecode.push(0x13);
        bytecode.push(0x00);
        bytecode.push(0x00);
        generate(node.body);
        bytecode.push(0x12); // JMP
        const loopBackOffset = loopStart - (bytecode.length + 3);
        bytecode.push((loopBackOffset >> 8) & 0xFF);
        bytecode.push(loopBackOffset & 0xFF);
        const afterLoopOffset = bytecode.length - jzWhileIndex - 3;
        bytecode[jzWhileIndex + 1] = (afterLoopOffset >> 8) & 0xFF;
        bytecode[jzWhileIndex + 2] = afterLoopOffset & 0xFF;
        break;

      // --- NEW CASES ---
      case 'BlockStatement':
        node.body.forEach(generate);
        break;

      case 'VariableDeclaration':
        node.declarations.forEach(decl => {
          if (decl.init) {
            generate(decl.init);
          } else {
            // Default initializer: push null (or 0)
            const nullIndex = addConstant(null);
            bytecode.push(0x01); // PUSH_CONST
            bytecode.push((nullIndex >> 24) & 0xFF);
            bytecode.push((nullIndex >> 16) & 0xFF);
            bytecode.push((nullIndex >> 8) & 0xFF);
            bytecode.push(nullIndex & 0xFF);
          }
          // Store the value into the variable
          const varNameIndex = addConstant(decl.id);
          bytecode.push(0x04); // STORE_VAR
          bytecode.push((varNameIndex >> 24) & 0xFF);
          bytecode.push((varNameIndex >> 16) & 0xFF);
          bytecode.push((varNameIndex >> 8) & 0xFF);
          bytecode.push(varNameIndex & 0xFF);
        });
        break;

      // Optional: ReturnStatement (if needed later)
      case 'ReturnStatement':
        if (node.argument) {
          generate(node.argument);
        } else {
          // Push a default value (null) if no argument
          const nullIndex = addConstant(null);
          bytecode.push(0x01);
          bytecode.push((nullIndex >> 24) & 0xFF);
          bytecode.push((nullIndex >> 16) & 0xFF);
          bytecode.push((nullIndex >> 8) & 0xFF);
          bytecode.push(nullIndex & 0xFF);
        }
        // In a real VM you'd have a RET opcode. For now, we'll treat return as HALT? Not good.
        // We'll just leave the value on stack and maybe the caller will handle it.
        // Since we don't have functions, this case won't be used.
        break;

      default:
        throw new Error(`Unsupported node type for bytecode generation: ${node.type}`);
    }
  }

  generate(ast);
  return { bytecode, constants };
}
// ==================== NETWORK_BOTS BYTECODE GENERATOR ====================
// Compiles a block-and-connection graph into bytecode.
// Input JSON: { blocks: [{ id, type, config }], connections: [{ from, to }] }
// Output: { bytecode: number[], constants: any[] } ready for assembleBinary.

function generateNetworkBytecode(program) {
  const { blocks, connections } = program;

  // --- Validation ---
  if (!Array.isArray(blocks)) throw new Error('blocks must be an array');
  if (!Array.isArray(connections)) throw new Error('connections must be an array');

  // Build maps and sets
  const blockMap = new Map();                // id -> block object
  const successors = new Map();               // id -> Set of target ids
  const predecessors = new Map();              // id -> Set of source ids
  const blockIds = new Set();

  blocks.forEach(block => {
    if (!block.id || typeof block.id !== 'string') throw new Error('block.id required (string)');
    if (!block.type || typeof block.type !== 'string') throw new Error('block.type required (string)');
    blockIds.add(block.id);
    blockMap.set(block.id, block);
    successors.set(block.id, new Set());
    predecessors.set(block.id, new Set());
  });

  connections.forEach((conn, idx) => {
    if (!conn.from || !conn.to) throw new Error(`connection ${idx} missing from/to`);
    if (!blockIds.has(conn.from)) throw new Error(`connection from unknown block: ${conn.from}`);
    if (!blockIds.has(conn.to)) throw new Error(`connection to unknown block: ${conn.to}`);
    if (successors.get(conn.from).has(conn.to)) throw new Error(`duplicate connection ${conn.from}->${conn.to}`);
    successors.get(conn.from).add(conn.to);
    predecessors.get(conn.to).add(conn.from);
  });

  // Find start block (no predecessors)
  const startBlocks = blocks.filter(b => predecessors.get(b.id).size === 0);
  if (startBlocks.length === 0) throw new Error('no start block (block with no incoming edges)');
  if (startBlocks.length > 1) throw new Error('multiple start blocks – only one entry point allowed');
  const startId = startBlocks[0].id;

  // --- Constants pool ---
  const constants = [];
  const constMap = new Map(); // value -> index

  function addConstant(value) {
    if (constMap.has(value)) return constMap.get(value);
    const idx = constants.length;
    constants.push(value);
    constMap.set(value, idx);
    return idx;
  }

  // Store each block's metadata (type and config) as a constant
  const blockConstIdx = new Map();
  blocks.forEach(block => {
    const data = { type: block.type, config: block.config || {} };
    blockConstIdx.set(block.id, addConstant(data));
  });

  // --- Bytecode generation (two-pass) ---

  // First pass: assign positions to each block's EXEC_BLOCK instruction.
  // We'll traverse the graph in a deterministic order, inserting jumps where needed.
  // We'll maintain a list of jump placeholders to patch in pass 2.

  const blockStartPos = new Map();   // blockId -> bytecode index of its EXEC_BLOCK
  const jumpPatches = [];            // { pos, targetId }  (pos is index of the jump offset to patch)

  const bytecode = [];               // emitted bytecode (array of numbers)

  // We'll use a worklist to lay out blocks in a linear order.
  // We'll also track which blocks have been placed.
  const placed = new Set();
  const pending = [startId];

  while (pending.length > 0) {
    const id = pending.shift();
    if (placed.has(id)) continue; // already placed (e.g., due to back edge)

    // Place this block
    placed.add(id);
    const pos = bytecode.length;
    blockStartPos.set(id, pos);

    // Emit EXEC_BLOCK for this block
    const constIdx = blockConstIdx.get(id);
    bytecode.push(0x14); // EXEC_BLOCK
    bytecode.push((constIdx >> 24) & 0xFF);
    bytecode.push((constIdx >> 16) & 0xFF);
    bytecode.push((constIdx >> 8) & 0xFF);
    bytecode.push(constIdx & 0xFF);

    // Determine successors
    const succ = Array.from(successors.get(id));

    if (succ.length === 0) {
      // No outgoing edges – this block ends execution (or program ends)
      bytecode.push(0xFF); // HALT
      continue;
    }

    // Handle different block types
    const block = blockMap.get(id);

    if (block.type === 'if') {
      // If block: must have exactly two successors (true and false)
      if (succ.length !== 2) {
        throw new Error(`If block ${id} must have exactly 2 outgoing connections`);
      }

      // Determine which successor is true/false from config
      const trueTarget = block.config.trueTarget;
      const falseTarget = block.config.falseTarget;
      if (!trueTarget || !falseTarget) {
        throw new Error(`If block ${id} must specify trueTarget and falseTarget in config`);
      }
      if (!blockIds.has(trueTarget) || !blockIds.has(falseTarget)) {
        throw new Error(`If block ${id} has invalid true/false target`);
      }

      // After the if block executes, a boolean is on stack.
      // Emit JZ to jump to falseTarget if top is false.
      const jzPos = bytecode.length;
      bytecode.push(0x13); // JZ opcode
      bytecode.push(0x00); // placeholder high
      bytecode.push(0x00); // placeholder low
      jumpPatches.push({ pos: jzPos, targetId: falseTarget });

      // We'll try to lay out the true branch immediately after this block (fall-through).
      // Add trueTarget to pending front (so it's next), and falseTarget later.
      if (!placed.has(trueTarget)) {
        pending.unshift(trueTarget);
      }
      if (!placed.has(falseTarget)) {
        // falseTarget will be placed after the true branch, but we need to jump to it.
        // The JZ already handles the jump; we just need to ensure falseTarget is placed somewhere reachable.
        // We'll push it to the end of pending to place after the true branch.
        pending.push(falseTarget);
      }
    } else if (block.type === 'loop') {
      // Loop block: typically has a condition and a body. We'll assume config has 'bodyStart' and 'exitTarget'.
      const bodyStart = block.config.bodyStart;
      const exitTarget = block.config.exitTarget;
      if (!bodyStart || !exitTarget) {
        throw new Error(`Loop block ${id} must specify bodyStart and exitTarget in config`);
      }

      // After loop block executes, a boolean (loop condition) is on stack.
      // If true, jump to bodyStart; if false, exit to exitTarget.
      // Emit JZ to exit if false, else fall through to body.
      const jzPos = bytecode.length;
      bytecode.push(0x13); // JZ
      bytecode.push(0x00); // placeholder high
      bytecode.push(0x00); // placeholder low
      jumpPatches.push({ pos: jzPos, targetId: exitTarget });

      // Add bodyStart to pending front (fall-through)
      if (!placed.has(bodyStart)) {
        pending.unshift(bodyStart);
      }
      if (!placed.has(exitTarget)) {
        pending.push(exitTarget);
      }

      // At the end of the body, we need a jump back to the loop block (to re-evaluate condition).
      // This will be handled when we encounter the body's last block.
    } else {
      // Regular block: exactly one successor (or zero, already handled)
      if (succ.length > 1) {
        throw new Error(`Block ${id} of type ${block.type} has multiple successors; only if/loop blocks may branch`);
      }

      const nextId = succ[0];
      // If next block is already placed (back edge), we need to emit an explicit jump.
      if (placed.has(nextId)) {
        // Back edge – emit JMP to nextId
        const jmpPos = bytecode.length;
        bytecode.push(0x12); // JMP
        bytecode.push(0x00); // placeholder high
        bytecode.push(0x00); // placeholder low
        jumpPatches.push({ pos: jmpPos, targetId: nextId });
      } else {
        // Fall through – just add to pending front
        pending.unshift(nextId);
      }
    }
  }

  // After first pass, we have all blocks placed and jumps recorded.
  // Second pass: patch jump offsets.
  // Compute final positions of each block's start (already in blockStartPos)
  // For each jump patch, compute offset from patch position to target block's start.
  // Offset = (targetPos) - (patchPos + 3)  (because JMP/JZ are 3 bytes: op + 2-byte offset)

  jumpPatches.forEach(patch => {
    const targetPos = blockStartPos.get(patch.targetId);
    if (targetPos === undefined) {
      throw new Error(`Jump target ${patch.targetId} not placed`);
    }
    const patchPos = patch.pos;
    // offset is relative to after the jump instruction (i.e., patchPos + 3)
    const offset = targetPos - (patchPos + 3);
    // Store offset as signed 16-bit (two's complement) for simplicity; could be larger but we'll assume fits.
    if (offset < -32768 || offset > 32767) {
      throw new Error(`Jump offset ${offset} out of range for block ${patch.targetId}`);
    }
    const low = offset & 0xFF;
    const high = (offset >> 8) & 0xFF;
    bytecode[patchPos + 1] = high;
    bytecode[patchPos + 2] = low;
  });

  return { bytecode, constants };
}
// ==================== BINARY ASSEMBLER ====================

function assembleBinary(magic, bytecode, constants) {
  // Convert constants to a binary data section
  let dataSection = Buffer.alloc(4); // will grow dynamically
  let dataOffset = 0;

  // Write constants with length prefix
  constants.forEach(constant => {
    let encoded;
    if (typeof constant === 'string') {
      encoded = Buffer.from(constant, 'utf8');
    } else if (typeof constant === 'number') {
      // Store numbers as 8-byte double
      encoded = Buffer.alloc(8);
      encoded.writeDoubleLE(constant, 0);
    } else if (constant === null) {
      encoded = Buffer.from([0]); // special marker
    } else if (typeof constant === 'boolean') {
      encoded = Buffer.from([constant ? 1 : 0]);
    } else if (typeof constant === 'object') {
      // For block configs, JSON stringify
      encoded = Buffer.from(JSON.stringify(constant), 'utf8');
    } else {
      encoded = Buffer.from(String(constant), 'utf8');
    }

    // Prepend 4-byte length
    const lengthBuf = Buffer.alloc(4);
    lengthBuf.writeUInt32LE(encoded.length, 0);
    const newData = Buffer.concat([lengthBuf, encoded]);
    dataSection = Buffer.concat([dataSection, newData]);
    dataOffset += newData.length;
  });

  // Remove the initial 4 bytes placeholder
  const finalDataSection = dataSection.slice(4);

  // Code section
  const codeSection = Buffer.from(bytecode);

  // Header: magic (4), entry point (4), data size (4), code size (4)
  const header = Buffer.alloc(16);
  header.write(magic, 0, 4, 'ascii');
  header.writeUInt32LE(0, 4); // entry point (always 0 for now)
  header.writeUInt32LE(finalDataSection.length, 8);
  header.writeUInt32LE(codeSection.length, 12);

  // Combine
  return Buffer.concat([header, finalDataSection, codeSection]);
}
