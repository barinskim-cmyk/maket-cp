# Error Telemetry

Auto-collected client-side JS errors land in Supabase table `public.client_errors`.
The collector lives in `v2/frontend/js/error-reporter.js` and is loaded **before** every
other script in `v2/frontend/index.html` so it can catch load-time errors in the rest
of the bundle too.

## Why

Маша наблюдает баги при тестировании (Cyrillic encoding, hide-verified shared state, и т.д.).
Раньше нужно было опрашивать пользователя «что было? что показало?». Теперь:

- Любая uncaught JS-ошибка автоматически попадает в `client_errors`
- Любой unhandled Promise rejection — то же
- Контекст (project, user, role, share_token, breadcrumbs) — собирается без участия пользователя

## What gets collected

`client_errors` columns:

| column            | example                                                  | notes |
|-------------------|----------------------------------------------------------|-------|
| `ts`              | `2026-04-27 12:38:00+00`                                 | server-side default |
| `project_cloud_id`| `e1c0…`                                                  | from `getActiveProject()._cloudId` |
| `user_id`         | `f3d2…`                                                  | from `sbClient.auth.user()` |
| `user_role`       | `team` / `guest_share_link` / `guest`                    | derived |
| `share_token`     | `?share=…` query param                                   | only for guest_share_link |
| `page_url`        | `https://maket.app/?p=foo`                               | full URL incl. params |
| `error_type`      | `uncaught` / `unhandled_rejection` / `console_error` / `manual` | |
| `message`         | `TypeError: x.y is not a function`                       | trimmed at 2000 chars |
| `stack`           | full stack trace                                          | trimmed at 5000 chars |
| `user_agent`      | `Mozilla/5.0 …`                                           | |
| `screen_size`     | `1440x900`                                                | |
| `breadcrumbs`     | `[{ts, action}, …]`                                       | last 10 user actions |
| `hash`            | stable hash of `type|message|stack`                       | for client throttling |

## Reading errors (sample SQL)

Run via Supabase MCP `execute_sql` (service-role):

```sql
-- Last 20 errors
SELECT ts, error_type, message, user_role, page_url
FROM client_errors
ORDER BY ts DESC
LIMIT 20;

-- Errors from a specific project
SELECT ts, error_type, message, stack, breadcrumbs
FROM client_errors
WHERE project_cloud_id = 'e1c0…'
ORDER BY ts DESC
LIMIT 50;

-- Top recurring errors in last 24h
SELECT message, COUNT(*) AS cnt, MAX(ts) AS last_seen, MIN(ts) AS first_seen
FROM client_errors
WHERE ts > NOW() - INTERVAL '24 hours'
GROUP BY message
ORDER BY cnt DESC
LIMIT 20;

-- Errors hitting share-link guests only
SELECT ts, message, page_url, share_token
FROM client_errors
WHERE user_role = 'guest_share_link'
ORDER BY ts DESC
LIMIT 50;

-- One specific user's errors
SELECT ts, error_type, message, stack
FROM client_errors
WHERE user_id = 'f3d2…'
ORDER BY ts DESC;

-- Cyrillic-encoding-suspect rows
SELECT ts, message, page_url
FROM client_errors
WHERE message ILIKE '%encod%' OR message ~ '[А-Яа-яЁё]'
ORDER BY ts DESC;
```

## Adding context: breadcrumbs

The reporter exposes `window.errPushBreadcrumb(action)`. Call it from app code at points
where you'd want context for a future bug report. Last 10 are attached to every error.

```js
errPushBreadcrumb('clicked Save in cards modal');
errPushBreadcrumb('selected project ' + project.name);
errPushBreadcrumb('opened share modal, token=' + token);
```

The first breadcrumb is always `page_load` and is added by the reporter itself.

## Manual reporting

```js
// e.g. inside a try/catch where the error is "handled" but you still want telemetry
try {
  doRiskyThing();
} catch (e) {
  errReport(e.message, e.stack);
  // …show a friendly error to the user
}
```

## Verbose mode (forward `console.error`)

Append `?errors=verbose` to the URL. Every `console.error(...)` call is also forwarded
to `client_errors` as `error_type='console_error'`. Useful when chasing a specific
intermittent bug.

```
https://barinskim-cmyk.github.io/maket-cp/v2/frontend/?errors=verbose
```

Off by default — too noisy.

## Throttling / dedup

Each error gets a `hash = hash(type|message|stack)`. The reporter throttles identical
hashes to once per 5 minutes per page session. Repeated firings of the same error in a
loop won't drown the table.

## RLS / Security

- `INSERT` is allowed for `public` (anon) — so the unauthenticated and share-link guests
  can write too.
- No `SELECT` policy → `service_role` only. Read via Supabase MCP `execute_sql`, the
  Supabase Studio, or a service-role-authenticated server.
- Anon key is embedded in `error-reporter.js`. That's fine: the only thing it grants is
  inserting into `client_errors` (the policy enforces this).

## Operational notes

- **No cleanup job yet.** Table grows ~unbounded. When it gets noisy add a cron:
  `DELETE FROM client_errors WHERE ts < NOW() - INTERVAL '90 days';`
- **No alerting yet.** If you want Slack pings on new error patterns, add an Edge
  Function on a cron checking `MAX(ts) > last_seen` per hash.
- **No source-map upload.** Stacks reference minified bundle line/col when applicable;
  fine for current setup since v2/frontend isn't minified.

## Files

- `v2/frontend/js/error-reporter.js` — the collector
- `v2/frontend/index.html` — script tag added above all other scripts
- Migration `032_client_errors` — schema + RLS

## Test recipes

Open the app in any browser, then in DevTools console:

```js
throw new Error('test telemetry uncaught');
Promise.reject(new Error('test telemetry rejection'));
errReport('test manual', new Error('manual stack').stack);
```

Then:

```sql
SELECT * FROM client_errors ORDER BY ts DESC LIMIT 5;
```
