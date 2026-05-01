//===============
// RYUGU ADDON CORE - DEEP LOGGING
//===============
const { addonBuilder } = require("stremio-addon-sdk");
const { getTrendingJav, searchJav } = require("./lib/tpdb");
const { searchSukebeiForJav } = require("./lib/sukebei");
const { checkRD, checkTorbox, getActiveRD, getActiveTorbox } = require("./lib/debrid");
const { extractTags, parseSizeToBytes, determineCensorshipStatus } = require("./lib/parser");

// ... Manifest bleibt gleich wie vorher ...
const manifest = {
    id: "org.community.ryugu",
    version: "3.1.0",
    name: "Ryugu PRO (Deep Logs)",
    description: "Multi-Language & Genre Search Enabled.",
    types: ["movie"],
    resources: ["catalog", "meta", "stream"],
    catalogs: [
        { id: "jav_trending", type: "movie", name: "Ryugu Trending" },
        { id: "jav_search", type: "movie", name: "Ryugu Search", extra: [{ name: "search", isRequired: true }] }
    ],
    idPrefixes: ["jav_"]
};

const builder = new addonBuilder(manifest);

// CATALOG HANDLER (Suche)
builder.defineCatalogHandler(async ({ type, id, extra }) => {
    const ts = new Date().toISOString();
    console.log(`[${ts}] [CATALOG] Request for ID: ${id} | Search: "${extra.search || 'NONE'}"`);
    
    if (id === "jav_search" && extra.search) {
        const results = await searchJav(extra.search);
        return { metas: results };
    }
    if (id === "jav_trending") {
        return { metas: await getTrendingJav() };
    }
    return { metas: [] };
});

// STREAM HANDLER (Pipeline)
builder.defineStreamHandler(async ({ type, id, config }) => {
    const ts = new Date().toISOString();
    const javId = id.replace("jav_", "").toUpperCase();
    console.log(`\n[${ts}] ========== [PIPELINE START] ==========`);
    console.log(`[${ts}] Target JAV ID: ${javId}`);

    try {
        // ... (Config Parsing bleibt gleich) ...
        
        let torrents = await searchSukebeiForJav(javId);
        console.log(`[${ts}] [SUKEBEI] Found ${torrents.length} raw torrents.`);

        // ... (Filterung und Debrid-Check Logik bleibt, füge aber Logs hinzu) ...
        console.log(`[${ts}] [DEBRID] Checking cache for ${torrents.length} hashes...`);

        // ... (Stream Generation bleibt gleich) ...

        console.log(`[${ts}] ========== [PIPELINE END] ========== \n`);
        return { streams: [] /* Deine Stream-Liste hier */ };
    } catch (err) {
        console.error(`[${ts}] [PIPELINE FATAL] ${err.message}`);
        return { streams: [] };
    }
});

module.exports = { addonInterface: builder.getInterface() };
