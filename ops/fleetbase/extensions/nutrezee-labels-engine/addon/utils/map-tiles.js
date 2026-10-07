// A74 — Fleet-Ops hard-codes CARTO basemap tiles, and CARTO now stamps "API KEY REQUIRED" on them
// without a paid key. The same tile (z/x/y) is served by OpenStreetMap's standard layer, whose
// attribution Leaflet already shows. Only CARTO basemap tile addresses are rewritten; every other
// image address passes through unchanged.
const CARTO_TILE = /^https:\/\/(?:[a-d]\.)?basemaps\.cartocdn\.com\/(?:rastertiles\/)?[a-z_]+\/(\d{1,2})\/(\d+)\/(\d+)(?:@2x)?\.png(?:\?.*)?$/;

export function rewriteTileUrl(url) {
    if (typeof url !== 'string') return url;
    const match = CARTO_TILE.exec(url);
    return match ? `https://tile.openstreetmap.org/${match[1]}/${match[2]}/${match[3]}.png` : url;
}

export function installMapTileSource(imagePrototype) {
    const prototype = imagePrototype ?? globalThis.HTMLImageElement?.prototype;
    if (!prototype || prototype.nutrezeeMapTiles) return false;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'src');
    if (!descriptor?.set || !descriptor.get) return false;
    Object.defineProperty(prototype, 'src', {
        configurable: true,
        enumerable: descriptor.enumerable,
        get: descriptor.get,
        set(value) {
            descriptor.set.call(this, rewriteTileUrl(value));
        },
    });
    Object.defineProperty(prototype, 'nutrezeeMapTiles', { value: true });
    return true;
}
