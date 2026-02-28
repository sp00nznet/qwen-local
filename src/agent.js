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

  async function chat(userMessage, { onText, onToolCall, onToolResult, onError, onCompact, onThinking, onToken }) {
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
      const assistantMessage = await callOllama(ollamaUrl, model, messages, { onText, onError, onThinking, onToken }, () => _cancelled);
      if (!assistantMessage || _cancelled) return;

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

async function callOllama(url, model, messages, { onText, onError, onThinking, onToken }, isCancelled) {
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
    });
  } catch (err) {
    if (onThinking) onThinking(false);
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
