import readline from 'readline';
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { createAgent } from './agent.js';
import { setWorkingDirectory, getWorkingDirectory, setPlanMode, getPlanMode } from './tools.js';
import { loadConfig, saveConfig, getConfig } from './config.js';
import { saveConversation, loadConversation, listConversations } from './conversation.js';
import { getAllSkills, getSkill, saveSkill, deleteSkill, expandSkillPrompt, matchSkillCommand } from './skills.js';
import { loadAllMemory, clearGlobalMemory, clearProjectMemory, getMemoryStats } from './memory.js';
import { colors, formatToolCall, truncate, contextBar, formatDuration } from './utils.js';

// Module-level state for ESC interrupt handling
let _isBusy = false;
let _agent = null;
let _aborted = false;
let _cancelResolve = null; // resolves the cancel promise to win the race

// Rotating verbs for the thinking spinner
const THINKING_VERBS = [
  'Thinking', 'Reasoning', 'Analyzing', 'Considering', 'Processing',
  'Evaluating', 'Reflecting', 'Pondering', 'Working', 'Computing',
  'Examining', 'Deliberating', 'Formulating', 'Assessing', 'Exploring',
];

export async function startCLI() {
  const cwd = process.cwd();
  setWorkingDirectory(cwd);
  loadConfig();
  const config = getConfig();

  console.log(colors.header('\n  qwen-local'));
  console.log(colors.dim(`  Agentic coding assistant powered by ${config.model}\n`));
  console.log(colors.dim(`  Working directory: ${cwd}`));
  console.log(colors.dim(`  Model: ${config.model} via ${config.ollamaUrl}`));
  console.log(colors.dim(`  Context limit: ${config.maxContextTokens.toLocaleString()} tokens`));
  console.log(colors.dim('  Type /help for commands, /exit to quit\n'));

  const agent = createAgent();
  _agent = agent;
  let multilineBuffer = null;
  let skillDraftState = null; // for interactive skill creation

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  // Listen for ESC key to interrupt processing.
  // We don't use Ctrl+C — on Windows it's hardwired to kill the process.
  // ESC is a clean keypress that readline passes through without side effects.
  process.stdin.on('keypress', (str, key) => {
    if (key && key.name === 'escape' && _isBusy) {
      _aborted = true;
      _isBusy = false;
      _agent.cancel(); // sets flag so callbacks become no-ops
      if (_cancelResolve) {
        _cancelResolve(); // resolves the cancel promise, wins the race
        _cancelResolve = null;
      }
    }
  });

  // Helper to ask a question and get a response
  function ask(question) {
    return new Promise(resolve => {
      rl.question(colors.dim(`  ${question} `), answer => resolve(answer));
    });
  }

  function getPromptStr() {
    const shortCwd = getWorkingDirectory().split(/[/\\]/).slice(-2).join('/');
    const mode = getPlanMode() ? colors.plan(' [PLAN] ') : '';
    return colors.user(`  ${shortCwd}${mode} > `);
  }

  const prompt = () => {
    rl.question(getPromptStr(), async (input) => {
      // Ignore any input that arrives while busy (shouldn't normally happen)
      if (_isBusy) return;

      // --- Multiline input mode ---
      if (multilineBuffer !== null) {
        if (input.trim() === '"""' || input.trim() === "'''") {
          const fullInput = multilineBuffer;
          multilineBuffer = null;
          await handleUserInput(fullInput, rl, agent);
        } else {
          multilineBuffer += (multilineBuffer ? '\n' : '') + input;
        }
        prompt();
        return;
      }

      // --- Check for multiline start ---
      if (input.trim().startsWith('"""') || input.trim().startsWith("'''")) {
        const rest = input.trim().slice(3);
        multilineBuffer = rest;
        console.log(colors.dim('  (multiline mode — end with """ or \'\'\')'));
        prompt();
        return;
      }

      const trimmed = input.trim();
      if (!trimmed) {
        prompt();
        return;
      }

      // --- Handle slash commands ---
      if (trimmed.startsWith('/')) {
        const handled = await handleCommand(trimmed, rl, agent, ask);
        if (handled === 'exit') return;
        if (handled === 'skill-executed') {
          // skill was run as a normal message — prompt already handled
        }
        prompt();
        return;
      }

      // --- Normal message ---
      await handleUserInput(trimmed, rl, agent);
      prompt();
    });
  };

  // Ctrl+C just exits the process (natural Windows behavior).
  // Use ESC to soft-interrupt during processing.

  prompt();
}

