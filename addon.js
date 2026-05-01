//===============
// RYUGU STREMIO ADDON - LOGIC & PIPELINE
//===============
const { addonBuilder } = require("stremio-addon-sdk");
const { getTrendingJav, searchJav } = require("./lib/tpdb");
const { searchSukebeiForJav } = require("./lib/sukebei");
const { checkRD, checkTorbox, getActiveRD, getActiveTorbox } = require("./lib/debrid");
const { extractTags, parseSizeToBytes, determineCensorshipStatus } = require("./lib/parser");

const manifest = {
    id: "org.community.ryugu",
    version: "3.1.0",
    name: "Ryugu PRO",
    description: "Semantic JAV Gateway with Debrid support.",
    types: ["movie"],
    resources: ["catalog", "meta", "stream"],
    catalogs: [
        { id: "jav_trending", type: "movie", name: "Ryugu Trending" },
        { id: "jav_search", type: "movie", name: "Ryugu Search", extra: [{ name: "search", isRequired: true }] }
    ],
    idPrefixes: ["jav_"]
};

const builder = new addonBuilder(manifest);

function parseConfig(config) {
    if (!config || !config.Ryugu) return {};
    try {
        const b64 = config.Ryugu.replace(/-/g, "+").replace(/_/g, "/");
        return JSON.parse(Buffer.from(b64, "base64").toString());
    } catch (e) { return {}; }
}

//===============
// CATALOG HANDLER (SEARCH & TRENDING)
//===============
builder.defineCatalogHandler(async ({ id, extra }) => {
    const ts = new Date().toISOString();
    console.log(`[${ts}] [CATALOG] Req: ${id} | Query: "${extra.search || 'TRENDING'}"`);
    
    if (id === "jav_search" && extra.search) {
        return { metas: await searchJav(extra.search) };
    }
    return { metas: await getTrendingJav() };
});

builder.defineMetaHandler(async ({ id }) => {
    const ts = new Date().toISOString();
    const cleanId = id.replace("jav_", "");
    console.log(`[${ts}] [META] Fetching for: ${cleanId}`);
    const results = await searchJav(cleanId);
    return { meta: results[0] || null };
});

//===============
// STREAM HANDLER (DEEP LOGGING PIPELINE)
//===============
builder.defineStreamHandler(async ({ id, config }) => {
    const ts = new Date().toISOString();
    const javCode = id.replace("jav_", "").toUpperCase();
    const userConfig = parseConfig(config);
    const BASE_URL = process.env.BASE_URL || "";

    console.log(`\n[${ts}] ========== [PIPELINE START] ==========`);
    console.log(`[${ts}] [CORE] Target: ${javCode}`);

    try {
        const torrents = await searchSukebeiForJav(javCode);
        console.log(`[${ts}] [SUKEBEI] Results: ${torrents.length}`);

        if (torrents.length === 0) return { streams: [] };

        const hashes = torrents.map(t => t.hash);
        
        // DEBRID CHECKS
        const [rdC, tbC] = await Promise.all([
            userConfig.rdKey ? checkRD(hashes, userConfig.rdKey) : Promise.resolve({}),
            userConfig.tbKey ? checkTorbox(hashes, userConfig.tbKey) : Promise.resolve({})
        ]);

        const streams = [];
        torrents.forEach(t => {
            const { res, isVR } = extractTags(t.title);
            const censor = determineCensorshipStatus(t.title);
            const isRD = rdC[t.hash.toLowerCase()];
            const isTB = tbC[t.hash.toLowerCase()];

            if (userConfig.enableP2P) {
                streams.push({
                    name: `RYUGU [P2P]\n${res}`,
                    description: `${censor.label}${isVR ? " | VR" : ""}\n📄 ${t.title}\n💾 ${t.size} | 👥 ${t.seeders}`,
                    infoHash: t.hash,
                    sources: ["tracker:http://nyaa.tracker.wf:7777/announce", "dht:" + t.hash]
                });
            }

            if (isRD) {
                streams.push({
                    name: `RYUGU [RD+]\n${res}`,
                    description: `${censor.label}\n⚡ CACHED\n📄 ${t.title}\n💾 ${t.size}`,
                    url: `${BASE_URL}/resolve/realdebrid/${userConfig.rdKey}/${t.hash}`
                });
            }
        });

        console.log(`[${ts}] [PIPELINE] Generated ${streams.length} streams.`);
        console.log(`[${ts}] ========== [PIPELINE END] ========== \n`);
        return { streams };
    } catch (err) {
        console.error(`[${ts}] [ERROR] ${err.message}`);
        return { streams: [] };
    }
});

module.exports = { addonInterface: builder.getInterface() };
