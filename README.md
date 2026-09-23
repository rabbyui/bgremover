# Cutout — Free Background Remover

A remove.bg-style background remover that runs **entirely in the browser**. No
accounts, no uploads, no API keys: the AI model (ISNet via
[@imgly/background-removal](https://github.com/imgly/background-removal-js) +
onnxruntime-web) is downloaded once and cached, then every image is processed
on-device.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
```

Production build:

```bash
npm run build
npm run preview    # serve the dist/ folder
```

End-to-end smoke test (builds must be served first, uses your installed
Chrome headlessly — no accounts, no data sent anywhere):

```bash
npm test
```

> The app must be served over **http(s) or localhost** — opening `index.html`
> directly from disk (file://) will not work.

## Features

- Upload via click, drag & drop anywhere, clipboard paste (Ctrl/Cmd+V), or
  device camera on mobile
- Load images from a URL (the remote site must allow CORS)
- Sample images to try instantly
- Before/after split slider plus result/original toggle
- Transparent checkerboard or solid background colors (incl. custom color)
- Download PNG (transparent or flattened) and native share on mobile
- Installable PWA: works offline after first load, phone-app experience

## Privacy

Images never leave the device. The only network traffic is the one-time
download of the AI model from the imgly CDN and the app's own assets.

## Extras

- `index.html?image=<encoded-url>` auto-processes a remote image (must allow CORS)
- `npm run icons` regenerates the PWA icons (`scripts/gen-icons.mjs`, zero deps)

## Notes

-First run downloads ~95 MB (fp16 ISNet model + ONNX runtime) — cached by the
  browser afterward. On iOS this cache is best-effort and may be evicted sooner.
- Very old browsers without WebAssembly support are not supported.
