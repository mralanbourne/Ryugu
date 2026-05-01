//===============
// LOKALER URL GENERATOR FÜR RYUGU
//===============
const config = {
    Ryugu: Buffer.from(JSON.stringify({
        hideUncached: false,
        enableP2P: true, // P2P an für schnellen Test ohne Debrid
        resolutions: ["8K", "4K", "2K", "1080p", "720p", "480p", "SD"]
        // rdKey: "DEIN_RD_KEY", // Hier eintragen, falls Debrid getestet werden soll
        // tbKey: "DEIN_TB_KEY"
    })).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
};

const configString = encodeURIComponent(JSON.stringify(config));
const manifestUrl = `http://127.0.0.1:7000/${configString}/manifest.json`;

console.log("\n--- LOKALER STREMIO INSTALLATIONS-LINK ---");
console.log(manifestUrl);
console.log("------------------------------------------\n");