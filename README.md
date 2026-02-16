# 📺 CastDrop

Drop a video. Cast it to your TV.

Upload a local video file, get a temporary streaming URL, and cast it to your Chromecast in native quality. Videos are automatically deleted after 1 hour or when you close the page.

## How it works

1. Drag & drop (or select) a video file
2. File uploads to Cloudflare R2 (temporary storage)
3. Cast the video to your Chromecast using Chrome's built-in Cast or the Cast button
4. Video is deleted when you leave the page (or after 1 hour max)

## Tech Stack

- **Frontend:** React + TypeScript + Vite
- **Backend:** Cloudflare Worker + R2
- **Casting:** Google Cast SDK (default media receiver)

## Development

```bash
npm install
npm run dev
```

## Deployment

Set these GitHub repository secrets:
- `CLOUDFLARE_ACCOUNT`
- `CLOUDFLARE_KEY`

Push to `main` to trigger automatic deployment.

## License

MIT
