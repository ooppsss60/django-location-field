// Run: node --test tests/osm-tiles.cjs (Playwright and Chromium required).
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const source = fs.readFileSync(path.join(__dirname, '../location_field/static/location_field/js/form.js'), 'utf8');
const adapters = source.slice(source.indexOf('    function LatLng'), source.indexOf('    $.locationField'));

test('OSM tiles send only the origin under a restrictive page policy and show attribution', async () => {
    const browser = await chromium.launch({headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined});
    try {
        const page = await browser.newPage();
        const requests = [];
        await page.route('https://admin.example.test/**', route => route.fulfill({
            contentType: 'text/html',
            headers: {'Referrer-Policy': 'same-origin'},
            body: '<div id="map" style="width:500px;height:250px"></div>'
        }));
        await page.route('https://*.openstreetmap.org/**', async route => {
            requests.push({url: route.request().url(), headers: await route.request().allHeaders()});
            await route.fulfill({contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')});
        });
        await page.goto('https://admin.example.test/admin/estate/estate/1/change/?private=value');
        await page.addScriptTag({content: adapters});
        await page.evaluate(() => {
            window.map = new TileMap(document.getElementById('map'), {
                provider: 'openstreetmap', center: new LatLng(55.75, 37.62), zoom: 13
            }, {});
            window.selected = false;
            map.onClick = () => { window.selected = true; };
        });
        await page.waitForFunction(() => [...document.querySelectorAll('#map img')].every(img => img.complete && img.naturalWidth > 0));
        assert.ok(requests.length > 0);
        for (const request of requests) {
            assert.equal(new URL(request.url).origin, 'https://tile.openstreetmap.org');
            assert.equal(request.headers.referer, 'https://admin.example.test/');
        }
        const link = page.locator('.location-field-attribution a');
        assert.equal(await link.getAttribute('href'), 'https://www.openstreetmap.org/copyright');
        assert.match(await page.locator('.location-field-attribution').innerText(), /© OpenStreetMap contributors/);
        assert.ok(await link.isVisible());
        await link.evaluate(el => el.addEventListener('click', event => event.preventDefault()));
        await link.click();
        assert.equal(await page.evaluate(() => window.selected), false);
        assert.equal(await page.evaluate(() => !!map.dragStart), false);
    } finally {
        await browser.close();
    }
});
