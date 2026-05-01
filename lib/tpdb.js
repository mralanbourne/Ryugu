//===============
// THE PORNDB - SEMANTIC ENGINE
//===============
const axios = require("axios");
const { extractJavCode } = require("./parser");
const API_KEY = "0woW9FRxVIOrMlnIQOpDPsK9gy7zQCRTQfB9La8Sd5ac70db";

async function searchJav(query) {
    const ts = new Date().toISOString();
    console.log(`[${ts}] [TPDB] Searching: "${query}"`);
    try {
        const res = await axios.get("https://api.theporndb.net/jav", {
            params: { q: query, sort: "-date" },
            headers: { Authorization: "Bearer " + API_KEY, Accept: "application/json" },
            timeout: 10000
        });
        
        return (res.data.data || []).map(item => {
            const code = extractJavCode(item.title) || item.title.substring(0,10);
            return {
                id: "jav_" + code.toLowerCase(),
                type: "movie",
                name: item.title,
                poster: item.poster || (item.posters ? item.posters.large : ""),
                description: item.description || ""
            };
        });
    } catch (e) {
        console.error(`[${ts}] [TPDB ERR] ${e.message}`);
        return [];
    }
}

async function getTrendingJav() {
    try {
        const res = await axios.get("https://api.theporndb.net/jav", {
            params: { sort: "-date" },
            headers: { Authorization: "Bearer " + API_KEY },
            timeout: 10000
        });
        return (res.data.data || []).map(item => ({
            id: "jav_" + (extractJavCode(item.title) || "unk").toLowerCase(),
            type: "movie",
            name: item.title,
            poster: item.poster
        }));
    } catch (e) { return []; }
}

module.exports = { searchJav, getTrendingJav };
