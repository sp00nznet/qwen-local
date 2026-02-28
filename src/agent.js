import { toolDefinitions } from './tool-definitions.js';
import { buildSystemPrompt } from './prompt.js';
import { executeTool, getWorkingDirectory, getPlanMode } from './tools.js';
import { getConfig } from './config.js';
import { shouldCompact, compactMessages, countContextTokens, getContextStats } from './context.js';

export function createAgent() {
  let messages = [];
  let initialized = false;
  let totalToolCalls = 0;
  let totalTurns = 0;
  let _cancelled = false;

  function initSystem() {
    if (!initialized) {
      messages.push({
        role: 'system',
        content: buildSystemPrompt(getWorkingDirectory(), getPlanMode() ? 'plan' : 'normal')
      });
      initialized = true;
    }
  }

  function refreshSystemPrompt() {
    const prompt = buildSystemPrompt(getWorkingDirectory(), getPlanMode() ? 'plan' : 'normal');
    if (messages.length > 0 && messages[0].role === 'system') {
      messages[0].content = prompt;
    }
  }

  async function chat(userMessage, { onText, onToolCall, onToolResult, onError, onCompact, onThinking, onToken, signal }) {
    initSystem();
    _cancelled = false;
    messages.push({ role: 'user', content: userMessage });
    totalTurns++;

    if (shouldCompact(messages)) {
      const before = messages.length;
      messages = compactMessages(messages);
      if (onCompact) onCompact(before, messages.length);
    }

    const config = getConfig();
    const ollamaUrl = `${config.ollamaUrl}/v1/chat/completions`;
    const model = config.model;

    let loopCount = 0;
    const maxLoops = 25;

    while (loopCount < maxLoops && !_cancelled) {
      loopCount++;
      const assistantMessage = await callOllama(ollamaUrl, model, messages, { onText, onError, onThinking, onToken, signal }, () => _cancelled);
      if (!assistantMessage || _cancelled) return;

      // Fallback: if the model wrote tool calls as JSON text instead of using
      // structured tool_calls, parse them from the text and execute anyway.
      // This makes qwen-local work with models that don't reliably use the
      // OpenAI tool calling API format.
      if ((!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) && assistantMessage.content) {
        const parsed = parseTextToolCalls(assistantMessage.content);
        if (parsed.length > 0) {
          assistantMessage.tool_calls = parsed;
        }
      }

      messages.push(assistantMessage);

      if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
        return;
      }

      for (const toolCall of assistantMessage.tool_calls) {
        if (_cancelled) return;
        const fnName = toolCall.function.name;
        let args = {};
        try {
          args = JSON.parse(toolCall.function.arguments || '{}');
        } catch {
          args = {};
        }

        totalToolCalls++;
        onToolCall(fnName, args);
        const result = await executeTool(fnName, args);
        if (_cancelled) return;
        onToolResult(fnName, result);

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: result
        });
      }

      if (shouldCompact(messages)) {
        const before = messages.length;
        messages = compactMessages(messages);
        if (onCompact) onCompact(before, messages.length);
      }
    }

    if (loopCount >= maxLoops) {
      onError(`Agent loop hit safety limit (${maxLoops} iterations). Stopping to prevent runaway.`);
    }
  }

  function clearHistory() {
    messages = [];
    initialized = false;
    totalToolCalls = 0;
    totalTurns = 0;
  }

  function getMessages() { return messages; }

  function setMessages(newMessages) {
    messages = newMessages;
    initialized = messages.length > 0 && messages[0].role === 'system';
  }

  function getStats() {
    const ctx = getContextStats(messages);
    return {
      ...ctx,
      messageCount: messages.length,
      totalToolCalls,
      totalTurns,
    };
  }

  // Cancel the current operation — sets flag, does NOT abort fetch
  function cancel() {
    _cancelled = true;
  }

  return { chat, clearHistory, refreshSystemPrompt, getMessages, setMessages, getStats, cancel };
}

