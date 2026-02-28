import chalk from 'chalk';

export const colors = {
  toolName: chalk.cyan.bold,
  toolParam: chalk.gray,
  toolResult: chalk.dim,
  error: chalk.red.bold,
  warning: chalk.yellow,
  success: chalk.green.bold,
  ai: chalk.white,
  user: chalk.blue.bold,
  dim: chalk.dim,
  header: chalk.magenta.bold,
  plan: chalk.yellow.bold,
  status: chalk.gray,
  compact: chalk.yellow,
};

export function formatToolCall(name, args) {
  const argStr = Object.entries(args)
    .map(([k, v]) => {
      const val = typeof v === 'string'
        ? (v.length > 80 ? v.slice(0, 80) + '...' : v)
        : JSON.stringify(v);
      return `${colors.toolParam(k)}=${val}`;
    })
    .join(' ');
  return `${colors.toolName('> ' + name)} ${argStr}`;
}

export function truncate(str, maxLen = 2000) {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + `\n... (truncated, ${str.length} chars total)`;
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

export function contextBar(pct) {
  const width = 20;
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;
  const color = pct > 80 ? chalk.red : pct > 60 ? chalk.yellow : chalk.green;
  return color('[' + '='.repeat(filled) + ' '.repeat(empty) + ']') + ` ${pct}%`;
}
