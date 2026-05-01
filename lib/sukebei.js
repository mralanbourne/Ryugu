//===============
// RYUGU SUKEBEI SCRAPER
//===============
const axios = require("axios");

class AsyncQueue {
    constructor(concurrency = 1) {
        this.concurrency = concurrency;
        this.running = 0;
        this.queue = [];
    }
    enqueue(task) {
        return new Promise((resolve, reject) => {
            this.queue.push(async () => {
                this.running++;
                try { resolve(await task()); }
                catch(e) { reject(e); }
                finally {
                    this.running--;
                    this.dequeue();
                }
            });
            this.dequeue();
        });
    }
    dequeue() {
        if (this.running < this.concurrency && this.queue.length > 0) {
            const nextTask = this.queue.shift();
            nextTask();
        }
    }
}

const scrapeQueue = new AsyncQueue(5);

const MIRRORS = [
    "https://sukebei.nyaa.si",
    "https://sukebei.nyaa.iss.one"
];
let currentMirrorIndex = 0;

function getNextMirror() {
    currentMirrorIndex = (currentMirrorIndex + 1) % MIRRORS.length;
    return MIRRORS[currentMirrorIndex];
}

async function searchSukebeiForJav(query) {
    if (!query || query.trim().length < 3) return [];
    const safeQuery = encodeURIComponent(query.trim());
    
    return scrapeQueue.enqueue(async () => {
        let attempts = 0;
        let success = false;
        let streams = [];
        
        while (attempts < MIRRORS.length && !success) {
            const domain = MIRRORS[currentMirrorIndex];
            const url = `${domain}/?page=rss&q=${safeQuery}&c=2_2&f=0`;
            
            try {
                const res = await axios.get(url, { 
                    timeout: 8000,
                    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
                });
                
                const items = res.data.split("<item>");
                for (let i = 1; i < items.length; i++) {
                    const titleMatch = items[i].match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || items[i].match(/<title>(.*?)<\/title>/);
                    const hashMatch = items[i].match(/<nyaa:infoHash>([a-zA-Z0-9]{40})<\/nyaa:infoHash>/i);
                    const seedersMatch = items[i].match(/<nyaa:seeders>(\d+)<\/nyaa:seeders>/);
                    const sizeMatch = items[i].match(/<nyaa:size>([\s\S]*?)<\/nyaa:size>/);
                    
                    if (titleMatch && hashMatch) {
                        streams.push({
                            title: titleMatch[1].replace(/<!\[CDATA\[|\]\]>/g, ""),
                            hash: hashMatch[1].toLowerCase(),
                            seeders: seedersMatch ? parseInt(seedersMatch[1], 10) : 0,
                            size: sizeMatch ? sizeMatch[1] : "0 B"
                        });
                    }
                }
                success = true;
            } catch (error) {
                getNextMirror();
                attempts++;
            }
        }
        return streams;
    });
}

module.exports = { searchSukebeiForJav };