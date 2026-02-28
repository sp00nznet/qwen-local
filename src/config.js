import fs from 'fs';
import path from 'path';
import os from 'os';

const CONFIG_DIR = path.join(os.homedir(), '.qwen-local');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const CONVERSATIONS_DIR = path.join(CONFIG_DIR, 'conversations');
const MEMORY_DIR = path.join(CONFIG_DIR, 'memory');

const DEFAULTS = {
  ollamaUrl: 'http://localhost:11434',
  model: 'qwen3-coder-cpu',
  maxContextTokens: 32768,
  compactThreshold: 0.75,  // compact when context is 75% full
  commandTimeout: 60000,
  maxToolResultSize: 8000,
  confirmDestructive: true,
  theme: 'default',
};

let config = { ...DEFAULTS };

export function loadConfig() {
  ensureDirs();
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
      config = { ...DEFAULTS, ...saved };
    } catch {
      // Corrupted config, use defaults
    }
  }
  return config;
}

export function saveConfig(updates) {
  config = { ...config, ...updates };
  ensureDirs();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

export function getConfig() {
  return config;
}

export function getConfigDir() {
  return CONFIG_DIR;
}

export function getConversationsDir() {
  ensureDirs();
  return CONVERSATIONS_DIR;
}

export function getMemoryDir() {
  ensureDirs();
  return MEMORY_DIR;
}

function ensureDirs() {
  for (const dir of [CONFIG_DIR, CONVERSATIONS_DIR, MEMORY_DIR]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}
