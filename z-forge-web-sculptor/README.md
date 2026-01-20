<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1e-veHEGrLzmqF-0cavDhZFsQVXBCyzr5

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Deploy / test on a cloud host

This project is a Vite + React app. For cloud testing you must deploy the **built output** (the `dist/` folder).

**Build command**

`npm ci && npm run build`

**Publish / output directory**

`dist`

**Environment variable**

Set `GEMINI_API_KEY` in your cloud host settings (or create a `.env.local` when building locally).

**If your cloud host runs a web service (Node) instead of static hosting**

Use:

`npm ci && npm run build && npm run start`

and make sure your host provides the `PORT` environment variable.

### Note about @/ imports

Some templates use a TypeScript path alias like `@/App`. The browser can't resolve that when you serve source files.
This repo uses **relative imports** (e.g. `./App`) and removes the `@/` alias to avoid the error:

> Failed to resolve module specifier "@/..."
