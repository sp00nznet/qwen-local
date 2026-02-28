/**
 * Conversation persistence — save and load conversation history.
 */

import fs from 'fs';
import path from 'path';
import { getConversationsDir } from './config.js';

export function saveConversation(messages, name) {
  const dir = getConversationsDir();
  const filename = name
    ? `${sanitize(name)}.json`
    : `conversation-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const filepath = path.join(dir, filename);

  const data = {
    savedAt: new Date().toISOString(),
    messageCount: messages.length,
    messages,
  };

  fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf-8');
  return filepath;
}

export function loadConversation(nameOrIndex) {
  const dir = getConversationsDir();
  const files = listConversations();

  let filepath;
  if (typeof nameOrIndex === 'number' || /^\d+$/.test(nameOrIndex)) {
    const idx = parseInt(nameOrIndex, 10) - 1;
    if (idx < 0 || idx >= files.length) return null;
    filepath = path.join(dir, files[idx].filename);
  } else {
    const match = files.find(f =>
      f.filename.toLowerCase().includes(nameOrIndex.toLowerCase())
    );
    if (!match) return null;
    filepath = path.join(dir, match.filename);
  }

  try {
    const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    return data.messages || [];
  } catch {
    return null;
  }
}

export function listConversations() {
  const dir = getConversationsDir();
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(filename => {
      const filepath = path.join(dir, filename);
      try {
        const stat = fs.statSync(filepath);
        const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
        return {
          filename,
          savedAt: data.savedAt || stat.mtime.toISOString(),
          messageCount: data.messageCount || 0,
        };
      } catch {
        return { filename, savedAt: 'unknown', messageCount: 0 };
      }
    })
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

function sanitize(name) {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50);
}
