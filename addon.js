//===============
// RYUGU STREMIO ADDON - CORE LOGIC
// Angepasstes, cleanes UI-Rendering nach Yomi/Ryugu Standard.
//===============
const { addonBuilder } = require("stremio-addon-sdk");
const { getTrendingJav, searchJav } = require("./lib/tpdb");
const { searchSukebeiForJav } = require("./lib/sukebei");
const { checkRD, checkTorbox, getActiveRD, getActiveTorbox } = require("./lib/debrid");
const { extractJavCode, extractTags, parseSizeToBytes, determineCensorshipStatus, selectBestVideoFile } = require("./lib/parser");

let BASE_URL = process.env.BASE_URL || "http://127.0.0.1:7000";
BASE_URL = BASE_URL.replace(/\/+$/, "");
const INTERNAL_TB_KEY = process.env.INTERNAL_TORBOX_KEY || "";

function parseConfig(config) {
    let parsed = {};
    try {
        if (config && config.Ryugu) {
            let b64 = config.Ryugu.replace(/-/g, "+").replace(/_/g, "/");
            while (b64.length % 4) { b64 += "="; }
            parsed = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
        } else { parsed = config || {}; }
    } catch (err) {
        console.error("[CONFIG] Base64 Parse Error", err.message);
    }
    return parsed || {};
}

const manifest = {
    id: "org.community.ryugu",
    version: "3.0.0",
    name: "Ryugu PRO",
    logo: "https://dummyimage.com/600x900/1a1a1a/e91e63.png?text=RYUGU",
    description: "The ultimate JAV gateway. Based on Yomi Engine.",
    types: ["movie"],
    resources: [
        "catalog",
        { name: "meta", types: ["movie"], idPrefixes: ["jav_"] },
        { name: "stream", types: ["movie"], idPrefixes: ["jav_"] }
    ],
    catalogs: [
        { id: "jav_trending", type: "movie", name: "Ryugu Trending" },
        { id: "jav_search", type: "movie", name: "Ryugu Search", extra: [{ name: "search", isRequired: true }] }
    ],
    config: [{ key: "Ryugu", type: "text", title: "Ryugu Internal Payload", required: false }],
    behaviorHints: { configurable: true, configurationRequired: true }
};

const builder = new addonBuilder(manifest);

builder.defineCatalogHandler(async ({ type, id, extra, config }) => {
    if (id === "jav_trending") {
        const metas = await getTrendingJav();
        return { metas: metas, cacheMaxAge: 43200 };
    }
    
    if (id === "jav_search" && extra.search) {
        const searchResults = await searchJav(extra.search);
        return { metas: searchResults, cacheMaxAge: 86400 };
    }
    
    return { metas: [] };
});

builder.defineMetaHandler(async ({ type, id, config }) => {
    if (!id.startsWith("jav_")) return Promise.resolve({ meta: null });
    
    const javCode = id.replace("jav_", "").toUpperCase();
    const searchResults = await searchJav(javCode);
    const exactMatch = searchResults.find(m => m.id === id);
    
    if (exactMatch) {
        return { meta: exactMatch, cacheMaxAge: 604800 };
    }
    
    const fallbackMeta = {
        id: id,
        type: "movie",
        name: javCode,
        poster: "https://dummyimage.com/600x900/1a1a1a/e91e63.png?text=" + encodeURIComponent(javCode),
        genres: ["JAV"]
    };
    return { meta: fallbackMeta, cacheMaxAge: 86400 };
});

