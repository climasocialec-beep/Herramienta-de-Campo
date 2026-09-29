const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Execute the real server with isolated environment and fake Kobo transport.
// This never loads .env, opens a socket, or contacts the unfinished form.
function loadServer({ env = {}, get = async () => { throw new Error('Unexpected Kobo request'); } } = {}) {
    const routes = new Map();
    const app = {
        use() {},
        get(route, handler) { routes.set(`GET ${route}`, handler); },
        post(route, handler) { routes.set(`POST ${route}`, handler); },
        listen() {}
    };
    const express = () => app;
    express.static = () => () => {};
    const context = vm.createContext({
        require(name) {
            if (name === 'dotenv') return { config() {} };
            if (name === 'express') return express;
            if (name === 'axios') return { get };
            if (name === 'compression') return () => () => {};
            if (name === 'path') return path;
            throw new Error(`Unexpected dependency: ${name}`);
        },
        process: { env }, __dirname: path.resolve(__dirname, '..'),
        console: { log() {}, error() {} }, URL,
        setTimeout(callback) { callback(); }
    });
    const serverPath = process.env.SERVER_SOURCE || path.resolve(__dirname, '..', 'server.js');
    vm.runInContext(fs.readFileSync(serverPath, 'utf8'), context, { filename: serverPath });
    return {
        normalize: vm.runInContext('normalizarEncuesta', context),
        extract: vm.runInContext('extraerValor', context),
        fetchData: vm.runInContext('obtenerDatosKobo', context),
        async request(method, route) {
            const response = { statusCode: 200, headers: {} };
            const res = {
                set(key, value) { response.headers[key] = value; return this; },
                status(value) { response.statusCode = value; return this; },
                json(value) { response.body = JSON.parse(JSON.stringify(value)); return this; }
            };
            await routes.get(`${method} ${route}`)({}, res);
            return response;
        }
    };
}

function plain(value) { return JSON.parse(JSON.stringify(value)); }
const configured = { ASSET_ID: 'fixture-morona', API_TOKEN: 'test-token' };
const dataUrl = 'https://kf.kobotoolbox.org/api/v2/assets/fixture-morona/data/?limit=3000';

test('without configured credentials, server returns waiting status without contacting Kobo', async () => {
    const server = loadServer({ env: { ASSET_ID: '', API_TOKEN: '' } });
    const response = await server.request('GET', '/api/encuestas');
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.total, 0);
    assert.deepEqual(response.body.resultados, []);
    assert.match(response.body.mensaje, /Esperando/);
    assert.equal((await server.request('POST', '/api/sync')).body.total, 0);
});

test('field names advertised by config are accepted without extra environment variables', async () => {
    const server = loadServer();
    const config = (await server.request('GET', '/api/config')).body;
    const normalized = server.normalize({ [config.campoEncuestador]: '4', [config.campoSupervisor]: '1' });
    assert.equal(normalized.encuestador, '4');
    assert.equal(normalized.supervisor, '1');
});

test('obsolete Render field variables are normalized to the active XLSForm names', async () => {
    const server = loadServer({ env: { CAMPO_ENCUESTADOR: 'cod_encu', CAMPO_SUPERVISOR: 'cod_sup' } });
    const config = (await server.request('GET', '/api/config')).body;
    assert.equal(config.campoEncuestador, 'cenc');
    assert.equal(config.campoSupervisor, 'csup');
    const normalized = server.normalize({ cenc: '4', csup: '1' });
    assert.equal(normalized.encuestador, '4');
    assert.equal(normalized.supervisor, '1');
});

test('legacy and configured grouped field names remain compatible', () => {
    const server = loadServer({ env: { CAMPO_ENCUESTADOR: 'staff', CAMPO_SUPERVISOR: 'lead' } });
    assert.equal(server.normalize({ 'grupo/staff': ' 4 ', 'grupo/lead': ' 1 ' }).encuestador, '4');
    assert.equal(server.normalize({ codencu: '4', codsup: '1' }).supervisor, '1');
    assert.equal(server.normalize({ C_digo_encuestador: '4', C_digo_Supervisor: '1' }).encuestador, '4');
});