async function callOllama(url, model, messages, { onText, onError, onThinking, onToken, signal }, isCancelled) {
  const body = {
    model,
    messages,
    tools: toolDefinitions,
    stream: true,
  };

  if (onThinking) onThinking(true);

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (onThinking) onThinking(false);
    if (err.name === 'AbortError') return null; // Clean abort via Ctrl+C
    onError(`Failed to connect to Ollama at ${url}. Is Ollama running?\n${err.message}`);
    return null;
  }

  if (!response.ok) {
    if (onThinking) onThinking(false);
    let text = '';
    try { text = await response.text(); } catch {}
    onError(`Ollama API error (${response.status}): ${text}`);
    return null;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let contentParts = [];
  let toolCalls = {};
  let firstToken = true;

  while (true) {
    // Check cancelled before each read — just return, don't cancel the reader.
    // reader.cancel() causes unhandled promise rejections on Windows that crash Node.
    // The stream will drain naturally when Ollama finishes generating.
    if (isCancelled()) {
      if (onThinking) onThinking(false);
      return null;
    }

    let readResult;
    try {
      readResult = await reader.read();
    } catch {
      // Stream error (connection closed, etc.) — just bail
      if (onThinking) onThinking(false);
      return null;
    }

    const { done, value } = readResult;
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (isCancelled()) {
        if (onThinking) onThinking(false);
        return null;
      }

      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6);
      if (data === '[DONE]') continue;

      let chunk;
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }

      const choice = chunk.choices?.[0];
      if (!choice) continue;

      const delta = choice.delta;
      if (!delta) continue;

      if (delta.content) {
        if (firstToken && onThinking) {
          onThinking(false);
          firstToken = false;
        }
        contentParts.push(delta.content);
        if (onToken) onToken(Math.max(1, Math.round(delta.content.length / 4)));
        onText(delta.content);
      }

      if (delta.tool_calls) {
        if (firstToken && onThinking) {
          onThinking(false);
          firstToken = false;
        }
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          if (!toolCalls[idx]) {
            toolCalls[idx] = {
              id: tc.id || `call_${idx}_${Date.now()}`,
              type: 'function',
              function: { name: '', arguments: '' }
            };
          }
          if (tc.id) toolCalls[idx].id = tc.id;
          if (tc.function?.name) toolCalls[idx].function.name += tc.function.name;
          if (tc.function?.arguments) {
            toolCalls[idx].function.arguments += tc.function.arguments;
            if (onToken) onToken(Math.max(1, Math.round(tc.function.arguments.length / 4)));
          }
        }
      }
    }
  }

  if (onThinking) onThinking(false);

  const fullContent = contentParts.join('');
  const toolCallArray = Object.values(toolCalls);

  const assistantMessage = { role: 'assistant' };
  if (fullContent) assistantMessage.content = fullContent;
  if (toolCallArray.length > 0) assistantMessage.tool_calls = toolCallArray;

  return assistantMessage;
}

// Parse tool calls from the model's text output.
// Some models (especially smaller ones) output tool calls as JSON code blocks
// in their text instead of using the structured tool_calls API format.
// This extracts those and converts them to proper tool call objects.
const _toolNames = new Set(toolDefinitions.map(t => t.function.name));

function parseTextToolCalls(text) {
  const calls = [];

  // Strategy 1: Extract content between ```json ... ``` code fences
  // Capture everything between fences, then try to parse as JSON.
  const codeBlockRegex = /```(?:json)?\s*\n([\s\S]*?)\n\s*```/g;
  let match;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    const content = match[1].trim();
    try {
      const obj = JSON.parse(content);
      if (obj.name && _toolNames.has(obj.name)) {
        calls.push({
          id: `text_${Date.now()}_${calls.length}`,
          type: 'function',
          function: {
            name: obj.name,
            arguments: JSON.stringify(obj.arguments || {})
          }
        });
      }
    } catch {}
  }

  // Strategy 2: Find bare JSON objects with brace counting (handles nested braces)
  if (calls.length === 0) {
    const namePattern = /\{\s*"name"\s*:\s*"(\w+)"/g;
    while ((match = namePattern.exec(text)) !== null) {
      const name = match[1];
      if (!_toolNames.has(name)) continue;
      // Found a tool name — now extract the full JSON object using brace counting
      const startIdx = match.index;
      let depth = 0;
      let endIdx = -1;
      for (let i = startIdx; i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') { depth--; if (depth === 0) { endIdx = i + 1; break; } }
      }
      if (endIdx === -1) continue;
      try {
        const obj = JSON.parse(text.slice(startIdx, endIdx));
        if (obj.name && obj.arguments) {
          calls.push({
            id: `text_${Date.now()}_${calls.length}`,
            type: 'function',
            function: {
              name: obj.name,
              arguments: JSON.stringify(obj.arguments)
            }
          });
        }
      } catch {}
    }
  }

  return calls;
}
