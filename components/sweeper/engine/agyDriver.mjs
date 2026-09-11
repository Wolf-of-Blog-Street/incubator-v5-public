import { spawnSync } from 'node:child_process';

const AGY_BIN = process.env.AGY_BIN || 'agy';

/**
 * Invokes an official Gemini model non-interactively via the Antigravity CLI (agy).
 * @param {Object} options
 * @param {string} options.model - Model identifier (e.g. gemini-3.6-flash-low, gemini-3.8-flash-low, gemini-3.8-flash-high)
 * @param {string} options.prompt - Prompt content
 * @param {number} [options.timeoutMs] - Execution timeout in ms (default: 180000 / 3m)
 * @param {string} [options.effort] - Reasoning effort (low|medium|high)
 * @param {number} [options.retries] - Number of retry attempts
 * @returns {any} Parsed JSON response
 */
export function invokeAgy({ model, prompt, timeoutMs = 180000, effort = null, retries = 1 }) {
  const args = [
    '--model', model,
    '--input-format', 'stream-json',
    '--output-format', 'stream-json'
  ];
  if (effort) args.push('--effort', effort);

  const inputJson = JSON.stringify({
    event: 'user',
    message: { content: prompt }
  }) + '\n';

  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = spawnSync(AGY_BIN, args, {
      encoding: 'utf8',
      input: inputJson,
      timeout: timeoutMs,
      maxBuffer: 50 * 1024 * 1024,
      env: { ...process.env, CI: '1' }
    });

    if (res.error) {
      if (attempt === retries) throw new Error(`agy execution error: ${res.error.message}`);
      continue;
    }

    if (res.status !== 0) {
      if (attempt === retries) {
        throw new Error(`agy exited with code ${res.status}: ${(res.stderr || res.stdout || '').trim()}`);
      }
      continue;
    }

    let responseText = '';
    const stdout = res.stdout || '';
    for (const line of stdout.split('\n')) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line);
        if (ev.event === 'result' && ev.result && typeof ev.result.response === 'string') {
          responseText = ev.result.response;
          break;
        }
      } catch {
        // Skip unparseable stream lines
      }
    }

    const rawOutput = (responseText || stdout).trim();

    // 1. Try extracting markdown fenced JSON first
    const jsonMatch = rawOutput.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch && jsonMatch[1]) {
      try {
        return JSON.parse(jsonMatch[1].trim());
      } catch {
        // Fall through
      }
    }

    // 2. Search for outermost balanced JSON object
    const firstBrace = rawOutput.indexOf('{');
    const lastBrace = rawOutput.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(rawOutput.slice(firstBrace, lastBrace + 1));
      } catch {
        // Fall through
      }
    }

    if (attempt < retries) {
      continue;
    }

    throw new Error(`Failed to parse JSON response from agy model (${model}):\n${rawOutput.slice(0, 500)}`);
  }
}

/**
 * Formats scope files into readable markdown context blocks.
 */
function formatFilesContext(scopeFiles) {
  return scopeFiles.map(f => {
    return `### File: \`${f.path}\`\n\`\`\`${f.path.endsWith('.mjs') || f.path.endsWith('.js') ? 'javascript' : ''}\n${f.content}\n\`\`\``;
  }).join('\n\n');
}

/**
 * The official Gemini-powered LLM Driver for the Incubator v5 Bug Sweeper.
 */
export const agyDriver = {
  /**
   * Wave 1: Story-to-Code Mental Walkthrough (Gemini 3.6 Flash)
   */
  async executeWave1({ scopeFiles, prompt, storiesContext = '', model = 'gemini-3.6-flash-low' }) {
    console.log(`  🌊 [Wave 1] Launching Story Walkthrough Hunter (${model})...`);
    const fullPrompt = `${prompt}

${storiesContext}

## Target Files To Audit
${formatFilesContext(scopeFiles)}

CRITICAL: Return maximum 3 findings. Keep descriptions compact and return valid, parseable JSON strictly as requested.`;

    const parsed = invokeAgy({ model, prompt: fullPrompt });
    return {
      wave: 1,
      hunter: model,
      findings: parsed.findings || []
    };
  },

  /**
   * Wave 2: Operational Reality & Silent Degradation (Gemini 3.8 Flash)
   */
  async executeWave2({ scopeFiles, wave1, prompt, storiesContext = '', model = 'gemini-3.8-flash-low' }) {
    console.log(`  🌊 [Wave 2] Launching Operational Reality Hunter (${model})...`);
    const fullPrompt = `${prompt}

${storiesContext}

## Target Files To Audit
${formatFilesContext(scopeFiles)}

## Wave 1 Prior Findings
\`\`\`json
${JSON.stringify(wave1, null, 2)}
\`\`\`

CRITICAL: Return maximum 3 findings. Keep descriptions concise and return valid, parseable JSON strictly as requested.`;

    const parsed = invokeAgy({ model, prompt: fullPrompt });
    return {
      wave: 2,
      hunter: model,
      findings: parsed.findings || []
    };
  },

  /**
   * Wave 3: Real Story Reproduction Tests (Gemini 3.7 Flash)
   */
  async executeWave3({ scopeFiles, wave1, wave2, prompt, storiesContext = '', model = 'gemini-3.7-flash-low' }) {
    console.log(`  🌊 [Wave 3] Generating Broken Story Reproduction Tests (${model})...`);
    const fullPrompt = `${prompt}

${storiesContext}

## Target Files Under Audit
${formatFilesContext(scopeFiles)}

## Wave 1 Findings
\`\`\`json
${JSON.stringify(wave1, null, 2)}
\`\`\`

## Wave 2 Findings
\`\`\`json
${JSON.stringify(wave2, null, 2)}
\`\`\`

CRITICAL: Author self-contained node:test scripts in pure ESM that attempt to reproduce broken user stories. Return strictly JSON.`;

    const parsed = invokeAgy({ model, prompt: fullPrompt });
    return {
      wave: 3,
      role: 'story-reproduction-engineer',
      tests: parsed.tests || []
    };
  },

  /**
   * Judge & Real-Use Gavel (Gemini 3.8 Flash Low)
   */
  async executeJudge({ scopeFiles, wave1, wave2, testProofs, prompt, storiesContext = '', model = 'gemini-3.8-flash-low' }) {
    console.log(`  ⚖️  [Judge] Presiding Judge Delivering Real-Use Verdict (${model})...`);
    const fullPrompt = `${prompt}

${storiesContext}

## Target Files Audited
${formatFilesContext(scopeFiles)}

## Wave 1 Findings
\`\`\`json
${JSON.stringify(wave1, null, 2)}
\`\`\`

## Wave 2 Findings
\`\`\`json
${JSON.stringify(wave2, null, 2)}
\`\`\`

## Wave 3 Dynamic Test Execution Results
\`\`\`json
${JSON.stringify(testProofs, null, 2)}
\`\`\`

CRITICAL: Return your final stamped verdict strictly in the required JSON structure.`;

    const parsed = invokeAgy({ model, prompt: fullPrompt });
    return {
      verdict: parsed.verdict || (testProofs.some(t => !t.passed) ? 'issues_detected' : 'clean'),
      judge: model,
      summary: parsed.summary || {
        total_reviewed: (wave1.findings?.length || 0) + (wave2.findings?.length || 0),
        stamped_verified: (parsed.stamped_bugs || []).length,
        discarded_trivia: (parsed.discarded_findings || []).length
      },
      stamped_bugs: parsed.stamped_bugs || [],
      discarded_findings: parsed.discarded_findings || []
    };
  }
};
