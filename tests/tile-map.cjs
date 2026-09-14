// Run with node --test tests/tile-map.cjs (Playwright and Chromium required).
const {test, before, after, beforeEach, afterEach} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');

const source = fs.readFileSync(path.join(__dirname, '../location_field/static/location_field/js/form.js'), 'utf8');
// Expose the actual private adapters without running the jQuery form observer.
const adapters = source.slice(source.indexOf('    function LatLng'), source.indexOf('    $.locationField'));
let browser;
let context;
let page;
before(async () => {
    browser = await chromium.launch({headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined});
});
after(async () => { if (browser) await browser.close(); });
beforeEach(async () => {
    context = await browser.newContext({viewport: {width: 900, height: 600}, hasTouch: true});
    page = await context.newPage();
    await page.route('**/*', route => route.fulfill({
        contentType: 'image/png',
        body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
    }));
    await page.setContent('<style>body {margin:0} #map {position:absolute; left:100px; top:80px; width:500px; height:250px; border:3px solid black}</style><div id="map"></div><input id="value">');
    await page.addScriptTag({content: adapters});
    await page.evaluate(() => {
        window.map = new TileMap(document.getElementById('map'), {
            provider: 'openstreetmap', center: new LatLng(0, 0), zoom: 13
        }, {});
        window.marker = new TileMarker(map, new LatLng(0, 0), value => {
            document.getElementById('value').value = value.lat + ',' + value.lng;
        });
        map.onClick = value => marker.setPosition(value);
    });
});
afterEach(async () => { if (context) await context.close(); });

test('tile clicks use container coordinates including its border', async () => {
    const expected = await page.evaluate(() => map.containerPointToLatLng(350, 180));
    await page.mouse.click(453, 263);
    const actual = (await page.locator('#value').inputValue()).split(',').map(Number);
    assert.ok(Math.abs(actual[0] - expected.lat) < 1e-9);
    assert.ok(Math.abs(actual[1] - expected.lng) < 1e-9);
});

test('legacy Mapbox default and custom styles produce valid paths', async () => {
    const urls = await page.evaluate(() => {
        map.provider = 'mapbox';
        map.providerOptions = {id: 'mapbox.streets', access_token: 'a&b'};
        const legacy = map._tileUrl(1, 2, 3);
        map.providerOptions.id = 'owner/custom-style';
        return [legacy, map._tileUrl(1, 2, 3)];
    });
    assert.equal(new URL(urls[0]).pathname, '/styles/v1/mapbox/streets-v11/tiles/256/3/1/2');
    assert.equal(new URL(urls[0]).searchParams.get('access_token'), 'a&b');
    assert.equal(new URL(urls[1]).pathname, '/styles/v1/owner/custom-style/tiles/256/3/1/2');
});

test('pan reuses visible tiles and evicts only tiles outside the viewport', async () => {
    assert.equal(await page.evaluate(() => {
        const initial = Array.from(map.tilePane.children);
        map._draw();
        if (!initial.every(node => node.isConnected)) return false;
        const center = map.project(map.center);
        map.panTo(map.unproject({x: center.x + 2, y: center.y}));
        if (!initial.every(node => node.isConnected)) return false;
        map.panTo(map.unproject({x: center.x + 260, y: center.y}));
        const retained = initial.filter(node => node.isConnected).length;
        return retained > 0 && retained < initial.length && map.tilePane.children.length <= 6;
    }), true);
});

test('double click and wheel zoom preserve their geographic anchor', async () => {
    const before = await page.evaluate(() => map.containerPointToLatLng(350, 180));
    await page.mouse.dblclick(453, 263);
    assert.equal(await page.evaluate(() => map.zoom), 14);
    await page.mouse.wheel(0, -100);
    await page.waitForFunction(() => map.zoom === 15);
    const after = await page.evaluate(() => map.containerPointToLatLng(350, 180));
    assert.ok(Math.abs(before.lat - after.lat) < 1e-9);
    assert.ok(Math.abs(before.lng - after.lng) < 1e-9);
});

test('keyboard pans and zooms, with zoom zero and limits respected', async () => {
    await page.locator('#map').focus();
    await page.keyboard.press('ArrowRight');
    assert.ok(await page.evaluate(() => map.center.lng > 0));
    await page.keyboard.press('+');
    assert.equal(await page.evaluate(() => map.zoom), 14);
    await page.keyboard.press('-');
    assert.equal(await page.evaluate(() => map.zoom), 13);
    assert.equal(await page.evaluate(() => {
        const el = document.createElement('div');
        document.body.appendChild(el);
        const zero = new TileMap(el, {center: new LatLng(0, 0), zoom: 0, maxZoom: 0}, {});
        zero.setZoom(1);
        return zero.zoom;
    }), 0);
});

test('marker drag writes the release point and does not pan the map', async () => {
    await page.mouse.move(353, 185);
    await page.mouse.down();
    await page.mouse.move(430, 220, {steps: 8});
    await page.mouse.up();
    const values = await page.evaluate(() => ({
        expected: map.containerPointToLatLng(327, 137),
        actual: marker.latLng, center: map.center
    }));
    assert.ok(Math.abs(values.actual.lng - values.expected.lng) < 1e-9);
    assert.ok(Math.abs(values.actual.lat - values.expected.lat) < 1e-9);
    assert.equal(values.center.lat, 0);
    assert.equal(values.center.lng, 0);
});

test('real touch pinch zooms around its midpoint without selecting a location', async () => {
    const cdp = await context.newCDPSession(page);
    const touch = (id, x, y) => ({id, x, y});
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [touch(0, 400, 260), touch(1, 460, 260)]});
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [touch(0, 370, 260), touch(1, 490, 260)]});
    await page.waitForFunction(() => map.zoom === 14);
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
    assert.equal(await page.locator('#value').inputValue(), '');
});

test('touch pan suppresses click, while a later tap selects a point', async () => {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{id: 0, x: 450, y: 260}]});
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{id: 0, x: 490, y: 260}]});
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
    assert.equal(await page.locator('#value').inputValue(), '');
    await page.waitForFunction(() => Date.now() >= map.suppressClickUntil);
    await page.touchscreen.tap(430, 260);
    assert.notEqual(await page.locator('#value').inputValue(), '');
});
