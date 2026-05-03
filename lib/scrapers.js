//===============
// RYUGU SCRAPERS (MULTI-SOURCE KASKADE)
// Inklusive ISP-Block-Guard, Fallback-Queries und BT4G (DHT).
//===============
const axios = require("axios");
const { XMLParser } = require("fast-xml-parser");
const cheerio = require("cheerio");
const http = require("http");
const https = require("https");

const searchCache = new Map();
const CACHE_TTL_MS = 1000 * 60 * 60;
const FLARESOLVERR_URL = process.env.FLARESOLVERR_URL || null;

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 15 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 15 });
const scraperClient = axios.create({ httpAgent, httpsAgent });

const parserConfig = {
    ignoreAttributes: false,
    attributeNamePrefix: "",
    processEntities: false
};

function decodeEntities(text) {
    if (!text) return "";
    return text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "\"");
}

function withTimeout(promise, ms) {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            reject(new Error("Timeout exceeded after " + ms + "ms"));
        }, ms);
    });
    promise.catch(() => {});
    return Promise.race([
        promise.finally(() => clearTimeout(timeoutId)),
        timeoutPromise
    ]);
}

async function solverRequest(url) {
    if (!FLARESOLVERR_URL) {
        const res = await scraperClient.get(url, {
            timeout: 8000,
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
        });
        return res.data;
    }
    try {
        const response = await scraperClient.post(FLARESOLVERR_URL, {
            "cmd": "request.get",
            "url": url,
            "maxTimeout": 12000
        }, { timeout: 18000 });
        return response.data?.solution?.response;
    } catch (e) {
        const fallback = await scraperClient.get(url, { timeout: 8000 });
        return fallback.data;
    }
}

//===============
// ISP BLOCK GUARD
// Verhindert, dass Sperrseiten lautlos als "0 Ergebnisse" gewertet werden.
//===============
function parseAndValidateRSS(data, sourceName) {
    if (!data || !data.includes("<rss")) {
        throw new Error(`Ungültige Antwort (Möglicher ISP-Block oder Cloudflare Captcha)`);
    }
    const parser = new XMLParser(parserConfig);
    const jsonObj = parser.parse(data);
    return jsonObj?.rss?.channel?.item ? (Array.isArray(jsonObj.rss.channel.item) ? jsonObj.rss.channel.item : [jsonObj.rss.channel.item]) : [];
}

async function searchSukebeiMain(query) {
    try {
        const url = `https://sukebei.nyaa.si/?page=rss&q=${encodeURIComponent(query)}&c=0_0&f=0`;
        const data = await solverRequest(url);
        const items = parseAndValidateRSS(data, "SukebeiMain");
        
        return items.map(item => ({
            title: decodeEntities(item.title) || "Unknown",
            hash: (item["nyaa:infoHash"] || "").toLowerCase(),
            seeders: parseInt(item["nyaa:seeders"], 10) || 0,
            size: item["nyaa:size"] || "Unknown"
        })).filter(i => i.hash && i.hash.length === 40);
    } catch(e) { throw new Error(`Sukebei Main: ${e.message}`); }
}

async function searchSukebeiMirror(query) {
    try {
        // Migration von iss.one auf nyaa.land
        const url = `https://sukebei.nyaa.land/?page=rss&q=${encodeURIComponent(query)}&c=0_0&f=0`;
        const data = await solverRequest(url);
        const items = parseAndValidateRSS(data, "SukebeiMirror");
        
        return items.map(item => ({
            title: decodeEntities(item.title) || "Unknown",
            hash: (item["nyaa:infoHash"] || "").toLowerCase(),
            seeders: parseInt(item["nyaa:seeders"], 10) || 0,
            size: item["nyaa:size"] || "Unknown"
        })).filter(i => i.hash && i.hash.length === 40);
    } catch(e) { throw new Error(`Sukebei Mirror: ${e.message}`); }
}

