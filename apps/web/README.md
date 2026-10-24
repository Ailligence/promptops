# PromptOps web UI

The Angular interface of PromptOps. It runs inside the desktop shell
([`apps/desktop`](../desktop)): there is no separate web deployment.

## Develop

Start the app from `apps/desktop` with `npm run dev`: it serves this UI with
hot reload (`npm run start:desktop` on port 4200) and opens it in the native
window.

## Test

```bash
npx tsc --noEmit -p tsconfig.app.json   # type check
node --test test/*.test.cjs             # unit tests on plain logic
npx ng test --watch=false --browsers=ChromeHeadless   # component specs
```

## Build

`npm run build:desktop` regenerates the bundled icons and the third-party
notices, then builds the UI into `dist/`. The desktop build runs it for you.
