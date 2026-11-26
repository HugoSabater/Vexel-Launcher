import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/600.css";
import "./styles.css";

const FALLBACK_VERSION = "v1.1.0";
const FALLBACK_DOWNLOAD_URL =
  "https://github.com/HugoSabater/Vexel-Launcher/releases/download/v1.1.0/Vexel.Launcher_1.1.0_x64-setup.exe";
const LATEST_RELEASE_API =
  "https://api.github.com/repos/HugoSabater/Vexel-Launcher/releases/latest";

function wireCopySha256() {
  const btn = document.getElementById("copy-sha256-btn");
  const hashEl = document.getElementById("sha256-value");
  const statusEl = document.getElementById("copy-sha256-label");
  if (!btn || !hashEl || !statusEl) return;

  btn.addEventListener("click", async () => {
    const hash = hashEl.textContent?.trim() ?? "";
    if (!hash) return;
    try {
      await navigator.clipboard.writeText(hash);
      statusEl.textContent = "Copiado";
      window.setTimeout(() => {
        statusEl.textContent = "Copiar SHA-256";
      }, 2000);
    } catch {
      statusEl.textContent = "Selecciona y copia";
    }
  });
}

async function resolveLatestRelease() {
  const downloadLinks = document.querySelectorAll("[data-download-cta]");
  const versionBadges = document.querySelectorAll("[data-release-version]");

  const applyUrl = (url, versionLabel) => {
    downloadLinks.forEach((el) => {
      if (el instanceof HTMLAnchorElement) {
        el.href = url;
      }
    });
    if (versionLabel) {
      versionBadges.forEach((el) => {
        el.textContent = versionLabel;
      });
    }
  };

  applyUrl(FALLBACK_DOWNLOAD_URL, FALLBACK_VERSION);

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 4000);
  try {
    const resp = await fetch(LATEST_RELEASE_API, {
      headers: { Accept: "application/vnd.github+json" },
      signal: controller.signal,
    });
    if (!resp.ok) return;
    const data = await resp.json();
    const assets = Array.isArray(data?.assets) ? data.assets : [];
    const exeAsset = assets.find(
      (a) =>
        typeof a?.name === "string" &&
        a.name.endsWith("-setup.exe") &&
        typeof a?.browser_download_url === "string" &&
        a.browser_download_url.startsWith(
          "https://github.com/HugoSabater/Vexel-Launcher/releases/download/",
        ),
    );
    const tag =
      typeof data?.tag_name === "string" && data.tag_name.trim()
        ? data.tag_name.trim()
        : FALLBACK_VERSION;
    if (exeAsset) {
      applyUrl(exeAsset.browser_download_url, tag);
    }
  } catch {
    // Silent fallback to v1.1.0 direct release URL
  } finally {
    window.clearTimeout(timer);
  }
}

wireCopySha256();
void resolveLatestRelease();
