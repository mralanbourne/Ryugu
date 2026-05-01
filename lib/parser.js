//===============
// RYUGU PARSING ENGINE (JAV OPTIMIZED)
// Bereinigt Dateinamen, extrahiert Studio-Codes, 
// identifiziert VR/Auflösungen und filtert Zensur.
//===============

function extractJavCode(title) {
    if (!title) return null;
    const cleanTitle = title.toUpperCase().replace(/_/g, "-");
    const match = cleanTitle.match(/([A-Z0-9]{2,10}-\d{2,8}(?:-\d+)?)/);
    
    if (match) {
        const code = match[1];
        if (code.includes("FHD-") || code.includes("HD-") || code.includes("SD-")) {
            return null;
        }
        return code;
    }
    return null;
}

function parseSizeToBytes(sizeStr) {
    if (!sizeStr || typeof sizeStr !== "string") return 0;
    const match = sizeStr.match(/([\d.]+)\s*(GB|MB|KB|GiB|MiB|KiB|B)/i);
    if (!match) return 0;
    
    const val = parseFloat(match[1]);
    const unit = match[2].toUpperCase();
    
    if (unit.includes("G")) return val * 1024 * 1024 * 1024;
    if (unit.includes("M")) return val * 1024 * 1024;
    if (unit.includes("K")) return val * 1024;
    return val;
}

function extractTags(title) {
    let res = "SD";
    let isVR = false;
    
    const upperTitle = title.toUpperCase();
    
    if (/(4320P|8K|FUHD)/.test(upperTitle)) res = "8K";
    else if (/(2160P|4K|UHD)/.test(upperTitle)) res = "4K";
    else if (/(1440P|2K|QHD)/.test(upperTitle)) res = "2K";
    else if (/(1080P|1080|FHD)/.test(upperTitle)) res = "1080p";
    else if (/(720P|720|HD)/.test(upperTitle)) res = "720p";
    else if (/(480P|480)/.test(upperTitle)) res = "480p";
    
    if (/\b(VR)\b/.test(upperTitle)) isVR = true;
    
    return { res, isVR };
}

function determineCensorshipStatus(title) {
    const uncenRegex = /\b(uncensored|decensored|uncen|decen|leak)\b/i;
    
    if (uncenRegex.test(title)) {
        return { isUncensored: true, label: "UNCENSORED" };
    }
    return { isUncensored: false, label: "CENSORED" };
}

function selectBestVideoFile(files) {
    if (!files || files.length === 0) return null;
    let videoFiles = files.filter(f => /\.(mkv|mp4|avi|wmv|ts|mov)$/i.test(f.name || f.path || ""));
    
    if (videoFiles.length === 0) return null;
    
    return videoFiles.sort((a, b) => {
        const sizeA = a.size || a.bytes || 0;
        const sizeB = b.size || b.bytes || 0;
        return sizeB - sizeA;
    })[0];
}

module.exports = { 
    extractJavCode, 
    parseSizeToBytes, 
    extractTags, 
    determineCensorshipStatus, 
    selectBestVideoFile 
};