async function handleUserInput(input, rl, agent) {
  _isBusy = true;
  _aborted = false;

  // Create a cancel promise — ESC resolves this to win the race against agent.chat()
  const cancelPromise = new Promise(resolve => { _cancelResolve = resolve; });

  let spinner = null;
  let thinkingSpinner = null;
  let hasOutput = false;
  const startTime = Date.now();
  let tokenCount = 0;
  let streamStartTime = null;
  let verbIndex = Math.floor(Math.random() * THINKING_VERBS.length);

  function getVerb() {
    return THINKING_VERBS[verbIndex % THINKING_VERBS.length];
  }

  function buildThinkingText() {
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const verb = getVerb();
    let tokStr = '';
    if (streamStartTime && tokenCount > 0) {
      const streamElapsed = (Date.now() - streamStartTime) / 1000;
      const tps = streamElapsed > 0 ? (tokenCount / streamElapsed).toFixed(1) : '0.0';
      tokStr = colors.dim(` | ${tps} tok/s`);
    }
    return colors.dim(`${verb}...`) + tokStr + colors.dim(` | ${formatDuration(elapsed * 1000)}`) + '  ' + colors.status('esc to interrupt');
  }

  // Start spinner IMMEDIATELY so the user sees feedback right away
  thinkingSpinner = ora({
    text: buildThinkingText(),
    indent: 2,
  }).start();

  // Update spinner every second — cycle verb, update timer + token counter
  const thinkingInterval = setInterval(() => {
    if (thinkingSpinner) {
      verbIndex++;
      thinkingSpinner.text = buildThinkingText();
    } else {
      clearInterval(thinkingInterval);
    }
  }, 1000);

  try {
    await Promise.race([cancelPromise, agent.chat(input, {
      onToken: (count) => {
        if (!streamStartTime) streamStartTime = Date.now();
        tokenCount += count;
      },
      onText: (text) => {
        if (_aborted) return;
        if (thinkingSpinner) {
          thinkingSpinner.stop();
          thinkingSpinner = null;
        }
        if (spinner) {
          spinner.stop();
          spinner = null;
        }
        if (!hasOutput) {
          process.stdout.write('\n  ');
          hasOutput = true;
        }
        const formatted = text.replace(/\n/g, '\n  ');
        process.stdout.write(formatted);
      },
      onToolCall: (name, args) => {
        if (_aborted) return;
        if (thinkingSpinner) {
          thinkingSpinner.stop();
          thinkingSpinner = null;
        }
        if (spinner) spinner.stop();
        if (hasOutput) {
          process.stdout.write('\n');
          hasOutput = false;
        }
        console.log('\n  ' + formatToolCall(name, args));
        spinner = ora({
          text: colors.dim(`Running ${name}...`),
          indent: 2,
        }).start();
      },
      onToolResult: (name, result) => {
        if (_aborted) return;
        if (spinner) {
          spinner.succeed(colors.dim(`${name} done`));
          spinner = null;
        }
        const preview = result.split('\n').slice(0, 4).join('\n');
        console.log(colors.toolResult('  ' + truncate(preview, 300).replace(/\n/g, '\n  ')));
      },
      onError: (err) => {
        if (_aborted) return;
        if (thinkingSpinner) { thinkingSpinner.stop(); thinkingSpinner = null; }
        if (spinner) { spinner.fail('Error'); spinner = null; }
        console.log('\n  ' + colors.error(err));
      },
      onCompact: (before, after) => {
        if (_aborted) return;
        console.log(colors.compact(`\n  [Context compacted: ${before} messages → ${after} messages]`));
      },
      onThinking: (isThinking) => {
        if (_aborted) return;
        if (isThinking && !thinkingSpinner) {
          thinkingSpinner = ora({
            text: buildThinkingText(),
            indent: 2,
          }).start();
        } else if (!isThinking && thinkingSpinner) {
          thinkingSpinner.stop();
          thinkingSpinner = null;
        }
      },
    })]);
  } catch (err) {
    if (thinkingSpinner) { thinkingSpinner.stop(); thinkingSpinner = null; }
    if (spinner) { spinner.fail('Error'); spinner = null; }
    if (!_aborted) {
      console.log('\n  ' + colors.error(`Unexpected error: ${err.message}`));
    }
  }

  // Always clean up the timer and spinners
  clearInterval(thinkingInterval);
  if (thinkingSpinner) { thinkingSpinner.stop(); thinkingSpinner = null; }
  if (spinner) { spinner.stop(); spinner = null; }

  _cancelResolve = null;

  // If interrupted by ESC, show message and return — caller calls prompt()
  // Conversation history is preserved so the user can add context or redirect.
  if (_aborted) {
    _aborted = false;
    console.log(colors.warning('\n\n  Interrupted.'));
    console.log(colors.dim('  Add more context to redirect, or start a new request.\n'));
    return;
  }

  if (hasOutput) {
    process.stdout.write('\n');
  }

  _isBusy = false;

  const elapsed = Date.now() - startTime;
  const stats = agent.getStats();
  const tpsStr = streamStartTime && tokenCount > 0
    ? ` | ${(tokenCount / ((Date.now() - streamStartTime) / 1000)).toFixed(1)} tok/s`
    : '';
  console.log(colors.status(`\n  ${formatDuration(elapsed)} | context: ${contextBar(stats.pct)} | ${stats.messageCount} msgs | ${stats.totalToolCalls} tool calls${tpsStr}`));
  console.log();
}

