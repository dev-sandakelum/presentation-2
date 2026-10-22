# Chassé Studio — Web Asset Integration Contract

Version **1.4.0** · This web-side contract pairs with
`chasse-desktop/about/CONTRACT.md`.

## Desktop capability

The web client calls `{cmd:"hello"}` over `window.cefQuery`. Desktop asset
interception is available when `capabilities` contains `assetUrls`; the normal
desktop `fs` capability is also required to resolve a deck from the catalog.

## Canonical URL

`resolveAssetUrl(deckId, "assets/bg.png")` is the web app's store-aware asset
resolver. In a desktop session with `assetUrls`, it returns a same-origin path:

`/__chasse_files__/<percent-encoded-deck-id>/<percent-encoded-path-segments>`

Each path segment is separately passed through `encodeURIComponent`, preserving
spaces and Unicode names while retaining `/` as the path separator. Slide source
keeps portable paths such as `assets/bg.png`; StageFrame supplies the resolved
asset map/base for `<Img>`, CSS image URLs, backgrounds, overlays, thumbnails,
preloads and Present mode.

JCEF intercepts the virtual path before any network request. It streams bytes
from the catalog-approved deck folder, supports GET/HEAD, byte ranges, ETag and
Last-Modified, and sends `Cache-Control: no-cache` so replacements are visible.
The browser policy only needs same-origin `img-src 'self'`. No phone server
state, network port, custom scheme, token URL or blob URL is part of the normal
desktop path. Web/server mode continues to use `/api/assets/...`; browser-stored
decks continue to use their object/data URLs.

## Compatibility and uploads

If an older desktop bridge has `fs` but lacks `assetUrls`, the client requests
small image bytes through `fs.readAssetBase64` and creates a blob URL. The limit
is 8 MiB; larger files surface an update-desktop-app message. If the older build
does not implement the byte-read command, its bridge-issued `fs.fileUrl` is used
only for this compatibility fallback. It is never selected when `assetUrls` is
available.

Uploads use bounded bridge writes, not HTTP PUT:

1. `fs.beginAssetUpload({deck,path})` → `{uploadId}`
2. `fs.writeAssetChunk({uploadId,base64})` → `{size}` for each 256 KiB chunk
3. `fs.finishAssetUpload({uploadId})` → `{ok:true,size}`
4. `fs.abortAssetUpload({uploadId})` → `{ok:true}` on failure

Java writes to a same-folder temporary file, enforces the 256 MiB total limit,
revalidates the destination and atomically renames when complete.

## Failure contract

The intercepted request reports HTTP statuses and `X-Chasse-Error-Code`:

| HTTP | Code | Web presentation |
|---:|---|---|
| 403 | `FORBIDDEN` / `BAD_REQUEST` | Access denied or invalid asset path |
| 404 | `NOT_FOUND` | File not found |
| 405 / 416 | `BAD_REQUEST` | Unsupported request or invalid range |
| 500 | `IO_ERROR` | Read failed |

Image consumers must show a loading skeleton while resolving and, on `error`,
show the filename, a short reason and Retry. The failure is logged immediately.

The Java handler returns no resource for all non-virtual paths. It serves the
virtual path only when the request URL and initiating frame share the configured
trusted app origin (or the explicit localhost:3000 development origin). Other
origins receive 403. The deck/path is decoded segment by segment and confined
through Java's canonical path checks; traversal, reserved device names and
paths resolving outside the deck are rejected.
