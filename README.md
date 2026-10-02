# Durger King Telegram Mini App

A React + Vite food-ordering demo inspired by the Telegram Mini App references. It includes category filters, a nine-item menu, quantity controls, an order summary, and a simulated checkout. It has no backend: orders are not sent and no payment is processed.

## Run locally

```sh
npm install
npm run dev
```

Open the local URL printed by Vite to try the menu in a browser. The Telegram WebApp script is included in `index.html`, and the app calls `ready()` and `expand()` when launched inside Telegram. No bot token belongs in this frontend.

## Build

```sh
npm run build
```

Vite writes the static site to `dist/`.

## Deploy with GitHub Pages

1. Create a GitHub repository named `durger-king-mini-app` and push this project to its `main` branch.
2. In the repository, open **Settings > Pages** and set the source to **GitHub Actions**.
3. The workflow in `.github/workflows/deploy.yml` builds and publishes the site on each push to `main`.
4. After the workflow succeeds, the site is available at `https://<github-username>.github.io/durger-king-mini-app/`.
5. Register that HTTPS URL for the bot's Mini App with BotFather. Share the Mini App link BotFather provides, not the GitHub repository URL.

The Vite build automatically uses the repository subpath on GitHub Actions. A `t.me/+...` invite link opens a Telegram group; it is not the app URL.
