function extractJavCode(title) {
    if (!title) return null;
    // Regex für Standard JAV-Codes (z.B. ABCD-123 oder ABC-12345)
    const match = title.toUpperCase().replace(/_/g, "-").match(/([A-Z0-9]{2,10}-\d{2,8})/);
    return match ? match[1] : null;
}

function extractTags(title) {
    const t = title.toUpperCase();
    let res = "SD";
    if (t.includes("2160") || t.includes("4K")) res = "4K";
    else if (t.includes("1080") || t.includes("FHD")) res = "1080p";
    else if (t.includes("720") || t.includes("HD")) res = "720p";
    return { res, isVR: t.includes("VR") };
}

function determineCensorshipStatus(title) {
    const isUn = /\b(UNCENSORED|UNCEN|DECENSORED|LEAK)\b/i.test(title);
    return { isUncensored: isUn, label: isUn ? "UNCENSORED" : "CENSORED" };
}

module.exports = { extractJavCode, extractTags, determineCensorshipStatus };
