import { threadIdFromUrl } from "./lib/messages.js";

const t = (key) => chrome.i18n.getMessage(key);
const hint = document.getElementById("hint");
const button = document.getElementById("export");
button.textContent = t("popupExport");

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const threadId = tab?.url ? threadIdFromUrl(tab.url) : null;

hint.textContent = threadId ? t("popupHint") : t("popupNotThread");
button.disabled = !threadId;
button.addEventListener("click", async () => {
  const params = new URLSearchParams({ tab: String(tab.id), thread: threadId });
  await chrome.tabs.create({ url: `export.html?${params}` });
  window.close();
});
