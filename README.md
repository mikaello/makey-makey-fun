# Makey Sampler

A mobile-first audio sampler for touch devices and Makey Makey.

## Development

```sh
npm install
npm run dev
```

The site builds to static files in `dist/`.

## Cloudflare Pages

Connect the repository using Cloudflare Pages pull-based deployment.

Use `npm run build` as the build command and `dist` as the output directory.

No Worker, environment variables, or server configuration are required.

The generated service worker makes the application shell and built-in starter sounds available offline after one successful visit.

## Browser support

Android Chrome with USB OTG is the primary Makey Makey target.

iOS Safari and Chrome have best-effort external-keyboard support and full touch controls.

Inspired by [Makey Makey Apps](https://makeymakey.com/pages/plug-and-play-makey-makey-apps).
