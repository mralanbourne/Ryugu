//===============
// THE PORNDB (TPDB) PROVIDER - DEEP LOGGING VERSION
//===============
const axios = require("axios");
const { extractJavCode } = require("./parser");

const TPDB_API_KEY = process.env.TPDB_API_KEY || "0woW9FRxVIOrMlnIQOpDPsK9gy7zQCRTQfB9La8Sd5ac70db";

async function searchJav(query) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [TPDB] Starting Search for query: "${query}"`);

    try {
        const response = await axios.get("https://api.theporndb.net/jav", {
            params: { q: query, sort: "-date" },
            headers: { "Authorization": "Bearer " + TPDB_API_KEY, "Accept": "application/json" },
            timeout: 10000
        });

        const rawData = response.data.data || [];
        console.log(`[${timestamp}] [TPDB] Received ${rawData.length} results from API.`);

        const metas = rawData.map(item => {
            const fullTitle = (item.title || "Unknown").trim();
            // Versuche den Code aus dem Titel zu ziehen, sonst nimm den Titel als ID-Basis
            const foundCode = extractJavCode(fullTitle);
            const javCode = foundCode || fullTitle.substring(0, 20).replace(/[^a-zA-Z0-9]/g, "");
            
            console.log(`[${timestamp}] [TPDB] Mapping: "${fullTitle}" -> Detected Code: ${foundCode || "NONE"}`);

            return {
                id: "jav_" + javCode.toLowerCase(),
                type: "movie",
                name: foundCode ? foundCode.toUpperCase() : fullTitle,
                poster: item.poster || (item.posters ? item.posters.large : ""),
                background: item.background ? item.background.full : "",
                description: `Title: ${fullTitle}\nCode: ${foundCode || "N/A"}\n\n${item.description || ""}`,
                genres: ["JAV", "Adult"],
                releaseInfo: item.date ? item.date.substring(0, 4) : ""
            };
        });

        return metas;
    } catch (error) {
        console.error(`[${timestamp}] [TPDB ERROR] Search failed: ${error.message}`);
        return [];
    }
}

async function getTrendingJav() {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [TPDB] Fetching Trending JAV...`);
    // Nutzt die gleiche Logik wie oben, nur ohne Query-Parameter
    try {
        const response = await axios.get("https://api.theporndb.net/jav", {
            params: { sort: "-date" },
            headers: { "Authorization": "Bearer " + TPDB_API_KEY },
            timeout: 10000
        });
        return response.data.data ? response.data.data.map(i => ({ id: "jav_" + (extractJavCode(i.title) || "unk").toLowerCase(), type: "movie", name: i.title, poster: i.poster })) : [];
    } catch (e) { return []; }
}

module.exports = { searchJav, getTrendingJav };