async function handleCommand(cmd, rl, agent, ask) {
  const parts = cmd.split(/\s+/);
  const command = parts[0].toLowerCase();
  const args = parts.slice(1).join(' ');

  switch (command) {
    case '/exit':
    case '/quit':
      console.log(colors.dim('\n  Goodbye!\n'));
      process.exit(0);

    case '/clear':
      agent.clearHistory();
      console.log(colors.dim('  Conversation cleared.\n'));
      break;

    case '/help':
      printHelp();
      break;

    case '/plan': {
      const newMode = !getPlanMode();
      setPlanMode(newMode);
      agent.refreshSystemPrompt();
      if (newMode) {
        console.log(colors.plan('\n  PLAN MODE ON'));
        console.log(colors.dim('  The model will explore and plan without making changes.'));
        console.log(colors.dim('  File writes and state-changing commands are blocked.'));
        console.log(colors.dim('  Type /plan again to exit plan mode.\n'));
      } else {
        console.log(colors.success('\n  Plan mode OFF — normal operation resumed.\n'));
      }
      break;
    }

    case '/status':
    case '/stats': {
      const stats = agent.getStats();
      const config = getConfig();
      const skills = getAllSkills();
      const memStats = getMemoryStats();
      const memSummary = [
        memStats.projectExists ? `project: ${memStats.projectSize} chars` : null,
        memStats.globalExists ? `global: ${memStats.globalSize} chars` : null,
      ].filter(Boolean).join(', ') || 'none';
      console.log(`
  ${colors.header('Status')}
  Model:       ${config.model}
  Ollama:      ${config.ollamaUrl}
  Working dir: ${getWorkingDirectory()}
  Plan mode:   ${getPlanMode() ? colors.plan('ON') : 'off'}
  Context:     ${contextBar(stats.pct)} (${stats.used.toLocaleString()} / ${stats.max.toLocaleString()} tokens)
  Messages:    ${stats.messageCount}
  Tool calls:  ${stats.totalToolCalls}
  Turns:       ${stats.totalTurns}
  Skills:      ${skills.length} available
  Memory:      ${memSummary}
`);
      break;
    }

    case '/cd': {
      if (!args) {
        console.log(colors.dim(`  Current: ${getWorkingDirectory()}\n`));
        break;
      }
      const resolved = path.resolve(getWorkingDirectory(), args);
      if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
        setWorkingDirectory(resolved);
        agent.refreshSystemPrompt();
        console.log(colors.dim(`  Changed to: ${resolved}\n`));
      } else {
        console.log(colors.error(`  Directory not found: ${resolved}\n`));
      }
      break;
    }

    case '/save': {
      const messages = agent.getMessages();
      if (messages.length <= 1) {
        console.log(colors.dim('  Nothing to save.\n'));
        break;
      }
      const filepath = saveConversation(messages, args || null);
      console.log(colors.success(`  Conversation saved: ${filepath}\n`));
      break;
    }

    case '/load': {
      if (!args) {
        const convos = listConversations();
        if (convos.length === 0) {
          console.log(colors.dim('  No saved conversations.\n'));
        } else {
          console.log(colors.header('\n  Saved conversations:'));
          convos.forEach((c, i) => {
            console.log(colors.dim(`  ${i + 1}. ${c.filename} (${c.messageCount} messages, ${c.savedAt})`));
          });
          console.log(colors.dim('\n  Use /load <number> or /load <name> to load one.\n'));
        }
        break;
      }
      const loaded = loadConversation(args);
      if (loaded) {
        agent.setMessages(loaded);
        console.log(colors.success(`  Conversation loaded (${loaded.length} messages).\n`));
      } else {
        console.log(colors.error(`  Conversation not found: ${args}\n`));
      }
      break;
    }

    case '/compact': {
      const messages = agent.getMessages();
      const { compactMessages } = await import('./context.js');
      const before = messages.length;
      const compacted = compactMessages(messages);
      agent.setMessages(compacted);
      console.log(colors.compact(`  Compacted: ${before} messages → ${compacted.length} messages\n`));
      break;
    }

    case '/model': {
      if (!args) {
        console.log(colors.dim(`  Current model: ${getConfig().model}\n`));
        break;
      }
      saveConfig({ model: args });
      agent.refreshSystemPrompt();
      console.log(colors.success(`  Model changed to: ${args}\n`));
      break;
    }

    case '/config': {
      const config = getConfig();
      console.log(colors.header('\n  Configuration:'));
      for (const [key, value] of Object.entries(config)) {
        console.log(colors.dim(`  ${key}: ${JSON.stringify(value)}`));
      }
      console.log();
      break;
    }

    // ─── Memory commands ─────────────────────────────────────────

    case '/memory':
    case '/mem': {
      const subParts = args.split(/\s+/);
      const sub = subParts[0]?.toLowerCase() || 'show';

      switch (sub) {
        case 'show':
        case 'view':
        case '': {
          const { global, project } = loadAllMemory();
          if (!global && !project) {
            console.log(colors.dim('  No memory saved yet.'));
            console.log(colors.dim('  Tell the model to "save your state to memory" or use the save_memory tool.\n'));
          } else {
            if (project) {
              console.log(colors.header('\n  Project Memory'));
              console.log('  ' + project.replace(/\n/g, '\n  '));
            }
            if (global) {
              console.log(colors.header('\n  Global Memory'));
              console.log('  ' + global.replace(/\n/g, '\n  '));
            }
            console.log();
          }
          break;
        }

        case 'status':
        case 'stats': {
          const stats = getMemoryStats();
          console.log(`
  ${colors.header('Memory Status')}
  Project: ${stats.projectExists ? colors.success(`${stats.projectSize} chars`) : colors.dim('(none)')}
           ${colors.dim(stats.projectPath)}
  Global:  ${stats.globalExists ? colors.success(`${stats.globalSize} chars`) : colors.dim('(none)')}
           ${colors.dim(stats.globalPath)}
`);
          break;
        }

        case 'clear': {
          const scope = subParts[1]?.toLowerCase();
          if (scope === 'global') {
            const confirm = await ask('Clear global memory? This affects all projects. (y/N)');
            if (confirm.toLowerCase() === 'y') {
              clearGlobalMemory();
              agent.refreshSystemPrompt();
              console.log(colors.success('  Global memory cleared.\n'));
            } else {
              console.log(colors.dim('  Cancelled.\n'));
            }
          } else if (scope === 'project') {
            const confirm = await ask('Clear project memory? (y/N)');
            if (confirm.toLowerCase() === 'y') {
              clearProjectMemory();
              agent.refreshSystemPrompt();
              console.log(colors.success('  Project memory cleared.\n'));
            } else {
              console.log(colors.dim('  Cancelled.\n'));
            }
          } else if (scope === 'all') {
            const confirm = await ask('Clear ALL memory (project + global)? (y/N)');
            if (confirm.toLowerCase() === 'y') {
              clearProjectMemory();
              clearGlobalMemory();
              agent.refreshSystemPrompt();
              console.log(colors.success('  All memory cleared.\n'));
            } else {
              console.log(colors.dim('  Cancelled.\n'));
            }
          } else {
            console.log(colors.error('  Usage: /memory clear <project|global|all>\n'));
          }
          break;
        }

        default:
          console.log(colors.error(`  Unknown memory command: ${sub}`));
          console.log(colors.dim('  Available: show, status, clear <project|global|all>\n'));
          break;
      }
      break;
    }

    // ─── Skill commands ──────────────────────────────────────────

    case '/skill':
    case '/skills': {
      const subParts = args.split(/\s+/);
      const sub = subParts[0]?.toLowerCase() || 'list';
      const subArgs = subParts.slice(1).join(' ');

      switch (sub) {
        case 'list':
        case 'ls':
          printSkillList();
          break;

        case 'show':
        case 'view': {
          if (!subArgs) {
            console.log(colors.error('  Usage: /skill show <name>\n'));
            break;
          }
          const skill = getSkill(subArgs);
          if (!skill) {
            console.log(colors.error(`  Skill not found: ${subArgs}\n`));
          } else {
            printSkillDetail(skill);
          }
          break;
        }

        case 'create':
        case 'new':
        case 'add': {
          await createSkillInteractive(ask, subArgs);
          break;
        }

        case 'edit': {
          if (!subArgs) {
            console.log(colors.error('  Usage: /skill edit <name>\n'));
            break;
          }
          await editSkillInteractive(ask, subArgs);
          break;
        }

        case 'delete':
        case 'rm':
        case 'remove': {
          if (!subArgs) {
            console.log(colors.error('  Usage: /skill delete <name>\n'));
            break;
          }
          const existing = getSkill(subArgs);
          if (!existing) {
            console.log(colors.error(`  Skill not found: ${subArgs}\n`));
          } else if (existing.source === 'built-in') {
            console.log(colors.error(`  Cannot delete built-in skill "${subArgs}". Create a user override instead.\n`));
          } else {
            const confirm = await ask(`Delete ${existing.source} skill "${subArgs}"? (y/N)`);
            if (confirm.toLowerCase() === 'y') {
              deleteSkill(subArgs, existing.source);
              console.log(colors.success(`  Skill "${subArgs}" deleted.\n`));
            } else {
              console.log(colors.dim('  Cancelled.\n'));
            }
          }
          break;
        }

        case 'export': {
          if (!subArgs) {
            console.log(colors.error('  Usage: /skill export <name>\n'));
            break;
          }
          const skill = getSkill(subArgs);
          if (!skill) {
            console.log(colors.error(`  Skill not found: ${subArgs}\n`));
          } else {
            const json = JSON.stringify({ name: skill.name, description: skill.description, args: skill.args, prompt: skill.prompt }, null, 2);
            console.log(colors.header(`\n  Skill: ${skill.name}`));
            console.log(colors.dim('  Copy this JSON to share or import:\n'));
            console.log('  ' + json.replace(/\n/g, '\n  '));
            console.log();
          }
          break;
        }

        case 'import': {
          console.log(colors.dim('  Paste the skill JSON, then enter """ to finish:'));
          // This will be handled naturally by multiline mode
          console.log(colors.dim('  (Use """ to start and end the JSON block, or /skill create for interactive mode)\n'));
          break;
        }

        default:
          console.log(colors.error(`  Unknown skill command: ${sub}`));
          console.log(colors.dim('  Available: list, show, create, edit, delete, export\n'));
          break;
      }
      break;
    }

    // ─── Default: check for skill match ──────────────────────────
    default: {
      const match = matchSkillCommand(cmd);
      if (match) {
        const expanded = expandSkillPrompt(match.skill, match.args);
        console.log(colors.toolName(`\n  Running skill: /${match.skill.name}`));
        if (match.args) {
          console.log(colors.dim(`  Args: ${match.args}`));
        }
        console.log(colors.dim(`  ${match.skill.description}\n`));
        await handleUserInput(expanded, rl, agent);
        return 'skill-executed';
      }

      console.log(colors.error(`  Unknown command: ${command}`));
      console.log(colors.dim('  Type /help for commands or /skills to see available skills.\n'));
      break;
    }
  }
}

