# The Cheshire Room

A single-page, browser-only Cheshire Cat chat. Serve this directory over localhost or HTTPS (not `file://`):

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open the page and select **Download model**. No build or backend is required.

## Deploy on GitHub Pages

1. In the repository's **Settings → Pages → Build and deployment**, select **GitHub Actions** as the source.
2. Commit these files and push them to `main`. The **Deploy GitHub Pages** workflow runs on each push to `main`; it can also be started from the Actions tab with **Run workflow**.
3. After the deployment job succeeds, open the URL reported by the `github-pages` environment. For this repository, the default project URL is `https://amsucf.github.io/SmallModelDemo/` (unless a custom domain is configured).

The workflow stages only `index.html` and `.nojekyll` into `_site` and uploads that directory. Tests, documentation, Git metadata, and model weights are excluded from the deployment artifact. There is no npm install or build step. The app works at a project subpath or domain root; no base URL changes are required. For branch-based Pages hosting instead, publish the repository root with `.nojekyll` present; use only one deployment method.

GitHub Pages provides HTTPS, which WebGPU requires. Pages does not provide configurable COOP/COEP response headers, so the app explicitly uses **single-threaded WASM** with its nested proxy disabled. Inference still runs in a dedicated worker to keep the interface responsive. The runtime binary URL is pinned to the same Transformers.js version and does not depend on the deployment path. No custom headers, server-side code, or API keys are needed.

Model files are fetched directly from Hugging Face when a visitor chooses **Download model**; they are not stored in Git or served by Pages. Keep the external asset hosts accessible. Browser support, available memory, and GPU capability still determine whether inference can run; WASM fallback can be slower. Browser caches are scoped to the site's origin, so changing domains may require a new download.

## Model and runtime

- Recommended minimum: [`onnx-community/SmolLM2-135M-Instruct`](https://huggingface.co/onnx-community/SmolLM2-135M-Instruct), using Transformers.js 3.8.1, `dtype: q4`.
- Budget **approximately 200 MB** for the Q4 ONNX model (which includes unquantized tensors), plus tokenizer and inference runtime files. This is an estimate, not a measured transfer guarantee; the UI shows bytes reported by the actual file downloads. Cache hits may require no network transfer. Budget additional working memory for inference.
- 135M is a practical minimum for a simple whimsical persona, not a guarantee of consistent roleplay or strong reasoning. The system prompt encourages brief, playful Cheshire Cat replies.
- A module Web Worker probes WebGPU and tries GPU initialization first. If the adapter or GPU initialization is unavailable, it loads the same model with WASM on the CPU. CPU generation can be slow.
- History sent to the model is limited to two completed exchanges plus the current message. User input is capped at 400 characters, retained assistant replies at 600 characters, and generation at 110 new tokens. New chat clears the visible log and model history. Chats are not persisted.
- Model assets use the browser Cache API. Storage eviction, private browsing, or clearing browser data may require downloading again. This is local inference after downloading, not a guarantee that reloading the app offline works: the CDN engine and fonts must still be available. Host/cache these assets yourself for fully offline app startup.

Network access is needed for the pinned Transformers.js module and ONNX runtime assets at `cdn.jsdelivr.net`, model/tokenizer downloads from `huggingface.co` and its redirected asset hosts, and optional Google Fonts (`fonts.googleapis.com`, `fonts.gstatic.com`). Fonts fall back to local serif/sans fonts. No prompt or conversation is transmitted by the app. The download providers receive ordinary asset requests.

## Validation

The browser smoke checks in `tests/smoke.cjs` use Playwright installed outside the checkout. Set `PLAYWRIGHT_MODULE` to the installed Playwright module path if it is not on Node's module path. By default, Playwright uses its installed Chromium; set `CHROMIUM_PATH` to use a system Chromium executable. Run the server above and execute `node tests/smoke.cjs`.

To verify the exact Pages artifact at a project subpath, run the same staging commands as the workflow, then serve it under a repository-named directory:

```sh
mkdir -p _site
cp index.html .nojekyll _site/
# From the parent directory, serve SmallModelDemo/_site/:
cd ..
python3 -m http.server 8001 --bind 127.0.0.1
```

In another terminal, from the repository:

```sh
TEST_BASE_URL=http://127.0.0.1:8001/SmallModelDemo/_site/ node tests/smoke.cjs
```

The checks fetch the served HTML, execute the real app worker with a mocked inference library, and cover GPU selection, both WASM fallback paths, header-free runtime configuration, progress, streaming, bounded history, safe text rendering, errors, reset, and mobile layout. They do not validate real inference. Real model loading requires access to Hugging Face and a browser with sufficient memory.
