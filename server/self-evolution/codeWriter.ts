import fs from 'fs/promises';
import path from 'path';

interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
}

interface RouteSpec {
  path: string;
  method: 'get' | 'post' | 'put' | 'delete' | 'patch';
  handler: string;
}

interface ComponentSpec {
  name: string;
  props: Record<string, string>;
  purpose: string;
}

export class CodeWriter {
  private templatesDir: string;

  constructor(templatesDir: string) {
    this.templatesDir = templatesDir;
  }

  async generateTool(spec: ToolSpec): Promise<string> {
    return `import { z } from 'zod';

export const ${spec.name}Input = z.object({
${Object.entries(spec.inputSchema).map(([k, v]) => `  ${k}: ${this.mapZodType(v as string)},`).join('\n')}
});

export const ${spec.name}Output = z.object({
${Object.entries(spec.outputSchema).map(([k, v]) => `  ${k}: ${this.mapZodType(v as string)},`).join('\n')}
});

export type ${spec.name}InputType = z.infer<typeof ${spec.name}Input>;
export type ${spec.name}OutputType = z.infer<typeof ${spec.name}Output>;

/**
 * ${spec.description}
 */
export async function ${spec.name}(
  input: ${spec.name}InputType,
): Promise<${spec.name}OutputType> {
  const parsed = ${spec.name}Input.parse(input);
  // TODO: implement ${spec.name}
  return parsed as unknown as ${spec.name}OutputType;
}
`;
  }

  async generateRoute(spec: RouteSpec): Promise<string> {
    return `import { Router, Request, Response } from 'express';

const router = Router();

router.${spec.method}('${spec.path}', async (req: Request, res: Response) => {
  try {
    // TODO: implement handler logic
    res.json({ status: 'ok', path: '${spec.path}' });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

export default router;
`;
  }

  async generateComponent(spec: ComponentSpec): Promise<string> {
    const propEntries = Object.entries(spec.props)
      .map(([k, v]) => `  ${k}: ${v};`)
      .join('\n');
    return `import React from 'react';

interface ${spec.name}Props {\n${propEntries}\n}

/**
 * ${spec.purpose}
 */
export const ${spec.name}: React.FC<${spec.name}Props> = (props) => {
  return (
    <div className="${spec.name.toLowerCase()}">
      {/* TODO: implement ${spec.name} - ${spec.purpose} */}
    </div>
  );
};

export default ${spec.name};
`;
  }

  async validateCode(code: string, type: 'ts' | 'tsx'): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    if (!code || code.length === 0) {
      errors.push('Empty code');
      return { valid: false, errors };
    }
    if (type === 'tsx' && !code.includes('React')) {
      errors.push('TSX files must import React');
    }
    if (type === 'ts' && code.includes('React') && !code.includes('tsx')) {
      // valid mixed usage
    }
    const lines = code.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes('eval(')) errors.push(`Line ${i + 1}: eval() not allowed`);
      if (line.includes('require(') && !line.includes('import')) errors.push(`Line ${i + 1}: dynamic require not allowed`);
    }
    return { valid: errors.length === 0, errors };
  }

  async writeFile(filePath: string, code: string): Promise<void> {
    const absPath = path.resolve(filePath);
    const dir = path.dirname(absPath);
    await fs.mkdir(dir, { recursive: true });
    const existing = await fs.stat(absPath).then(() => true).catch(() => false);
    if (existing) {
      const backup = absPath + '.bak.' + Date.now();
      await fs.copyFile(absPath, backup);
    }
    await fs.writeFile(absPath, code, 'utf-8');
  }

  private mapType(t: string): string {
    const map: Record<string, string> = {
      string: 'string', number: 'number', boolean: 'boolean',
      array: 'any[]', object: 'Record<string, unknown>',
    };
    return map[t] || 'unknown';
  }

  private mapZodType(t: string): string {
    const map: Record<string, string> = {
      string: 'z.string()', number: 'z.number()', boolean: 'z.boolean()',
      array: 'z.array(z.any())', object: 'z.record(z.unknown())',
    };
    return map[t] || 'z.unknown()';
  }

  async readFile(filePath: string): Promise<string> {
    return fs.readFile(filePath, 'utf-8');
  }

  async listGeneratedFiles(dir: string): Promise<string[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter(e => e.isFile() && (e.name.endsWith('.ts') || e.name.endsWith('.tsx')))
      .map(e => path.join(dir, e.name));
  }

  async generateMiddleware(spec: { name: string; purpose: string }): Promise<string> {
    return `import { Request, Response, NextFunction } from 'express';

/**
 * ${spec.purpose}
 */
export function ${spec.name}(req: Request, res: Response, next: NextFunction): void {
  // TODO: implement ${spec.name}
  next();
}

export default ${spec.name};
`;
  }

  async generateModel(spec: { name: string; fields: Record<string, string> }): Promise<string> {
    const fieldEntries = Object.entries(spec.fields)
      .map(([k, v]) => `  ${k}: ${v};`)
      .join('\n');
    return `export interface ${spec.name} {\n${fieldEntries}\n}

export type ${spec.name}List = ${spec.name}[];

export function create${spec.name}(data: Partial<${spec.name}>): ${spec.name} {
  return data as ${spec.name};
}
`;
  }

  async generateService(spec: { name: string; methods: string[] }): Promise<string> {
    const methodImpls = spec.methods.map(m => `
  async ${m}(input: unknown): Promise<unknown> {
    // TODO: implement ${m}
    return input;
  }`).join('');
    return `export class ${spec.name} {\n${methodImpls}\n}

export const ${spec.name[0].toLowerCase() + spec.name.slice(1)} = new ${spec.name}();
`;
  }

  async generateTestSuite(spec: { target: string; cases: Array<{ name: string; input: unknown; expected: unknown }> }): Promise<string> {
    const caseTests = spec.cases.map(c => `
  it('${c.name}', () => {
    const input = ${JSON.stringify(c.input)};
    const expected = ${JSON.stringify(c.expected)};
    expect(input).toEqual(expected);
  });`).join('');
    return `import { describe, it, expect } from 'vitest';

describe('${spec.target}', function () {${caseTests}
});
`;
  }

  async deleteFile(filePath: string): Promise<void> {
    await fs.unlink(filePath);
  }
}
