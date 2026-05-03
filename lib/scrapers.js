//===============
// RYUGU SCRAPERS (MULTI-SOURCE KASKADE)
// Beinhaltet Sukebei, TokyoTosho und DHT-Scraping via BTDigg.
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
// SUKEBEI MAIN
//===============
async function searchSukebeiMain(query) {
    try {
        const url = `https://sukebei.nyaa.si/?page=rss&q=${encodeURIComponent(query)}&c=0_0&f=0`;
        const data = await solverRequest(url);
        const parser = new XMLParser(parserConfig);
        const jsonObj = parser.parse(data);
        const items = jsonObj?.rss?.channel?.item ? (Array.isArray(jsonObj.rss.channel.item) ? jsonObj.rss.channel.item : [jsonObj.rss.channel.item]) : [];
        
        return items.map(item => ({
            title: decodeEntities(item.title) || "Unknown",
            hash: (item["nyaa:infoHash"] || "").toLowerCase(),
            seeders: parseInt(item["nyaa:seeders"], 10) || 0,
            size: item["nyaa:size"] || "Unknown"
        })).filter(i => i.hash && i.hash.length === 40);
    } catch(e) { throw new Error(`Sukebei Main: ${e.message}`); }
}

//===============
// SUKEBEI MIRROR
//===============
async function searchSukebeiMirror(query) {
    try {
        const url = `https://sukebei.nyaa.iss.one/?page=rss&q=${encodeURIComponent(query)}&c=0_0&f=0`;
        const data = await solverRequest(url);
        const parser = new XMLParser(parserConfig);
        const jsonObj = parser.parse(data);
        const items = jsonObj?.rss?.channel?.item ? (Array.isArray(jsonObj.rss.channel.item) ? jsonObj.rss.channel.item : [jsonObj.rss.channel.item]) : [];
        
        return items.map(item => ({
            title: decodeEntities(item.title) || "Unknown",
            hash: (item["nyaa:infoHash"] || "").toLowerCase(),
            seeders: parseInt(item["nyaa:seeders"], 10) || 0,
            size: item["nyaa:size"] || "Unknown"
        })).filter(i => i.hash && i.hash.length === 40);
    } catch(e) { throw new Error(`Sukebei Mirror: ${e.message}`); }
}

//===============
// TOKYO TOSHO (ADULT)
//===============
async function searchTokyoToshoAdult(query) {
    try {
        const url = `https://www.tokyotosho.info/rss.php?terms=${encodeURIComponent(query)}&type=9`;
        const res = await scraperClient.get(url, {
            timeout: 8000,
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
        });
        const parser = new XMLParser(parserConfig);
        const jsonObj = parser.parse(res.data);
        const items = jsonObj?.rss?.channel?.item ? (Array.isArray(jsonObj.rss.channel.item) ? jsonObj.rss.channel.item : [jsonObj.rss.channel.item]) : [];
        
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
// BTDIGG (DHT CRAWLER)
// Grabbt Dead-Torrents für die Debrid-Cache-Magie.
// HTML DOM Parsing via Cheerio. Seeders hart auf 1 gesetzt, 
// um den Sorter nicht zu verfälschen.
//===============
async function searchBTDigg(query) {
    try {
        const url = `https://btdigg.org/search?q=${encodeURIComponent(query)}`;
        const data = await solverRequest(url);
        if (!data) return [];

        const $ = cheerio.load(data);
        const results = [];

        // Iteriere über die Suchergebnisse
        $(".torrent_name, .torrent-name").each((i, el) => {
            if (i >= 20) return false; // Hard-Limit zum Schutz des Event-Loops
            
            const anchor = $(el).find("a[href^='magnet:']");
            const magnetHref = anchor.attr("href");
            if (!magnetHref) return;

            const hashMatch = magnetHref.match(/urn:btih:([a-fA-F0-9]{40})/i);
            if (!hashMatch) return;

            const title = anchor.text() || $(el).text() || "Unknown";
            
            // Größe aus dem Metadaten-Block extrahieren
            const metadataContainer = $(el).closest("div").find(".torrent_metadata, .torrent-metadata, .attr");
            const sizeStr = metadataContainer.find(".torrent_size, .torrent-size").text() || "Unknown";

            results.push({
                title: decodeEntities(title.trim()),
                hash: hashMatch[1].toLowerCase(),
                seeders: 1, // Fix auf 1 (Nur Cache-Fallback)
                size: sizeStr.trim()
            });
        });

        return results;
    } catch(e) { throw new Error(`BTDigg: ${e.message}`); }
}

//===============
// MAIN SEARCH CONTROLLER
//===============
async function searchAllSources(title) {
    if (!title || title.trim().length < 2) return [];
    const query = title.replace(/\s+/g, " ").trim();
    const queryKey = query.toLowerCase();
    
    if (searchCache.has(queryKey)) {
        const item = searchCache.get(queryKey);
        if (item.expiresAt > Date.now()) return item.data;
    }
    
    const allTorrents = [];
    const trackers = [
        { name: "SukebeiMain", fn: searchSukebeiMain },
        { name: "SukebeiMirror", fn: searchSukebeiMirror },
        { name: "TokyoTosho", fn: searchTokyoToshoAdult },
        { name: "BTDiggDHT", fn: searchBTDigg }
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

    const uniqueTorrents = new Map();
    allTorrents.forEach(item => {
        // Dedup: Behalte die höchste Seeder-Zahl (Ignoriert BTDigg, falls ein aktiver Torrent gefunden wurde)
        if (!uniqueTorrents.has(item.hash) || item.seeders > uniqueTorrents.get(item.hash).seeders) {
            uniqueTorrents.set(item.hash, item);
        }
    });
    
    const finalResults = Array.from(uniqueTorrents.values()).sort((a, b) => b.seeders - a.seeders);
    searchCache.set(queryKey, { data: finalResults, expiresAt: Date.now() + CACHE_TTL_MS });
    return finalResults;
}

module.exports = { searchAllSources };
