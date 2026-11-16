// Loads a JSON data file. The single-file build (tools/build-page.mjs) embeds every data
// file in window.__GAME_DATA__; otherwise the file is fetched next to index.html.

export async function loadJSON(path) {
  const embedded = globalThis.__GAME_DATA__;
  if (embedded && embedded[path]) return embedded[path];
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path} : ${response.status}`);
  return response.json();
}
