//===============
// RYUGU GATEWAY - SERVER CORE
//===============
require("dotenv").config();
const express = require("express");
const axios = require("axios");
const path = require("path");
const { getRouter } = require("stremio-addon-sdk");
const { addonInterface } = require("./addon");

const app = express();
app.use(express.json());

const port = process.env.PORT || 7000;
const BASE_URL = (process.env.BASE_URL || "").replace(/\/+$/, "");

app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    next();
});

app.use(express.static(path.join(__dirname, "public")));
app.get("/configure", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

// Debrid Link Resolver
app.get("/resolve/:provider/:apiKey/:hash", async (req, res) => {
    const { provider, apiKey, hash } = req.params;
    const ts = new Date().toISOString();
    console.log(`[${ts}] [RESOLVER] Incoming: ${provider} | Hash: ${hash}`);

    try {
        if (provider === "realdebrid") {
            const addRes = await axios.post("https://api.real-debrid.com/rest/1.0/torrents/addMagnet", 
                new URLSearchParams({ magnet: "magnet:?xt=urn:btih:" + hash }),
                { headers: { Authorization: "Bearer " + apiKey } }
            );
            const info = await axios.get(`https://api.real-debrid.com/rest/1.0/torrents/info/${addRes.data.id}`, {
                headers: { Authorization: "Bearer " + apiKey }
            });

            if (info.data.status === "waiting_files_selection") {
                await axios.post(`https://api.real-debrid.com/rest/1.0/torrents/selectFiles/${addRes.data.id}`, "files=all", {
                    headers: { Authorization: "Bearer " + apiKey }
                });
            }
            
            const freshInfo = await axios.get(`https://api.real-debrid.com/rest/1.0/torrents/info/${addRes.data.id}`, {
                headers: { Authorization: "Bearer " + apiKey }
            });

            if (freshInfo.data.links && freshInfo.data.links.length > 0) {
                const unrestrict = await axios.post("https://api.real-debrid.com/rest/1.0/unrestrict/link", 
                    new URLSearchParams({ link: freshInfo.data.links[0] }),
                    { headers: { Authorization: "Bearer " + apiKey } }
                );
                return res.redirect(unrestrict.data.download);
            }
        }
        
        if (provider === "torbox") {
            const dl = await axios.get(`https://api.torbox.app/v1/api/torrents/requestdl?token=${apiKey}&hash=${hash}`);
            if (dl.data && dl.data.data) return res.redirect(dl.data.data);
        }
        res.status(404).send("Stream not ready.");
    } catch (e) {
        console.error(`[${ts}] [RESOLVER ERR] ${e.message}`);
        res.redirect("https://github.com/mralanbourne/Yomi/releases/download/video/waiting.mp4");
    }
});

app.use("/", getRouter(addonInterface));
app.listen(port, "0.0.0.0", () => {
    console.log(`[${new Date().toISOString()}] [SERVER] RYUGU V3.1 ONLINE | PORT ${port}`);
});