// ─── Skill interactive creation ──────────────────────────────────────

async function createSkillInteractive(ask, prefillName) {
  console.log(colors.header('\n  Create a new skill'));
  console.log(colors.dim('  Skills are reusable prompt templates invoked as /name.\n'));

  const name = prefillName || (await ask('Skill name (lowercase, no spaces):')).trim().toLowerCase().replace(/\s+/g, '-');
  if (!name) {
    console.log(colors.dim('  Cancelled.\n'));
    return;
  }

  const existing = getSkill(name);
  if (existing && existing.source === 'built-in') {
    console.log(colors.warning(`  "${name}" is a built-in skill. Your version will override it.\n`));
  } else if (existing) {
    const overwrite = await ask(`Skill "${name}" already exists. Overwrite? (y/N)`);
    if (overwrite.toLowerCase() !== 'y') {
      console.log(colors.dim('  Cancelled.\n'));
      return;
    }
  }

  const description = (await ask('Description (one line):')).trim();
  const argsHint = (await ask('Arguments hint (e.g., "<file>" or "[message]", or blank for none):')).trim();

  console.log(colors.dim('\n  Now enter the prompt template.'));
  console.log(colors.dim('  Use {{args}} where the user\'s arguments should go.'));
  console.log(colors.dim('  Use {{#if args}}...{{/if}} for conditional sections.'));
  console.log(colors.dim('  Use {{#if args}}...{{else}}...{{/if}} for if/else.'));
  console.log(colors.dim('  Type END on a line by itself when done.\n'));

  const promptLines = [];
  while (true) {
    const line = await ask('>');
    if (line.trim() === 'END') break;
    promptLines.push(line);
  }

  const promptText = promptLines.join('\n');
  if (!promptText.trim()) {
    console.log(colors.dim('  Empty prompt. Cancelled.\n'));
    return;
  }

  const scope = (await ask('Save as (u)ser skill or (p)roject skill? (u/p):')).trim().toLowerCase();
  const saveScope = scope === 'p' ? 'project' : 'user';

  const filepath = saveSkill({ name, description, args: argsHint, prompt: promptText }, saveScope);
  console.log(colors.success(`\n  Skill "/${name}" created!`));
  console.log(colors.dim(`  Saved to: ${filepath}`));
  console.log(colors.dim(`  Run it with: /${name}${argsHint ? ' ' + argsHint : ''}\n`));
}

