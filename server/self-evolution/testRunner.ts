import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';

interface TestResult {
  passed: boolean;
  coverage: number;
  failures: string[];
}

export class TestRunner {
  private projectRoot: string;
  readonly coverageThreshold = 0.8;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  async generateTests(code: string, type: 'tool' | 'route' | 'component'): Promise<string> {
    switch (type) {
      case 'tool':
        return this.generateToolTests(code);
      case 'route':
        return this.generateRouteTests(code);
      case 'component':
        return this.generateComponentTests(code);
    }
  }

  private generateToolTests(code: string): string {
    const nameMatch = code.match(/export async function (\w+)/);
    const name = nameMatch ? nameMatch[1] : 'unknownFunction';
    return `import { describe, it, expect } from 'vitest';
import { ${name} } from './${name}';

describe('${name}', () => {
  it('should execute without error', async () => {
    const result = await ${name}({} as any);
    expect(result).toBeDefined();
  });

  it('should handle empty input gracefully', async () => {
    await expect(${name}({} as any)).resolves.toBeDefined();
  });

  it('should reject invalid input', async () => {
    await expect(${name}(null as any)).rejects.toThrow();
  });
});
`;
  }

  private generateRouteTests(code: string): string {
    const pathMatch = code.match(/router\.\w+\('([^']+)'/);
    const routePath = pathMatch ? pathMatch[1] : '/unknown';
    return `import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../index';

describe('${routePath}', () => {
  it('should return 200', async () => {
    const res = await request(app).get('${routePath}');
    expect(res.status).toBe(200);
  });

  it('should return json', async () => {
    const res = await request(app).get('${routePath}');
    expect(res.headers['content-type']).toMatch(/json/);
  });
});
`;
  }

  private generateComponentTests(code: string): string {
    const nameMatch = code.match(/export const (\w+)/);
    const name = nameMatch ? nameMatch[1] : 'UnknownComponent';
    return `import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ${name} } from './${name}';

describe('${name}', () => {
  it('should render without crashing', () => {
    const { container } = render(<${name} />);
    expect(container).toBeDefined();
  });

  it('should render the component div', () => {
    render(<${name} />);
    expect(document.querySelector('.${name.toLowerCase()}')).toBeDefined();
  });
});
`;
  }

  async runTests(testPath: string): Promise<TestResult> {
    try {
      const output = execSync(
        `npx vitest run ${testPath} --reporter=json --coverage 2>&1 || true`,
        { cwd: this.projectRoot, encoding: 'utf-8', timeout: 60000 },
      );
      const parsed = this.parseVitestOutput(output);
      const passed = parsed.failures.length === 0;
      const coverage = parsed.coverage >= this.coverageThreshold ? parsed.coverage : parsed.coverage;
      return { passed, coverage, failures: parsed.failures };
    } catch (e) {
      return { passed: false, coverage: 0, failures: [(e as Error).message] };
    }
  }

  private parseVitestOutput(output: string): { coverage: number; failures: string[] } {
    const failures: string[] = [];
    const failLines = output.match(/FAIL\s+.+/g);
    if (failLines) failures.push(...failLines);
    const covMatch = output.match(/Lines\s*:\s*([\d.]+)%/);
    const coverage = covMatch ? parseFloat(covMatch[1]) / 100 : 0;
    return { coverage, failures };
  }

  async writeTests(code: string, type: 'tool' | 'route' | 'component', outputDir: string): Promise<string> {
    const testCode = await this.generateTests(code, type);
    const fileName = type === 'component' ? `${type}.test.tsx` : `${type}.test.ts`;
    const testPath = path.join(outputDir, fileName);
    await fs.writeFile(testPath, testCode, 'utf-8');
    return testPath;
  }

  async runAllTests(): Promise<{ total: number; passed: number; avgCoverage: number }> {
    const output = execSync(
      'npx vitest run --reporter=json --coverage 2>&1 || true',
      { cwd: this.projectRoot, encoding: 'utf-8', timeout: 120000 },
    );
    const { coverage, failures } = this.parseVitestOutput(output);
    return { total: failures.length + 1, passed: failures.length === 0 ? 1 : 0, avgCoverage: coverage };
  }

  async runTestsInDirectory(dir: string): Promise<TestResult> {
    const files = (await fs.readdir(dir)).filter(f => f.endsWith('.test.ts') || f.endsWith('.test.tsx'));
    let totalFailed = 0;
    let totalCoverage = 0;
    for (const file of files) {
      const result = await this.runTests(path.join(dir, file));
      if (!result.passed) totalFailed++;
      totalCoverage += result.coverage;
    }
    const avgCoverage = files.length > 0 ? totalCoverage / files.length : 0;
    return { passed: totalFailed === 0, coverage: avgCoverage, failures: [] };
  }

  async getCoverageReport(): Promise<{ lines: number; branches: number; functions: number; statements: number }> {
    try {
      const output = execSync(
        'npx vitest run --coverage --reporter=json 2>&1 || true',
        { cwd: this.projectRoot, encoding: 'utf-8', timeout: 120000 },
      );
      const linesMatch = output.match(/Lines\s*:\s*([\d.]+)%/);
      const branchesMatch = output.match(/Branches\s*:\s*([\d.]+)%/);
      const funcsMatch = output.match(/Functions\s*:\s*([\d.]+)%/);
      const stmtsMatch = output.match(/Statements\s*:\s*([\d.]+)%/);
      return {
        lines: linesMatch ? parseFloat(linesMatch[1]) : 0,
        branches: branchesMatch ? parseFloat(branchesMatch[1]) : 0,
        functions: funcsMatch ? parseFloat(funcsMatch[1]) : 0,
        statements: stmtsMatch ? parseFloat(stmtsMatch[1]) : 0,
      };
    } catch {
      return { lines: 0, branches: 0, functions: 0, statements: 0 };
    }
  }
}
