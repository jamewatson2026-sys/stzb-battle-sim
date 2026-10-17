/**
 * AI 配将顾问的 MCP 入口。
 * 一个工具 `ask_advisor`：提问，返回回答、思考文本和工具轨迹。
 *
 * 启动：`npx tsx scripts/advisor_mcp.mts`（stdio，一行一条 JSON-RPC）。
 * 密钥只从环境变量 `ADVISOR_KEY` 读，不落盘。
 * 阵容是 `defaultCfg()`（h3 / h5 / h16），不是主站正在配的那一队。
 * 会话只活在这个进程里：同一 `session` 接着问；进程退出就没了。
 */
import { pathToFileURL } from 'node:url';
import { runAdvisorTurn, type AdvisorEvent } from '../web/advisor/loop';
import { createBrowserTransport } from '../web/advisor/transport';
import { makeCtx } from '../web/advisor/tools';
import { toolZh } from '../web/advisor/trace';
import {
  appendTurn,
  emptySession,
  ensureTask,
  historyFrom,
  renderTaskBlock,
  toStoredTurn,
  type AdvisorSession,
} from '../web/advisor/memory';
import type { AdvisorTurn } from '../web/advisor/types';

/** 思考文本上限。再长就截断，避免一次工具结果把上下文撑满。 */
const THOUGHT_CAP = 12000;

interface RpcMessage {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
}

const sessions = new Map<string, AdvisorSession>();

/**
 * 把一轮结果收成给调用方看的文本：回答、按模型往返切开的思考、工具轨迹、三关结论。
 */
export function formatAdvisorReply(sessionId: string, turn: AdvisorTurn, thoughts: string[]): string {
  const joined = thoughts.filter((s) => s.trim()).join('\n\n---\n\n');
  const think = joined
    ? joined.length > THOUGHT_CAP
      ? `${joined.slice(0, THOUGHT_CAP)}\n…（思考已截断）`
      : joined
    : '（这一轮模型没有返回思考文本）';
  const tools = turn.toolCalls.length
    ? turn.toolCalls
        .map((t) => {
          const head = `- ${toolZh(t.name)} ${t.evidenceId}：${t.summary}`;
          return t.brief ? `${head}\n  ${t.brief.replace(/\n/g, '\n  ')}` : head;
        })
        .join('\n')
    : '（没调工具）';
  const v = turn.verdict;
  return [
    `session: ${sessionId}`,
    '',
    '## 回答',
    turn.answer.trim() || '（空）',
    '',
    '## 思考',
    think,
    '',
    '## 工具',
    tools,
    '',
    `校验：合法 ${v.legal ? '通过' : '不通过'} · 可溯源 ${v.verified ? '通过' : '不通过'} · 复算 ${v.recomputed ? '有' : '无'}`,
    turn.degraded ? '（无工具模式：模型不支持工具调用）' : '',
  ]
    .filter((line, i, arr) => line !== '' || arr[i - 1] !== '')
    .join('\n')
    .trim();
}

/** 向顾问提一个问题。`session` 省略或对不上就新开一轮。 */
export async function askAdvisor(question: string, sessionId?: string): Promise<string> {
  const q = question.trim();
  if (!q) throw new Error('question 不能为空');
  const key = process.env.ADVISOR_KEY?.trim() ?? '';
  if (!key || key.includes('${')) {
    throw new Error('缺少 ADVISOR_KEY。在 MCP 配置的 env 里配上顾问的 API key，不要写进仓库。');
  }
  let session = sessionId ? sessions.get(sessionId) : undefined;
  if (!session) session = ensureTask(emptySession(), q);
  const thoughts: string[] = [];
  let buf = '';
  const flush = (): void => {
    const t = buf.trim();
    if (t) thoughts.push(t);
    buf = '';
  };
  const onEvent = (e: AdvisorEvent): void => {
    if (e.type === 'round') flush();
    else if (e.type === 'reasoning') buf += e.text;
  };
  const turn = await runAdvisorTurn({
    userText: q,
    ctx: makeCtx(),
    transport: createBrowserTransport({
      baseUrl: process.env.ADVISOR_BASE_URL?.trim() || 'https://api.deepseek.com/v1',
      model: process.env.ADVISOR_MODEL?.trim() || 'deepseek-chat',
      key,
      maxCalls: 40,
      maxBattles: 200000,
      maxTokens: 1000000,
      askBeforeSearch: false,
      askFrom: 1,
      autoProfile: false,
      strictBox: false,
    }),
    history: historyFrom(session),
    taskText: renderTaskBlock(session),
    onEvent,
  });
  flush();
  session = appendTurn(session, toStoredTurn(turn, q));
  sessions.set(session.id, session);
  return formatAdvisorReply(session.id, turn, thoughts);
}