async function editSkillInteractive(ask, name) {
  const existing = getSkill(name);
  if (!existing) {
    console.log(colors.error(`  Skill not found: ${name}\n`));
    return;
  }

  if (existing.source === 'built-in') {
    console.log(colors.warning(`  "${name}" is built-in. Editing will create a user override.\n`));
  }

  console.log(colors.header(`\n  Editing skill: /${name}`));
  console.log(colors.dim(`  Current description: ${existing.description || '(none)'}`));
  console.log(colors.dim(`  Current args: ${existing.args || '(none)'}`));
  console.log(colors.dim(`  Press Enter to keep current value.\n`));

  const newDesc = (await ask(`Description [${existing.description}]:`)).trim();
  const newArgs = (await ask(`Arguments [${existing.args}]:`)).trim();

  const editPrompt = await ask('Edit the prompt? (y/N):');
  let newPrompt = existing.prompt;

  if (editPrompt.toLowerCase() === 'y') {
    console.log(colors.dim('\n  Current prompt:'));
    console.log(colors.dim('  ' + existing.prompt.replace(/\n/g, '\n  ')));
    console.log(colors.dim('\n  Enter new prompt (type END on a line by itself when done):\n'));

    const lines = [];
    while (true) {
      const line = await ask('>');
      if (line.trim() === 'END') break;
      lines.push(line);
    }
    if (lines.length > 0) {
      newPrompt = lines.join('\n');
    }
  }

  const scope = existing.source === 'project' ? 'project' : 'user';
  const filepath = saveSkill({
    name,
    description: newDesc || existing.description,
    args: newArgs || existing.args,
    prompt: newPrompt,
  }, scope);

  console.log(colors.success(`\n  Skill "/${name}" updated!`));
  console.log(colors.dim(`  Saved to: ${filepath}\n`));
}

