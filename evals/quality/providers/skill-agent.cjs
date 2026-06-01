const fs = require('fs');
const path = require('path');

const SKILLS_ROOT = path.resolve(__dirname, '..', '..', '..', 'plugins', 'kurrent', 'skills');

const TOOLS = [
  {
    name: 'list_skill_files',
    description: 'List every file bundled with the skill, relative to the skill directory.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'read_skill_file',
    description: 'Read one file bundled with the skill, e.g. "references/client-sdks/dotnet/getting-started.md".',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
];

const ADAPTERS = {
  anthropic: {
    defaultBaseUrl: 'https://api.anthropic.com',
    defaultKeyEnv: 'ANTHROPIC_API_KEY',
    endpoint: (baseUrl) => `${baseUrl}/v1/messages`,
    headers: (key) => ({
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    }),
    initMessages: (_system, message) => [{ role: 'user', content: message }],
    body: ({ model, maxTokens, system, messages }) => ({
      model,
      max_tokens: maxTokens,
      system,
      tools: TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })),
      messages,
    }),
    parse: (body) => ({
      text: body.content.filter((b) => b.type === 'text').map((b) => b.text).join(''),
      toolCalls: body.content
        .filter((b) => b.type === 'tool_use')
        .map((b) => ({ id: b.id, name: b.name, args: b.input })),
      done: body.stop_reason !== 'tool_use',
      usage: usage(body.usage && body.usage.input_tokens, body.usage && body.usage.output_tokens),
    }),
    pushAssistant: (messages, body) => messages.push({ role: 'assistant', content: body.content }),
    pushToolResults: (messages, results) =>
      messages.push({
        role: 'user',
        content: results.map((r) => ({
          type: 'tool_result',
          tool_use_id: r.id,
          content: r.content,
          is_error: r.isError || undefined,
        })),
      }),
  },

  openai: {
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultKeyEnv: 'OPENAI_API_KEY',
    endpoint: (baseUrl) => `${baseUrl}/chat/completions`,
    headers: (key) => ({
      'content-type': 'application/json',
      authorization: `Bearer ${key}`,
    }),
    initMessages: (system, message) => [
      { role: 'system', content: system },
      { role: 'user', content: message },
    ],
    body: ({ model, maxTokens, messages }) => ({
      model,
      max_tokens: maxTokens,
      tools: TOOLS.map((t) => ({ type: 'function', function: t })),
      messages,
    }),
    parse: (body) => {
      const msg = body.choices[0].message;
      const calls = msg.tool_calls || [];
      return {
        text: msg.content || '',
        toolCalls: calls.map((c) => ({
          id: c.id,
          name: c.function.name,
          args: JSON.parse(c.function.arguments || '{}'),
        })),
        done: calls.length === 0,
        usage: usage(
          body.usage && body.usage.prompt_tokens,
          body.usage && body.usage.completion_tokens,
        ),
      };
    },
    pushAssistant: (messages, body) => messages.push(body.choices[0].message),
    pushToolResults: (messages, results) => {
      for (const r of results) {
        messages.push({ role: 'tool', tool_call_id: r.id, content: r.content });
      }
    },
  },
};

class SkillAgentProvider {
  constructor(options = {}) {
    this.providerId = options.id || 'skill-agent';
    this.config = options.config || {};
  }

  id() {
    return this.providerId;
  }

  async callApi(_prompt, context) {
    const apiName = this.config.api || 'anthropic';
    const adapter = ADAPTERS[apiName];
    if (!adapter) {
      return { error: `skill-agent: unknown api "${apiName}" (expected "anthropic" or "openai")` };
    }

    const keyEnv = this.config.apiKeyEnv || adapter.defaultKeyEnv;
    const apiKey = process.env[keyEnv];
    if (!apiKey) {
      return { error: `skill-agent: ${keyEnv} is not set` };
    }

    const skill = context.vars && context.vars.skill;
    const message = context.vars && context.vars.message;
    if (!skill) {
      return { error: 'skill-agent: test is missing required var `skill`' };
    }

    const skillDir = path.join(SKILLS_ROOT, skill);
    const skillPath = path.join(skillDir, 'SKILL.md');
    if (!fs.existsSync(skillPath)) {
      return { error: `skill-agent: SKILL.md not found at ${skillPath}` };
    }

    const model = this.config.model;
    if (!model) {
      return { error: 'skill-agent: config.model is required' };
    }
    const maxTokens = this.config.max_tokens || 2048;
    const maxTurns = this.config.max_turns || 8;
    const baseUrl = this.config.baseUrl || adapter.defaultBaseUrl;
    const url = adapter.endpoint(baseUrl);
    const system = fs.readFileSync(skillPath, 'utf8');
    const messages = adapter.initMessages(system, message);

    for (let turn = 0; turn < maxTurns; turn++) {
      const res = await fetch(url, {
        method: 'POST',
        headers: adapter.headers(apiKey),
        body: JSON.stringify(adapter.body({ model, maxTokens, system, messages })),
      });

      if (!res.ok) {
        return { error: `skill-agent: ${apiName} API ${res.status} ${await res.text()}` };
      }

      const body = await res.json();
      const turnResult = adapter.parse(body);
      adapter.pushAssistant(messages, body);

      if (turnResult.done) {
        return { output: turnResult.text, tokenUsage: turnResult.usage };
      }

      const results = turnResult.toolCalls.map((call) => ({
        id: call.id,
        ...runTool(skillDir, call.name, call.args),
      }));
      adapter.pushToolResults(messages, results);
    }

    return { error: `skill-agent: tool loop did not converge within ${maxTurns} turns` };
  }
}

function runTool(skillDir, name, input) {
  try {
    if (name === 'list_skill_files') {
      const files = listFiles(skillDir).map((f) => path.relative(skillDir, f));
      return { content: files.join('\n') };
    }
    if (name === 'read_skill_file') {
      return { content: fs.readFileSync(resolveInSkill(skillDir, input.path), 'utf8') };
    }
    return { content: `unknown tool: ${name}`, isError: true };
  } catch (err) {
    return { content: String(err.message || err), isError: true };
  }
}

function resolveInSkill(skillDir, rel) {
  const abs = path.resolve(skillDir, rel || '');
  if (abs !== skillDir && !abs.startsWith(skillDir + path.sep)) {
    throw new Error(`path escapes skill directory: ${rel}`);
  }
  return abs;
}

function listFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(full);
    return [full];
  });
}

function usage(prompt, completion) {
  if (prompt == null && completion == null) return undefined;
  const p = prompt || 0;
  const c = completion || 0;
  return { prompt: p, completion: c, total: p + c };
}

module.exports = SkillAgentProvider;
