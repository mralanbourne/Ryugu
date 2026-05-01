//===============
// RYUGU ENGINE - LOGIC & PIPELINE
//===============
const { addonBuilder } = require("stremio-addon-sdk");
const { getTrendingJav, searchJav } = require("./lib/tpdb");
const { searchSukebeiForJav } = require("./lib/sukebei");
const { checkRD, checkTorbox } = require("./lib/debrid");
const { extractTags, determineCensorshipStatus } = require("./lib/parser");

const manifest = {
    id: "org.community.ryugu",
    version: "3.1.0",
    name: "Ryugu PRO",
    description: "Semantic JAV Search (Genre/Actress/Title) + Debrid Support.",
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

builder.defineCatalogHandler(async ({ id, extra }) => {
    const ts = new Date().toISOString();
    console.log(`[${ts}] [CATALOG] Request: ${id} | Query: "${extra.search || 'TRENDING'}"`);
    const results = extra.search ? await searchJav(extra.search) : await getTrendingJav();
    return { metas: results };
});

builder.defineMetaHandler(async ({ id }) => {
    const query = id.replace("jav_", "");
    const results = await searchJav(query);
    return { meta: results[0] || null };
});

builder.defineStreamHandler(async ({ id, config }) => {
    const ts = new Date().toISOString();
    const userConfig = parseConfig(config);
    const javCode = id.replace("jav_", "").toUpperCase();
    const BASE_URL = (process.env.BASE_URL || "").replace(/\/+$/, "");

    console.log(`\n[${ts}] ========== [PIPELINE START] ==========`);
    console.log(`[${ts}] [CORE] Target ID: ${javCode}`);

    try {
        const torrents = await searchSukebeiForJav(javCode);
        if (!torrents.length) return { streams: [] };

        const hashes = torrents.map(t => t.hash);
        const [rdC, tbC] = await Promise.all([
            userConfig.rdKey ? checkRD(hashes, userConfig.rdKey) : Promise.resolve({}),
            userConfig.tbKey ? checkTorbox(hashes, userConfig.tbKey) : Promise.resolve({})
        ]);

        const streams = [];
        torrents.forEach(t => {
            const h = t.hash.toLowerCase();
            const { res, isVR } = extractTags(t.title);
            const censor = determineCensorshipStatus(t.title);

            if (userConfig.enableP2P) {
                streams.push({
                    name: `RYUGU [P2P]\n${res}`,
                    description: `${censor.label}${isVR ? " | VR" : ""}\n📄 ${t.title}\n💾 ${t.size} | 👥 ${t.seeders}`,
                    infoHash: t.hash,
                    sources: ["tracker:http://nyaa.tracker.wf:7777/announce", "dht:" + t.hash]
                });
            }

            if (rdC[h]) {
                streams.push({
                    name: `RYUGU [RD+]\n${res}`,
                    description: `${censor.label}\n⚡ CACHED\n📄 ${t.title}\n💾 ${t.size}`,
                    url: `${BASE_URL}/resolve/realdebrid/${userConfig.rdKey}/${t.hash}`
                });
            }

            if (tbC[h]) {
                streams.push({
                    name: `RYUGU [TB+]\n${res}`,
                    description: `${censor.label}\n📦 CACHED\n📄 ${t.title}\n💾 ${t.size}`,
                    url: `${BASE_URL}/resolve/torbox/${userConfig.tbKey}/${t.hash}`
                });
            }
        });

        console.log(`[${ts}] [PIPELINE] Found ${streams.length} total streams.`);
        return { streams: streams.sort((a, b) => b.name.includes("+") - a.name.includes("+")) };
    } catch (err) {
        console.error(`[${ts}] [STREAM FATAL] ${err.message}`);
        return { streams: [] };
    }
});

module.exports = { addonInterface: builder.getInterface() };