// ─── Display helpers ─────────────────────────────────────────────────

function printSkillList() {
  const skills = getAllSkills();
  if (skills.length === 0) {
    console.log(colors.dim('  No skills available.\n'));
    return;
  }

  console.log(colors.header('\n  Available Skills'));
  console.log(colors.dim('  Invoke any skill by typing /name [args]\n'));

  // Group by source
  const builtIn = skills.filter(s => s.source === 'built-in');
  const user = skills.filter(s => s.source === 'user');
  const project = skills.filter(s => s.source === 'project');

  if (builtIn.length > 0) {
    console.log(colors.dim('  Built-in:'));
    for (const s of builtIn) {
      const argHint = s.args ? ` ${colors.status(s.args)}` : '';
      console.log(`  ${colors.toolName('/' + s.name)}${argHint}  ${colors.dim(s.description)}`);
    }
  }

  if (user.length > 0) {
    console.log(colors.dim('\n  User:'));
    for (const s of user) {
      const argHint = s.args ? ` ${colors.status(s.args)}` : '';
      console.log(`  ${colors.toolName('/' + s.name)}${argHint}  ${colors.dim(s.description)}`);
    }
  }

  if (project.length > 0) {
    console.log(colors.dim('\n  Project:'));
    for (const s of project) {
      const argHint = s.args ? ` ${colors.status(s.args)}` : '';
      console.log(`  ${colors.toolName('/' + s.name)}${argHint}  ${colors.dim(s.description)}`);
    }
  }

  console.log(colors.dim('\n  Use /skill show <name> for details, /skill create to make a new one.\n'));
}

