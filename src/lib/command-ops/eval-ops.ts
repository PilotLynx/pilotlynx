import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { getProjectDir } from '../config.js';
import { runAgent } from '../agent-runner.js';
import { buildProjectEnv } from '../secrets.js';
import { getRunAgentConfig } from '../../agents/run.agent.js';
import type { EvalTestCase, EvalResult, EvalSummary } from '../types.js';

export interface EvalOptions {
  workflow?: string;
  tag?: string;
  budget?: number;
}

export async function executeEval(project: string, options?: EvalOptions): Promise<EvalSummary> {
  const projectDir = getProjectDir(project);
  const evalsDir = join(projectDir, 'evals');

  if (!existsSync(evalsDir)) {
    throw new Error(`No evals/ directory found in project "${project}". Create test cases first.`);
  }

  // Load test cases from evals/*.json
  const testCases = loadTestCases(evalsDir);

  // Filter by workflow/tag if specified
  let filtered = testCases;
  if (options?.workflow) {
    filtered = filtered.filter(tc => tc.workflow === options.workflow);
  }
  if (options?.tag) {
    filtered = filtered.filter(tc => tc.tags?.includes(options.tag!));
  }

  if (filtered.length === 0) {
    throw new Error('No matching test cases found.');
  }

  const results: EvalResult[] = [];
  let totalCost = 0;

  for (const tc of filtered) {
    // Budget check
    if (options?.budget && totalCost >= options.budget) {
      console.log(`Budget limit ($${options.budget}) reached. Stopping eval.`);
      break;
    }

    // Run the workflow with the test case input
    const projectEnv = buildProjectEnv(project);
    const config = getRunAgentConfig(project, tc.workflow, projectEnv);
    config.prompt = tc.input;
    if (options?.budget) config.maxBudgetUsd = Math.max(0.01, options.budget - totalCost);
    config.maxTurns = 10; // Limit eval runs to keep costs down

    const agentResult = await runAgent(config, () => {}); // suppress output
    totalCost += agentResult.costUsd;

    // Use heuristic judge to score the output against expected behavior
    const score = judgeOutput(tc, agentResult.result, agentResult.success);

    results.push({
      testCase: tc.name,
      workflow: tc.workflow,
      passed: score.passed,
      score: score.score,
      reasoning: score.reasoning,
      costUsd: agentResult.costUsd,
      timestamp: new Date().toISOString(),
    });
  }

  const summary: EvalSummary = {
    project,
    timestamp: new Date().toISOString(),
    totalCases: results.length,
    passed: results.filter(r => r.passed).length,
    failed: results.filter(r => !r.passed).length,
    avgScore: results.length > 0 ? results.reduce((s, r) => s + r.score, 0) / results.length : 0,
    results,
  };

  // Save results
  const resultsDir = join(evalsDir, 'results');
  mkdirSync(resultsDir, { recursive: true });
  const dateStr = new Date().toISOString().split('T')[0];
  writeFileSync(
    join(resultsDir, `${dateStr}.json`),
    JSON.stringify(summary, null, 2),
    'utf8'
  );

  return summary;
}

function loadTestCases(evalsDir: string): EvalTestCase[] {
  const cases: EvalTestCase[] = [];
  const files = readdirSync(evalsDir).filter(f => f.endsWith('.json') && f !== 'results');

  for (const file of files) {
    try {
      const content = JSON.parse(readFileSync(join(evalsDir, file), 'utf8'));
      if (Array.isArray(content)) {
        cases.push(...content);
      } else if (content.name && content.workflow) {
        cases.push(content);
      }
    } catch {
      // Skip invalid files
    }
  }
  return cases;
}

interface JudgeResult {
  passed: boolean;
  score: number;
  reasoning: string;
}

function judgeOutput(
  testCase: EvalTestCase,
  output: string,
  success: boolean,
): JudgeResult {
  // If the workflow failed entirely, score 0
  if (!success) {
    return { passed: false, score: 0, reasoning: 'Workflow execution failed' };
  }

  // Keyword matching against expected behavior for basic scoring
  const expectedLower = testCase.expectedBehavior.toLowerCase();
  const outputLower = output.toLowerCase();

  // Extract key terms from expected behavior
  const keyTerms = expectedLower
    .split(/[\s,;.]+/)
    .filter(t => t.length > 3);

  const matchCount = keyTerms.filter(term => outputLower.includes(term)).length;
  const score = keyTerms.length > 0 ? matchCount / keyTerms.length : 0;
  const passed = score >= 0.5;

  return {
    passed,
    score: Math.round(score * 100) / 100,
    reasoning: `Matched ${matchCount}/${keyTerms.length} key terms from expected behavior`,
  };
}
