// Runs in Instagram's own JS world at document_start, before the web app
// grabs fetch/XHR. It only copies GraphQL bodies that carry Direct messages
// into window.__reelsterBodies; requests and responses pass through untouched.
// The export page drains that buffer with chrome.scripting.
(() => {
  if (window.__reelsterBodies) return;
  const bodies = (window.__reelsterBodies = []);
  const MAX_BODIES = 2000; // only drained during an export; cap memory otherwise

  const isGraphql = (url) => /\/(api\/)?graphql/.test(String(url));
  const keep = (text) => {
    if (typeof text !== "string" || !text.includes("slide_messages")) return;
    bodies.push(text);
    if (bodies.length > MAX_BODIES) bodies.shift();
  };

  const originalFetch = window.fetch;
  window.fetch = function (input, init) {
    const promise = originalFetch.apply(this, arguments);
    const url = input instanceof Request ? input.url : String(input);
    if (isGraphql(url)) promise.then((r) => r.clone().text()).then(keep, () => {});
    return promise;
  };

  const urls = new WeakMap();
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    urls.set(this, String(url));
    return originalOpen.apply(this, arguments);
  };
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function () {
    if (isGraphql(urls.get(this))) {
      this.addEventListener("load", () => {
        if (this.responseType === "" || this.responseType === "text") keep(this.responseText);
        else if (this.responseType === "json") keep(JSON.stringify(this.response));
      });
    }
    return originalSend.apply(this, arguments);
  };
})();
