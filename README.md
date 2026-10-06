# Makey Sampler

A mobile-first audio sampler for touch devices and Makey Makey.

## Development

```sh
npm install
npm run dev
```

The site builds to static files in `dist/`.

## Cloudflare Workers

Connect this repository to Cloudflare Workers Builds with `main` as the production branch.

Use `npm run build` as the build command and `npx wrangler deploy` as the deploy command.
Enable preview builds for pull requests; Workers preview URLs replace Pages branch URLs.
After checking a preview, move any custom domain from Pages to the Worker and disable Pages deployments.

The generated service worker makes the application shell and built-in starter sounds available offline after one successful visit.

## Browser support

Android Chrome with USB OTG is the primary Makey Makey target.

iOS Safari and Chrome have best-effort external-keyboard support and full touch controls.

Inspired by [Makey Makey Apps](https://makeymakey.com/pages/plug-and-play-makey-makey-apps).
