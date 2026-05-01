//===============
// RYUGU GATEWAY - SERVER CORE
// Optimiert: Explizites Routing & Frontend-Integration
//===============
require("dotenv").config();
const express = require("express");
const axios = require("axios");
const path = require("path");
const { getRouter } = require("stremio-addon-sdk");
const { addonInterface, manifest, parseConfig } = require("./addon");
const { selectBestVideoFile } = require("./lib/parser");

const app = express();
app.use(express.json());

//===============
// CORS HEADERS
//===============
app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, HEAD");
    res.setHeader("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization, Range");
    res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range");
    if (req.method === "OPTIONS") return res.status(204).end();
    next();
});

const port = process.env.PORT || 7000;
let BASE_URL = process.env.BASE_URL || "http://127.0.0.1:7000";
BASE_URL = BASE_URL.replace(/\/+$/, "");

app.get("/health", (req, res) => res.status(200).json({ status: "alive" }));

//===============
// FRONTEND ROUTING
//===============
app.use(express.static(path.join(__dirname, "public")));

app.get("/configure", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

//===============
// DYNAMIC MANIFEST INTERCEPTOR
//===============
app.get(["/manifest.json", "/:config/manifest.json"], (req, res) => {
    let userConfig = {};
    let isConfigured = false;
    
    if (req.params.config) {
        try {
            const parsed = JSON.parse(decodeURIComponent(req.params.config));
            userConfig = parseConfig(parsed);
            isConfigured = true;
        } catch (e) {
            console.error("[GATEWAY] Invalid Config Payload rejected.");
        }
    }
    
    const dynamicManifest = JSON.parse(JSON.stringify(manifest));
    
    if (isConfigured && dynamicManifest.behaviorHints) {
        dynamicManifest.behaviorHints.configurationRequired = false;
    }
    
    res.setHeader("Cache-Control", "max-age=86400, public");
    res.json(dynamicManifest);
});

// Helper functions for placeholder video redirects
function serveLoadingVideo(req, res) {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.redirect("https://github.com/mralanbourne/Yomi/releases/download/video/waiting.mp4");
}

function serveArchiveVideo(req, res) {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.redirect("https://github.com/mralanbourne/Yomi/releases/download/video/archive.mp4");
}

//===============
// STREAM RESOLVER
//===============
app.get(["/resolve/:provider/:apiKey/:hash", "/resolve/:provider/:apiKey/:hash/:episode"], async (req, res) => {
    const { provider, apiKey, hash } = req.params;
    const magnet = "magnet:?xt=urn:btih:" + hash;
    
    try {
        if (provider === "realdebrid") {
            const listRes = await axios.get("https://api.real-debrid.com/rest/1.0/torrents?limit=250", { headers: { Authorization: "Bearer " + apiKey } });
            let torrent = listRes.data.find(t => t.hash.toLowerCase() === hash.toLowerCase());
            
            if (!torrent) {
                const add = await axios.post("https://api.real-debrid.com/rest/1.0/torrents/addMagnet", new URLSearchParams({ magnet }), { headers: { Authorization: "Bearer " + apiKey } });
                torrent = { id: add.data.id };
            }
            
            let info = await axios.get("https://api.real-debrid.com/rest/1.0/torrents/info/" + torrent.id, { headers: { Authorization: "Bearer " + apiKey } });
            
            if (["magnet_error", "error", "virus", "dead"].includes(info.data.status)) {
                await axios.delete("https://api.real-debrid.com/rest/1.0/torrents/delete/" + torrent.id, { headers: { Authorization: "Bearer " + apiKey } }).catch(() => null);
                return res.status(404).send("Torrent is dead.");
            }
            
            if (info.data.status !== "downloaded") {
                if (info.data.status === "waiting_files_selection") {
                    const selectedIds = info.data.files.filter(f => /\.(mkv|mp4|avi|wmv|ts|mov)$/i.test(f.path)).map(f => f.id);
                    await axios.post("https://api.real-debrid.com/rest/1.0/torrents/selectFiles/" + torrent.id, "files=" + (selectedIds.length ? selectedIds.join(",") : "all"), { 
                        headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/x-www-form-urlencoded" } 
                    });
                    await new Promise(resolve => setTimeout(resolve, 1500));
                    info = await axios.get("https://api.real-debrid.com/rest/1.0/torrents/info/" + torrent.id, { headers: { Authorization: "Bearer " + apiKey } });
                }
                if (info.data.status !== "downloaded") return serveLoadingVideo(req, res);
            }
            
            const bestFileFresh = selectBestVideoFile(info.data.files);
            if (!bestFileFresh) return serveArchiveVideo(req, res);
            
            if (bestFileFresh.selected === 0) {
                await axios.delete("https://api.real-debrid.com/rest/1.0/torrents/delete/" + torrent.id, { headers: { Authorization: "Bearer " + apiKey } }).catch(() => null);
                return res.redirect(req.originalUrl);
            }
            
            const targetFileIndex = info.data.files.findIndex(f => f.id === bestFileFresh.id);
            let targetLink = info.data.links[0]; 
            
            if (targetFileIndex !== -1) {
                let linkCounter = 0;
                for (let i = 0; i < info.data.files.length; i++) {
                    if (i === targetFileIndex) { targetLink = info.data.links[linkCounter]; break; }
                    if (info.data.files[i].selected === 1) linkCounter++;
                }
            }
            
            if (!targetLink) return serveLoadingVideo(req, res);
            const unrestrict = await axios.post("https://api.real-debrid.com/rest/1.0/unrestrict/link", new URLSearchParams({ link: targetLink }), { headers: { Authorization: "Bearer " + apiKey } });
            return res.redirect(unrestrict.data.download);
        }
        
        if (provider === "torbox") {
            const list = await axios.get("https://api.torbox.app/v1/api/torrents/mylist?bypass_cache=true", { headers: { Authorization: "Bearer " + apiKey } });
            let torrent = list.data.data ? list.data.data.find(t => t.hash.toLowerCase() === hash.toLowerCase()) : null;
            
            if (!torrent) {
                const boundary = "----WebKitFormBoundaryRyugu";
                try {
                    await axios.post("https://api.torbox.app/v1/api/torrents/createtorrent", "--" + boundary + "\r\nContent-Disposition: form-data; name=\"magnet\"\r\n\r\n" + magnet + "\r\n--" + boundary + "--", { headers: { Authorization: "Bearer " + apiKey, "Content-Type": "multipart/form-data; boundary=" + boundary } });
                } catch (e) { return serveLoadingVideo(req, res); }
                return serveLoadingVideo(req, res);
            }
            
            if (["error", "failed", "dead", "deleted"].includes(torrent.download_state)) return res.status(404).send("Torrent is dead.");
            if (torrent.download_state !== "completed" && torrent.download_state !== "cached") return serveLoadingVideo(req, res);
            
            const bestFile = selectBestVideoFile(torrent.files);
            if (!bestFile) return serveArchiveVideo(req, res);
            
            const dl = await axios.get("https://api.torbox.app/v1/api/torrents/requestdl?token=" + apiKey + "&torrent_id=" + torrent.id + "&file_id=" + bestFile.id);
            return res.redirect(dl.data.data);
        }
    } catch (e) { return serveLoadingVideo(req, res); }
});

app.use("/", getRouter(addonInterface));

app.listen(port, "0.0.0.0", () => console.log("RYUGU V3.0 ONLINE | PORT " + port));