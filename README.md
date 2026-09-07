# precept

> [!WARNING]
> This was fully vibe coded!

A browser tool for designing color palettes by optimization.
Live at [zkingston.com/precept](https://zkingston.com/precept/).

[about.md](src/about.md) explains the tool, [formulation.md](src/formulation.md)
defines the optimizer's terms and constraints, and [spaces.md](src/spaces.md)
defines the color spaces.

## Run

```
npm install
npm run serve     # http://localhost:8080, rebuilt on every edit
npm run check     # self-check
npm run browser   # headless chromium checks
npm run build     # writes docs/
```

Pushes to `main` build and deploy to GitHub Pages.