function printSkillDetail(skill) {
  console.log(`
  ${colors.header('/' + skill.name)} ${colors.status(`[${skill.source}]`)}
  ${skill.description || '(no description)'}
  ${skill.args ? colors.dim(`Arguments: ${skill.args}`) : colors.dim('No arguments')}

  ${colors.dim('Prompt template:')}
  ${colors.dim('─'.repeat(50))}
  ${skill.prompt.replace(/\n/g, '\n  ')}
  ${colors.dim('─'.repeat(50))}
`);
}

function printHelp() {
  console.log(`
  ${colors.header('Commands')}
  ${colors.toolName('/help')}              Show this help
  ${colors.toolName('/exit')}              Exit qwen-local
  ${colors.toolName('/clear')}             Clear conversation history
  ${colors.toolName('/plan')}              Toggle plan mode (explore without changes)
  ${colors.toolName('/status')}            Show session status (tokens, model, etc.)
  ${colors.toolName('/cd <dir>')}          Change working directory
  ${colors.toolName('/save [name]')}       Save conversation to disk
  ${colors.toolName('/load [name]')}       Load a saved conversation
  ${colors.toolName('/compact')}           Manually compact conversation history
  ${colors.toolName('/model <name>')}      Switch to a different Ollama model
  ${colors.toolName('/config')}            Show current configuration

  ${colors.header('Memory')}
  ${colors.toolName('/memory')}            Show saved memory (project + global)
  ${colors.toolName('/memory status')}     Show memory file locations and sizes
  ${colors.toolName('/memory clear <s>')}  Clear memory (project, global, or all)
  ${colors.dim('  Tell the model "save your state to memory" and it will persist')}
  ${colors.dim('  its context for future sessions.')}

  ${colors.header('Skills')}
  ${colors.toolName('/skills')}            List all available skills
  ${colors.toolName('/skill show <n>')}    Show a skill's details and prompt
  ${colors.toolName('/skill create')}      Create a new skill interactively
  ${colors.toolName('/skill edit <n>')}    Edit an existing skill
  ${colors.toolName('/skill delete <n>')}  Delete a user/project skill
  ${colors.toolName('/skill export <n>')}  Export a skill as JSON
  ${colors.toolName('/<skillname>')}       Run a skill (e.g. /commit, /test, /review)

  ${colors.header('Built-in Skills')}
  ${colors.toolName('/commit [msg]')}      Stage & commit with AI-generated message
  ${colors.toolName('/review [branch]')}   Review code changes
  ${colors.toolName('/test [cmd]')}        Run tests and fix failures
  ${colors.toolName('/explain <target>')}  Explain how code works
  ${colors.toolName('/fix <error>')}       Diagnose and fix a bug
  ${colors.toolName('/refactor <target>')} Refactor code
  ${colors.toolName('/deps')}              Analyze project dependencies
  ${colors.toolName('/init')}              Explore and summarize the project

  ${colors.header('Multiline Input')}
  ${colors.dim('Start with """ or \'\'\' and end with the same to send multiline text.')}

  ${colors.header('Creating Skills')}
  ${colors.dim('Skills are reusable prompt templates saved as slash commands.')}
  ${colors.dim('Use /skill create to make one interactively. Skills can live in:')}
  ${colors.dim('  ~/.qwen-local/skills/       (available everywhere)')}
  ${colors.dim('  .qwen-local/skills/         (project-specific, shareable via git)')}
  ${colors.dim('Use {{args}} in prompts for argument substitution.')}

  ${colors.header('Examples')}
  ${colors.dim('"List the files in this directory"')}
  ${colors.dim('"Read src/index.js and explain what it does"')}
  ${colors.dim('/commit Fixes auth token expiry bug')}
  ${colors.dim('/test npm run test:unit')}
  ${colors.dim('/explain src/auth/middleware.js')}
`);
}
