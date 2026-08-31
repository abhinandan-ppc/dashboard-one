# Run Doc

## Reproduce Uncommitted Artifacts

This project is a static HTML dashboard — no build step or dependencies to install for preview.

- No `.env` files needed for local preview
- The `package.json` lists `bytez.js` as a dependency but it is not used by `AI-Chat.html`

## Run the Server

`AI-Chat.html` is a standalone HTML file that can be served directly:

```
# Using Python (simplest)
python -m http.server 8080

# Or using Node.js
npx serve .
```

The page loads `theme.css` from the same directory, so the server must be run from the project root.

For the Preview tab, use `register_preview` with the `htmlPath` pointing to `AI-Chat.html` — no server process needed.