test('current Kobo group_id codes assign only surveys with a recorded surveyor', () => {
    const server = loadServer();
    const assigned = server.normalize({ 'group_id/codenc': '9', 'group_id/codsup': '2' });
    assert.equal(assigned.encuestador, '9');
    assert.equal(assigned.supervisor, '2');
    const incomplete = server.normalize({ 'group_id/codsup': '2' });
    assert.equal(incomplete.encuestador, '');
});

test('current Kobo census point code reaches the map counter', () => {
    const server = loadServer();
    const normalized = server.normalize({
        'group_id/codenc': '8', 'group_id/codsup': '2',
        'group_id/tipologia': 'B', 'group_localizacion/canton': '590',
        'group_localizacion/seccensal': '93'
    });
    assert.equal(normalized.sc, '93');
    assert.equal(normalized.tipologia, 'B');
    assert.equal(normalized.canton, 'Morona');
});

test('blank candidate fields do not hide populated fallback fields', () => {
    const server = loadServer();
    assert.equal(server.extract({ codencu: '   ', encuestador: '4' }, ['codencu', 'encuestador']), '4');
    assert.equal(server.extract({ 'grupo/codencu': '\t', other: { encuestador: '4' } }, ['codencu', 'encuestador']), '4');
});

test('preserve a valid GPS on the equator and numeric coordinate strings', () => {
    const server = loadServer();
    assert.deepEqual(plain(server.normalize({ _geolocation: [0, -78.2] })._geolocation), [0, -78.2]);
    assert.deepEqual(plain(server.normalize({ _geolocation: ['-0.18', '-78.46'] })._geolocation), [-0.18, -78.46]);
});

for (const coordinates of [[-0.18, null], ['', -78.2], [-0.18, ''], [false, -78.2], [91, -78.2], [-0.18, 181], [Infinity, -78.2], ['bad', -78.2]]) {
    test(`reject invalid GPS ${JSON.stringify(coordinates)}`, () => {
        const normalized = loadServer().normalize({ _geolocation: coordinates });
        assert.equal(normalized._geolocation, null);
    });
}

test('extract valid grouped gps when Kobo geolocation is absent or invalid', () => {
    const server = loadServer();
    assert.deepEqual(plain(server.normalize({ 'grupo/gps': '0 -78.4 2000 3' })._geolocation), [0, -78.4]);
    assert.deepEqual(plain(server.normalize({ _geolocation: [-0.1, null], gps: '-0.2 -78.5 2000 3' })._geolocation), [-0.2, -78.5]);
    assert.equal(server.normalize({ gps: 'oops -78.5' })._geolocation, null);
});

test('test codes are excluded without changing field-worker or supervisor codes', async () => {
    const server = loadServer({ env: configured, get: async () => ({ data: {
        count: 3, next: null,
        results: [{ _id: 1, codencu: '4', codsup: '98' }, { _id: 2, codencu: '98', codsup: '1' }, { _id: 3, codencu: '4', codsup: '1' }]
    } }) });
    const result = await server.fetchData();
    assert.equal(result.total, 1);
    assert.deepEqual(plain(result.resultados.map(row => row._id)), [3]);
});

test('numeric field-worker and supervisor codes are preserved exactly', () => {
    const normalized = loadServer().normalize({ cenc: '17', csup: '6' });
    assert.equal(normalized.encuestador, '17');
    assert.equal(normalized.supervisor, '6');
});

test('current roster codes keep surveyors 5 and 6 and correct reversed entries', () => {
    const server = loadServer();
    assert.equal(server.normalize({ cenc: '5', csup: '1' }).encuestador, '5');
    assert.equal(server.normalize({ cenc: '6', csup: '1' }).supervisor, '1');
    const reversed = server.normalize({ cenc: '4', csup: '17' });
    assert.equal(reversed.encuestador, '17');
    assert.equal(reversed.supervisor, '4');
});