const TOOL = {
  name: 'ask_advisor',
  description:
    '向本仓库的 AI 配将顾问提一个问题。返回它的回答、思考文本和工具调用。用返回里的 session 接着问。阵容是默认的 h3 / h5 / h16，不是主站当前配将。',
  inputSchema: {
    type: 'object',
    properties: {
      question: { type: 'string', description: '问顾问的话' },
      session: { type: 'string', description: '上一轮返回的 session。省略则新开一轮。' },
    },
    required: ['question'],
    additionalProperties: false,
  },
};

/**
 * 处理一条 JSON-RPC。通知（没有 id）返回 null，调用方不要写回。
 * `ask` 可替换，测试不必真的打模型。
 */
export async function handleRpc(
  msg: RpcMessage,
  ask: (question: string, session?: string) => Promise<string> = askAdvisor,
): Promise<RpcMessage | null> {
  const id = msg.id ?? null;
  if (msg.id === undefined) return null;
  const fail = (code: number, message: string): RpcMessage => ({ jsonrpc: '2.0', id, error: { code, message } });
  try {
    if (msg.method === 'initialize') {
      const clientVersion = typeof msg.params?.protocolVersion === 'string' ? msg.params.protocolVersion : '2024-11-05';
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: clientVersion,
          capabilities: { tools: {} },
          serverInfo: { name: 'stzb-advisor', version: '0.1.0' },
        },
      };
    }
    if (msg.method === 'ping') return { jsonrpc: '2.0', id, result: {} };
    if (msg.method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: [TOOL] } };
    if (msg.method === 'tools/call') {
      const params = msg.params ?? {};
      const name = params.name;
      const args = (params.arguments ?? {}) as { question?: unknown; session?: unknown };
      if (name !== 'ask_advisor') return fail(-32602, `未知工具 ${String(name)}`);
      if (typeof args.question !== 'string') return fail(-32602, 'question 必须是字符串');
      const session = typeof args.session === 'string' ? args.session : undefined;
      try {
        const text = await ask(args.question, session);
        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } };
      } catch (e) {
        const text = e instanceof Error ? e.message : String(e);
        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }], isError: true } };
      }
    }
    return fail(-32601, `不认识的方法 ${msg.method ?? ''}`);
  } catch (e) {
    return fail(-32603, e instanceof Error ? e.message : String(e));
  }
}

/** 从标准输入读一行一条 JSON-RPC，应答写到标准输出。日志只走标准错误。 */
export function serve(): void {
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    buf += chunk;
    let nl = buf.indexOf('\n');
    while (nl >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      nl = buf.indexOf('\n');
      if (!line) continue;
      void onLine(line);
    }
  });
}

async function onLine(line: string): Promise<void> {
  let msg: RpcMessage;
  try {
    msg = JSON.parse(line) as RpcMessage;
  } catch {
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON 解析失败' } })}\n`);
    return;
  }
  const res = await handleRpc(msg);
  if (res) process.stdout.write(`${JSON.stringify(res)}\n`);
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) serve();
