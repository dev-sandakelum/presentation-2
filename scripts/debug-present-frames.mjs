import { chromium } from "playwright-core";

const exe = "/home/z/.cache/ms-playwright/chromium_headless_shell-1200/chrome-headless-shell-linux64/chrome-headless-shell";
const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox", "--disable-gpu"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 577 } });
await page.goto("http://localhost:3000/?deck=slidesmith-theme-test&present=1", { waitUntil: "networkidle" });
await page.waitForTimeout(2500);

for (const frame of page.frames()) {
  if (frame === page.mainFrame()) continue;
  const info = await frame.evaluate(() => {
    const root = document.getElementById("root");
    return {
      url: location.pathname,
      rendered: window.__ssRendered,
      errors: window.__ssErrors?.slice(0, 3),
      rootChildren: root?.children?.length,
      rootStyle: root?.getAttribute("style"),
      htmlBg: getComputedStyle(document.documentElement).backgroundColor,
      bodyBg: getComputedStyle(document.body).backgroundColor,
      rootBg: root && getComputedStyle(root).backgroundColor,
      themeLen: document.getElementById("theme-style")?.textContent?.length,
      dataTheme: document.documentElement.dataset.theme,
      stageHtml: root?.firstElementChild?.outerHTML?.slice(0, 200),
    };
  }).catch((e) => ({ err: String(e).slice(0, 150) }));
  console.log(JSON.stringify(info, null, 1));
}
await browser.close();
