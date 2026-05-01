//===============
// THE PORNDB (TPDB) METADATA PROVIDER
// Optimiert: Verbose Error Logging & Erhöhter Timeout (10s)
//===============
const axios = require("axios");
const { extractJavCode } = require("./parser");

const TPDB_API_KEY = process.env.TPDB_API_KEY || "0woW9FRxVIOrMlnIQOpDPsK9gy7zQCRTQfB9La8Sd5ac70db";

const apiCache = new Map();
const CACHE_TTL = 12 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;

function setLRUCache(key, dataOrPromise) {
    if (apiCache.has(key)) {
        apiCache.delete(key);
    } else if (apiCache.size >= MAX_CACHE_ENTRIES) {
        apiCache.delete(apiCache.keys().next().value);
    }
    apiCache.set(key, { timestamp: Date.now(), data: dataOrPromise });
}

function getLRUCache(key) {
    if (apiCache.has(key)) {
        const item = apiCache.get(key);
        if (Date.now() - item.timestamp < CACHE_TTL) {
            apiCache.delete(key);
            apiCache.set(key, item);
            return item.data;
        } else {
            apiCache.delete(key);
        }
    }
    return null;
}

function mapTpdbToMetas(rawData) {
    const metas = [];
    if (!Array.isArray(rawData)) return metas;
    
    for (const item of rawData) {
        const fullTitle = (item.title || "Unknown").trim();
        const javCode = extractJavCode(fullTitle) || fullTitle.substring(0, 15).replace(/[^a-zA-Z0-9]/g, "");
        const cleanId = "jav_" + javCode.toLowerCase();
        
        const posterUrl = item.poster || (item.posters ? item.posters.large : "https://dummyimage.com/600x900/1a1a1a/e91e63.png?text=No+Cover");
        const releaseDate = item.date || "";
        const releaseYear = releaseDate ? releaseDate.substring(0, 4) : "";
        const releasedIso = releaseDate ? new Date(releaseDate).toISOString() : undefined;
        
        metas.push({
            id: cleanId,
            type: "movie",
            name: javCode.toUpperCase(),
            poster: posterUrl,
            posterShape: "poster",
            background: item.background ? item.background.full : posterUrl,
            description: `Title: ${fullTitle}\n\n${item.description || ""}`,
            releaseInfo: releaseYear,
            released: releasedIso,
            genres: ["JAV", "Adult"],
            runtime: item.duration ? `${Math.floor(item.duration / 60)} min` : ""
        });
    }
    return metas;
}

async function getTrendingJav() {
    const cacheKey = "tpdb_trending";
    const cachedItem = getLRUCache(cacheKey);
    if (cachedItem) return cachedItem;

    const fetchPromise = (async () => {
        try {
            const response = await axios.get("https://api.theporndb.net/jav", {
                params: { sort: "-date" },
                headers: {
                    "Authorization": "Bearer " + TPDB_API_KEY,
                    "Accept": "application/json"
                },
                timeout: 10000 // Erhöht auf 10 Sekunden
            });
            const results = mapTpdbToMetas(response.data.data);
            setLRUCache(cacheKey, results);
            return results;
        } catch (error) {
            let errorMsg = error.message;
            if (error.response) {
                errorMsg = `HTTP ${error.response.status} - ${JSON.stringify(error.response.data)}`;
            }
            console.error(`[TPDB ERROR] Trending Fetch failed: ${errorMsg}`);
            apiCache.delete(cacheKey);
            return [];
        }
    })();
    setLRUCache(cacheKey, fetchPromise);
    return fetchPromise;
}

async function searchJav(query) {
    const cacheKey = "tpdb_search_" + query.toLowerCase();
    const cachedItem = getLRUCache(cacheKey);
    if (cachedItem) return cachedItem;

    const fetchPromise = (async () => {
        try {
            const response = await axios.get("https://api.theporndb.net/jav", {
                params: { q: query, sort: "-date" },
                headers: {
                    "Authorization": "Bearer " + TPDB_API_KEY,
                    "Accept": "application/json"
                },
                timeout: 10000 // Erhöht auf 10 Sekunden
            });
            const results = mapTpdbToMetas(response.data.data);
            setLRUCache(cacheKey, results);
            return results;
        } catch (error) {
            let errorMsg = error.message;
            if (error.response) {
                errorMsg = `HTTP ${error.response.status} - ${JSON.stringify(error.response.data)}`;
            }
            console.error(`[TPDB ERROR] Search Fetch failed for query '${query}': ${errorMsg}`);
            apiCache.delete(cacheKey);
            return [];
        }
    })();
    setLRUCache(cacheKey, fetchPromise);
    return fetchPromise;
}

module.exports = { getTrendingJav, searchJav };