builder.defineStreamHandler(async ({ type, id, config }) => {
    if (!id.startsWith("jav_")) return Promise.resolve({ streams: [] });
    
    try {
        const userConfig = parseConfig(config);
        const tbKeyToUse = userConfig.tbKey || INTERNAL_TB_KEY;
        
        if (!userConfig.rdKey && !tbKeyToUse && !userConfig.enableP2P) {
            console.log(`[PIPELINE] ABORT: Neither Debrid services nor P2P enabled.`);
            return { streams: [] };
        }
        
        const javCode = id.replace("jav_", "").toUpperCase();
        console.log(`\n========== [PIPELINE START] ==========`);
        console.log(`[PIPELINE] JAV ID: ${javCode}`);
        
        let torrents = await searchSukebeiForJav(javCode);
        console.log(`[PIPELINE] Raw Torrents: ${torrents.length}`);
        
        const allowedResolutions = Array.isArray(userConfig.resolutions) && userConfig.resolutions.length > 0 
            ? userConfig.resolutions 
            : ["8K", "4K", "2K", "1080p", "720p", "480p", "SD"];
            
        let validTorrents = torrents.filter(t => {
            const bytes = parseSizeToBytes(t.size);
            if (bytes < 100 * 1024 * 1024 || bytes > 30 * 1024 * 1024 * 1024) return false;
            
            const { res } = extractTags(t.title);
            if (!allowedResolutions.includes(res)) return false;
            
            const cleanTitle = t.title.replace(/_/g, "-").toUpperCase();
            if (!cleanTitle.includes(javCode)) return false;
            
            return true;
        });
        
        if (!validTorrents.length) {
            console.log(`[PIPELINE] End: Zero torrents left after filter.`);
            return { streams: [], cacheMaxAge: 60 };
        }
        
        const uniqueTorrents = new Map();
        validTorrents.forEach(t => uniqueTorrents.set(t.hash, t));
        validTorrents = Array.from(uniqueTorrents.values());
        const hashes = validTorrents.map(t => t.hash);
        
        console.log(`[PIPELINE] Starting Debrid query for ${hashes.length} hashes...`);
        const [rdC, tbC, rdA, tbA] = await Promise.all([
            userConfig.rdKey ? checkRD(hashes, userConfig.rdKey).catch(() => ({})) : Promise.resolve({}),
            tbKeyToUse ? checkTorbox(hashes, tbKeyToUse).catch(() => ({})) : Promise.resolve({}),
            userConfig.rdKey ? getActiveRD(userConfig.rdKey).catch(() => ({})) : Promise.resolve({}),
            userConfig.tbKey ? getActiveTorbox(userConfig.tbKey).catch(() => ({})) : Promise.resolve({})
        ]);
        
        const streams = [];
        
        validTorrents.forEach(t => {
            const hashLow = t.hash.toLowerCase();
            const filesRD = rdC[hashLow]; const progRD = rdA[hashLow];
            const filesTB = tbC[hashLow]; const progTB = tbA[hashLow];
            
            const censorData = determineCensorshipStatus(t.title);
            const { res, isVR } = extractTags(t.title);
            const bytes = parseSizeToBytes(t.size);
            const seeders = t.seeders || 0;
            const vrTag = isVR ? " | VR" : "";
            
            // Cleanes Layout wie im Screenshot
            
            if (userConfig.enableP2P) {
                streams.push({
                    name: `RYUGU [P2P]\n${res}`,
                    description: `${censorData.label.trim().toUpperCase()}${vrTag}\nP2P\n${t.title}\n${t.size} | ${seeders} Seeds`,
                    infoHash: t.hash,
                    sources: [
                        "tracker:http://nyaa.tracker.wf:7777/announce",
                        "tracker:udp://open.stealth.si:80/announce",
                        "tracker:udp://tracker.opentrackr.org:1337/announce",
                        "tracker:udp://exodus.desync.com:6969/announce",
                        "dht:" + t.hash
                    ],
                    behaviorHints: { bingeGroup: "p2p_" + t.hash },
                    _bytes: bytes, _isCached: false, _res: res, _prog: 0, _seeders: seeders, _isUncensored: censorData.isUncensored
                });
            }
            
            if (userConfig.rdKey) {
                const isCached = filesRD && filesRD.length > 0;
                let streamStatus = "Download";
                let uiName = `RYUGU [RD]`;
                
                if (isCached) {
                    uiName = `RYUGU [RD+]`; streamStatus = "Cached";
                } else if (progRD !== undefined && progRD < 100) {
                    uiName = `RYUGU [${progRD}% RD]`; streamStatus = `${progRD}% Downloading`;
                }
                
                if (!userConfig.hideUncached || isCached) {
                    streams.push({
                        name: `${uiName}\n${res}`,
                        description: `${censorData.label.trim().toUpperCase()}${vrTag}\n${streamStatus}\n${t.title}\n${t.size} | ${seeders} Seeds`,
                        url: BASE_URL + "/resolve/realdebrid/" + userConfig.rdKey + "/" + t.hash + "/1",
                        behaviorHints: { bingeGroup: (isCached ? "rd_" : "dl_") + t.hash, notWebReady: !isCached },
                        _bytes: bytes, _isCached: isCached, _res: res, _prog: progRD || 0, _seeders: seeders, _isUncensored: censorData.isUncensored
                    });
                }
            }
            
            if (userConfig.tbKey) {
                const isCached = filesTB && filesTB.length > 0;
                let streamStatus = "Download";
                let uiName = `RYUGU [TB]`;
                
                if (isCached) {
                    uiName = `RYUGU [TB+]`; streamStatus = "Cached";
                } else if (progTB !== undefined && progTB < 100) {
                    uiName = `RYUGU [${progTB}% TB]`; streamStatus = `${progTB}% Downloading`;
                }
                
                if (!userConfig.hideUncached || isCached) {
                    streams.push({
                        name: `${uiName}\n${res}`,
                        description: `${censorData.label.trim().toUpperCase()}${vrTag}\n${streamStatus}\n${t.title}\n${t.size} | ${seeders} Seeds`,
                        url: BASE_URL + "/resolve/torbox/" + userConfig.tbKey + "/" + t.hash + "/1",
                        behaviorHints: { bingeGroup: (isCached ? "tb_" : "dl_") + t.hash, notWebReady: !isCached },
                        _bytes: bytes, _isCached: isCached, _res: res, _prog: progTB || 0, _seeders: seeders, _isUncensored: censorData.isUncensored
                    });
                }
            }
        });
        
        return { streams: streams.sort((a, b) => {
            const aUncen = a._isUncensored ? 1 : 0; const bUncen = b._isUncensored ? 1 : 0;
            if (aUncen !== bUncen) return bUncen - aUncen;
            
            if (a._prog > b._prog) return -1;
            if (a._isCached !== b._isCached) return b._isCached ? 1 : -1;
            if (!a._isCached && !b._isCached) { if (b._seeders !== a._seeders) return b._seeders - a._seeders; }
            
            return b._bytes - a._bytes;
        }), cacheMaxAge: 3600 };
        
    } catch (err) {
        console.error(`[PIPELINE] FATAL ERROR:`, err.message); 
        return { streams: [] };
    }
});

module.exports = { addonInterface: builder.getInterface(), manifest, parseConfig };