async function searchTokyoToshoAdult(query) {
    try {
        const url = `https://www.tokyotosho.info/rss.php?terms=${encodeURIComponent(query)}&type=9`;
        const res = await scraperClient.get(url, {
            timeout: 8000,
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
        });
        const items = parseAndValidateRSS(res.data, "TokyoTosho");
        
        return items.map(item => {
            let hash = "";
            const link = item.link || "";
            if (link.includes("btih:")) hash = link.split("btih:")[1].split("&")[0].toLowerCase();
            const sizeMatch = (item.description || "").match(/Size:\s*([\d.]+\s*[MGTK]?B)/i);
            return {
                title: decodeEntities(item.title) || "Unknown",
                hash: hash,
                seeders: 0,
                size: sizeMatch ? sizeMatch[1] : "Unknown"
            };
        }).filter(i => i.hash && i.hash.length === 40);
    } catch(e) { throw new Error(`TokyoTosho: ${e.message}`); }
}

//===============
// BT4G (DHT CRAWLER ERSATZ FÜR BTDIGG)
//===============
async function searchBT4G(query) {
    try {
        const url = `https://bt4gprx.com/search?q=${encodeURIComponent(query)}`;
        const data = await solverRequest(url);
        if (!data) return [];

        const $ = cheerio.load(data);
        const results = [];

        $("div.col.s12").each((i, el) => {
            if (i >= 20) return false;
            
            const anchor = $(el).find("a[href^='magnet:']");
            const magnetHref = anchor.attr("href");
            if (!magnetHref) return;

            const hashMatch = magnetHref.match(/urn:btih:([a-fA-F0-9]{40})/i);
            if (!hashMatch) return;

            const title = $(el).find("h5 a").first().text() || "Unknown";
            const sizeStr = $(el).find("span.cpill.yellow-pill").first().text() || "Unknown";

            results.push({
                title: decodeEntities(title.trim()),
                hash: hashMatch[1].toLowerCase(),
                seeders: 1, // Fallback-Cache Seed
                size: sizeStr.trim()
            });
        });

        return results;
    } catch(e) { throw new Error(`BT4G: ${e.message}`); }
}

async function executeKaskade(query) {
    const allTorrents = [];
    const trackers = [
        { name: "SukebeiMain", fn: searchSukebeiMain },
        { name: "SukebeiMirror", fn: searchSukebeiMirror },
        { name: "TokyoTosho", fn: searchTokyoToshoAdult },
        { name: "BT4GDHT", fn: searchBT4G }
    ];
    
    const MAX_TRACKER_TIME = 15000;
    const results = await Promise.allSettled(
        trackers.map(tracker => 
            withTimeout(tracker.fn(query), MAX_TRACKER_TIME)
                .then(res => ({ name: tracker.name, data: res }))
                .catch(err => { throw { name: tracker.name, error: err }; })
        )
    );

    for (const result of results) {
        if (result.status === "fulfilled" && result.value.data) {
            allTorrents.push(...result.value.data);
        } else if (result.status === "rejected") {
            console.log(`[SCRAPER ERROR] ${result.reason.name} fehlgeschlagen: ${result.reason.error.message}`);
        }
    }
    return allTorrents;
}

async function searchAllSources(title) {
    if (!title || title.trim().length < 2) return [];
    
    let query = title.replace(/\s+/g, " ").trim();
    const queryKey = query.toLowerCase();
    
    if (searchCache.has(queryKey)) {
        const item = searchCache.get(queryKey);
        if (item.expiresAt > Date.now()) return item.data;
    }
    
    console.log(`[SCRAPER] Suche gestartet für: "${query}"`);
    let allTorrents = await executeKaskade(query);
    
    // Fallback: Wenn JAV Code mit Bindestrich (300MIUM-168) keine Ergebnisse bringt, 
    // versuche es mit Leerzeichen (300MIUM 168)
    if (allTorrents.length === 0 && query.includes("-")) {
        const fallbackQuery = query.replace(/-/g, " ");
        console.log(`[SCRAPER] 0 Ergebnisse. Starte Fallback-Suche für: "${fallbackQuery}"`);
        allTorrents = await executeKaskade(fallbackQuery);
    }

    const uniqueTorrents = new Map();
    allTorrents.forEach(item => {
        if (!uniqueTorrents.has(item.hash) || item.seeders > uniqueTorrents.get(item.hash).seeders) {
            uniqueTorrents.set(item.hash, item);
        }
    });
    
    const finalResults = Array.from(uniqueTorrents.values()).sort((a, b) => b.seeders - a.seeders);
    searchCache.set(queryKey, { data: finalResults, expiresAt: Date.now() + CACHE_TTL_MS });
    return finalResults;
}

module.exports = { searchAllSources };
