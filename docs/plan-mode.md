# Plan Mode

Plan mode lets the model explore your codebase and design an approach **without making any changes**. It's like saying "look but don't touch."

---

## Why Plan Mode?

Sometimes you want to think before you act. Maybe you're:

- **Exploring a new codebase** you just cloned and want to understand
- **Planning a big refactor** and want to see the blast radius before committing
- **Unsure about an approach** and want the model to propose options
- **Reviewing existing code** and want analysis without modifications

Plan mode gives you the model's full intelligence for reading and reasoning, while guaranteeing it won't change a single file.

---

## How to Use It

Toggle plan mode with `/plan`:

```
  myproject > /plan

  PLAN MODE ON
  The model will explore and plan without making changes.
  File writes and state-changing commands are blocked.
  Type /plan again to exit plan mode.
```

Your prompt changes to show you're in plan mode:

```
  myproject [PLAN]  > How is the database layer organized?
```

When you're done exploring, toggle it off:

```
  myproject [PLAN]  > /plan

  Plan mode OFF — normal operation resumed.

  myproject > Go ahead and implement the plan you described.
```

---

## What's Allowed

### In plan mode (read-only):

| Action | Allowed? |
|--------|----------|
| `read_file` | Yes |
| `list_files` | Yes |
| `search_files` | Yes |
| `find_files` | Yes |
| `run_command` with `git status` | Yes |
| `run_command` with `git log` | Yes |
| `run_command` with `git diff` | Yes |
| `run_command` with `npm list` | Yes |
| `run_command` with `ls`, `cat`, `head` | Yes |

### Blocked in plan mode:

| Action | Blocked? |
|--------|----------|
| `write_file` | BLOCKED |
| `edit_file` | BLOCKED |
| `run_command` with `git commit` | BLOCKED |
| `run_command` with `npm install` | BLOCKED |
| `run_command` with `rm`, `mkdir` | BLOCKED |
| Any state-modifying command | BLOCKED |

When something is blocked, the model gets a clear message:

```
BLOCKED: Plan mode is active. File modifications are not allowed.
Use /plan to exit plan mode first.
```

The model sees this and adjusts — it'll describe what it *would* do instead of doing it.

---

## Example: Planning a Feature

```
  myproject [PLAN]  > I want to add WebSocket support for real-time notifications.
                      Explore the codebase and tell me how you'd approach it.

  > list_files recursive=true
  ✔ list_files done

  > read_file path=src/server.js
  ✔ read_file done

  > read_file path=package.json
  ✔ read_file done

  > search_files pattern=socket|websocket|ws
  ✔ search_files done

  > read_file path=src/routes/notifications.js
  ✔ read_file done

  Here's my analysis and plan:

  **Current state:**
  - Express server on port 3000 with REST API
  - Notifications are polled via GET /api/notifications
  - No existing WebSocket infrastructure

  **Proposed approach:**

  1. Add `ws` package (lightweight, no Socket.IO overhead)
  2. Create `src/websocket.js`:
     - Attach WS server to existing HTTP server
     - Handle auth via query param token (reuse existing JWT)
     - Channel system: subscribe/unsubscribe per resource
  3. Modify `src/server.js`:
     - Import and initialize WS after HTTP server starts
  4. Modify `src/services/notification-service.js`:
     - Add broadcast function alongside existing DB insert
  5. Update `src/routes/notifications.js`:
     - Keep REST endpoint for history, add WS for real-time

  **Trade-offs:**
  - `ws` vs `Socket.IO`: ws is lighter (no fallbacks), but no
    auto-reconnect on client. Fine for modern browsers.
  - Auth: Query param token is simpler than handshake auth but
    the token appears in server logs. Consider middleware auth instead.

  **Files to create:** 1 (websocket.js)
  **Files to modify:** 3 (server.js, notification-service.js, package.json)
  **Estimated scope:** Medium

  Ready to implement? Type /plan to exit plan mode and I'll start.
```

---

## Tips

- **Start complex tasks in plan mode.** It's faster to course-correct a plan than to undo code changes.
- **The model's plan is its context.** When you exit plan mode, the model remembers everything it explored. It can reference files it read and jump straight into implementation.
- **Use plan mode for code review.** Ask it to review a file or module — it'll read everything and give feedback without changing anything.
- **Combine with `/save`.** After a good planning session, `/save` the conversation. You can `/load` it later and pick up where you left off.