test('Morona Santiago form field names normalize location and typology', () => {
    const normalized = loadServer().normalize({
        seccensal: '93', tipol: '2', canton: '590', parroquia: '5615', barr: 'Barrio Central'
    });
    assert.equal(normalized.sc, '93');
    assert.equal(normalized.tipologia, 'B');
    assert.equal(normalized.canton, 'Morona');
    assert.equal(normalized.parroquia, 'MACAS');
    assert.equal(normalized.barrio, 'Barrio Central');
});

test('current Morona Santiago canton codes resolve to the cartography names', () => {
    const server = loadServer();
    assert.equal(server.normalize({ canton: '590', sc: '93', tipol: 'b' }).canton, 'Morona');
    assert.equal(server.normalize({ canton: '595', sc: '1', tipol: 'e' }).canton, 'Gualaquiza');
    assert.equal(server.normalize({ canton: '610', sc: '25', tipol: 'b' }).canton, 'Sucúa');
    assert.equal(server.normalize({ canton: '1413', sc: '191', tipol: 'g' }).canton, 'Sevilla Don Bosco');
});

test('multi-page Kobo data is normalized once and then cached', async () => {
    let calls = 0;
    const server = loadServer({ env: configured, get: async (url, options) => {
        calls++;
        assert.equal(options.headers.Authorization, 'Token test-token');
        assert.equal(url, calls === 1 ? dataUrl : `${dataUrl}&offset=3000`);
        return { data: { count: 2, next: calls === 1 ? `${dataUrl}&offset=3000` : null, results: [{ _id: calls, codencu: '8', codsup: '2' }] } };
    } });
    assert.equal((await server.fetchData()).total, 2);
    assert.equal((await server.fetchData()).total, 2);
    assert.equal(calls, 2);
});

test('concurrent readers share one pending Kobo fetch', async () => {
    let finish;
    let calls = 0;
    const server = loadServer({ env: configured, get: () => {
        calls++;
        return new Promise(resolve => { finish = resolve; });
    } });
    const first = server.fetchData();
    const second = server.fetchData();
    finish({ data: { count: 0, results: [], next: null } });
    await Promise.all([first, second]);
    assert.equal(calls, 1);
});

test('a failed second page must not replace results with a partial count', async () => {
    let calls = 0;
    const server = loadServer({ env: configured, get: async () => {
        calls++;
        if (calls === 1) return { data: { count: 2, results: [{ _id: 1 }], next: `${dataUrl}&offset=3000` } };
        const error = new Error('fixture unauthorized');
        error.response = { status: 401 };
        throw error;
    } });
    await assert.rejects(server.fetchData());
    assert.equal((await server.request('GET', '/api/health')).body.cacheActiva, false);
});

test('a count mismatch is rejected rather than shown as a complete survey total', async () => {
    const server = loadServer({ env: configured, get: async () => ({ data: { count: 2, results: [{ _id: 1 }], next: null } }) });
    await assert.rejects(server.fetchData(), /incompleta|conteo/i);
});

test('repeated pagination URLs stop before duplicating the next request', async () => {
    let calls = 0;
    const server = loadServer({ env: configured, get: async () => {
        calls++;
        // Baseline must terminate too, without an infinite-loop test.
        return { data: { count: 2, results: [{ _id: calls }], next: calls === 1 ? dataUrl : null } };
    } });
    await assert.rejects(server.fetchData(), /paginaci.n/i);
    assert.equal(calls, 1);
});

test('Kobo token is never sent to an external pagination destination', async () => {
    let calls = 0;
    const server = loadServer({ env: configured, get: async () => {
        calls++;
        return { data: { count: 2, results: [{ _id: calls }], next: calls === 1 ? 'https://foreign.invalid/collect' : null } };
    } });
    await assert.rejects(server.fetchData(), /paginaci.n/i);
    assert.equal(calls, 1);
});
