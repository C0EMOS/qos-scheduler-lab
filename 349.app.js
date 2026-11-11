/******/ (() => { // webpackBootstrap
/******/ 	"use strict";

;// ./src/lib/simulator/heap.ts
/** Stable min-heap. Event ties are resolved by the supplied comparator and sequence. */
class MinHeap {
    constructor(compare) {
        this.compare = compare;
        this.items = [];
    }
    get size() { return this.items.length; }
    peek() { return this.items[0]; }
    push(item) {
        const a = this.items;
        a.push(item);
        let n = a.length - 1;
        while (n > 0) {
            const p = Math.floor((n - 1) / 2);
            if (this.compare(a[p], a[n]) <= 0)
                break;
            [a[p], a[n]] = [a[n], a[p]];
            n = p;
        }
    }
    pop() {
        const a = this.items;
        if (!a.length)
            return undefined;
        const first = a[0], last = a.pop();
        if (a.length) {
            a[0] = last;
            let n = 0;
            while (true) {
                const l = 2 * n + 1, r = l + 1;
                let m = n;
                if (l < a.length && this.compare(a[l], a[m]) < 0)
                    m = l;
                if (r < a.length && this.compare(a[r], a[m]) < 0)
                    m = r;
                if (m === n)
                    break;
                [a[n], a[m]] = [a[m], a[n]];
                n = m;
            }
        }
        return first;
    }
}

;// ./src/lib/simulator/types.ts
/** ESOF 4310 Secure QoS term-project — mathematical domain model. */
const types_CLASSES = ['voice', 'video', 'data'];
function defaultConfig() {
    return {
        scheduler: 'FIFO', capacityBps: 10000000, bufferPackets: 90,
        allocations: { voice: 30, video: 30, data: 30 },
        weights: { voice: 1, video: 1, data: 1 },
        quanta: { voice: 1200, video: 1200, data: 1200 },
        profiles: {
            voice: { peakBps: 64000, onMeanSec: 0.36, offMeanSec: 0.64, packetBytes: 120, sources: 40 },
            video: { peakBps: 384000, onMeanSec: 0.29, offMeanSec: 0.71, packetBytes: 1000, sources: 40 },
            data: { peakBps: 256000, onMeanSec: 0.35, offMeanSec: 0.65, packetBytes: 583, sources: 40 },
        },
        warmupSec: 10, measureSec: 60, seed: 4310,
        security: { enabled: false, tagBytes: 32, attackFraction: 0 },
    };
}
function expectedOfferedBps(profiles) {
    return types_CLASSES.reduce((total, c) => {
        const p = profiles[c];
        return total + p.sources * p.peakBps * p.onMeanSec / (p.onMeanSec + p.offMeanSec);
    }, 0);
}
function expectedRho(config) {
    return expectedOfferedBps(config.profiles) / config.capacityBps;
}
function validateConfig(c) {
    const problems = [];
    if (c.capacityBps !== 10000000)
        problems.push('The assignment fixes output capacity at exactly 10 Mbps.');
    if (!Number.isInteger(c.bufferPackets) || c.bufferPackets < 3 || c.bufferPackets > 100000)
        problems.push('K must be an integer between 3 and 100,000.');
    if (!(c.warmupSec >= 0 && c.warmupSec <= 3600) || !Number.isFinite(c.warmupSec))
        problems.push('Warmup must be between 0 and 3,600 s.');
    if (!(c.measureSec > 0 && c.measureSec <= 3600) || !Number.isFinite(c.measureSec))
        problems.push('Measurement duration must be between 0 and 3,600 s.');
    if (!Number.isInteger(c.seed) || c.seed < 0 || c.seed > 2147483647)
        problems.push('Seed must be a nonnegative 32-bit integer.');
    if (!['FIFO', 'SPQ', 'DRR', 'WFQ'].includes(c.scheduler))
        problems.push('Unknown scheduler.');
    const allocated = types_CLASSES.reduce((n, k) => n + c.allocations[k], 0);
    if (allocated !== c.bufferPackets)
        problems.push(`Class allocations must sum to K (${allocated} ≠ ${c.bufferPackets}).`);
    let count = 0;
    for (const key of types_CLASSES) {
        const p = c.profiles[key];
        count += p.sources;
        if (!Number.isInteger(p.sources) || p.sources < 0 || p.sources > 2000)
            problems.push(`Invalid ${key} source count.`);
        if (!(p.peakBps > 0 && p.peakBps <= 100000000))
            problems.push(`Invalid ${key} peak rate.`);
        if (!(p.onMeanSec > 0 && p.offMeanSec > 0))
            problems.push(`Invalid ${key} ON/OFF means.`);
        if (!Number.isInteger(p.packetBytes) || p.packetBytes <= 0 || p.packetBytes > 65535)
            problems.push(`Invalid ${key} packet size.`);
        if (!Number.isInteger(c.allocations[key]) || c.allocations[key] <= 0)
            problems.push(`Queue allocation for ${key} must be a positive integer.`);
        if (!Number.isFinite(c.weights?.[key]) || c.weights[key] <= 0)
            problems.push('WFQ weights must be finite and positive.');
        if (!Number.isFinite(c.quanta[key]) || c.quanta[key] <= 0)
            problems.push(`DRR quantum for ${key} must be positive.`);
    }
    if (count === 0)
        problems.push('At least one traffic source is required.');
    if (c.security.tagBytes < 0 || c.security.tagBytes > 128 || !Number.isInteger(c.security.tagBytes))
        problems.push('Security tag size must be 0–128 bytes.');
    if (c.security.attackFraction < 0 || c.security.attackFraction > 1 || !Number.isFinite(c.security.attackFraction))
        problems.push('Attack fraction must be between 0 and 1.');
    return problems;
}
/** Partition a finite K waiting-buffer into three positive integer shares. */
function allocateBuffer(K) {
    const base = Math.floor(K / 3), rem = K % 3;
    return { voice: base + (rem > 0 ? 1 : 0), video: base + (rem > 1 ? 1 : 0), data: base };
}

;// ./src/lib/simulator/traffic.ts


/** Identical seeded input is reused verbatim across competing schedulers. */
function makeRandom(seed) {
    let x = (seed >>> 0) || 0x9e3779b9;
    return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296; };
}
const exponential = (mean, rng) => -mean * Math.log(Math.max(1e-12, 1 - rng()));
const order = { OFF: 0, ON: 1, EMIT: 2 };
/**
 * Explicit event-driven alternating ON/OFF sources. Means are input requirements; distributions
 * are an engineering assumption: independent exponential holding times, stationarity at t=0.
 * A packet is emitted only after enough ON time to generate its complete payload at peak rate.
 * Interruption by OFF cancels the pending packet; no partially generated packets are sent.
 */
function generateTrace(c) {
    const rng = makeRandom(c.seed), duration = c.warmupSec + c.measureSec;
    const heap = new MinHeap((a, b) => a.time - b.time || order[a.kind] - order[b.kind] || a.sequence - b.sequence);
    const output = [];
    let seq = 0;
    const put = (source, kind, time, session) => { if (time < duration)
        heap.push({ source, kind, time, session, sequence: seq++ }); };
    for (const kind of types_CLASSES) {
        const p = c.profiles[kind];
        for (let s = 0; s < p.sources; s++) {
            const source = { id: `${kind}-${s + 1}`, kind, session: 0, on: false, spacing: p.packetBytes * 8 / p.peakBps, payloadBytes: p.packetBytes };
            const duty = p.onMeanSec / (p.onMeanSec + p.offMeanSec);
            if (rng() < duty)
                put(source, 'ON', 0, 0);
            else
                put(source, 'ON', exponential(p.offMeanSec, rng), 0);
        }
    }
    while (heap.size) {
        const ev = heap.pop(), src = ev.source, p = c.profiles[src.kind];
        if (ev.kind === 'ON') {
            src.on = true;
            src.session++;
            put(src, 'OFF', ev.time + Math.max(1e-9, exponential(p.onMeanSec, rng)), src.session);
            put(src, 'EMIT', ev.time + src.spacing, src.session);
        }
        else if (ev.kind === 'OFF') {
            if (!src.on || ev.session !== src.session)
                continue;
            src.on = false;
            src.session++;
            put(src, 'ON', ev.time + Math.max(1e-9, exponential(p.offMeanSec, rng)), src.session);
        }
        else if (src.on && ev.session === src.session) {
            const attack = src.kind === 'data' && rng() < c.security.attackFraction;
            output.push({ id: output.length + 1, sourceId: src.id, arrivedSec: ev.time, origin: src.kind,
                claimed: attack ? 'voice' : src.kind, payloadBytes: src.payloadBytes });
            put(src, 'EMIT', ev.time + src.spacing, src.session);
        }
        if (output.length > 2000000)
            throw new Error('Trace exceeds the safety cap of 2,000,000 packets. Shorten the experiment.');
    }
    return output;
}

;// ./src/lib/simulator/schedulers.ts

class FastQueue {
    constructor() {
        this.a = [];
        this.head = 0;
    }
    get length() { return this.a.length - this.head; }
    push(p) { this.a.push(p); }
    peek() { return this.a[this.head]; }
    shift() {
        if (!this.length)
            return undefined;
        const p = this.a[this.head++];
        if (this.head > 1024 && this.head > this.a.length / 2) {
            this.a = this.a.slice(this.head);
            this.head = 0;
        }
        return p;
    }
}
/** FIFO, strict-priority, and deficit round-robin plus packet-based WFQ. */
class Scheduler {
    // A class stays active in fluid GPS until its tail finishes, independently
    // of the physical packet queue. Process all tail crossings before arrival.
    tag(p) {
        let dt = p.arrivedSec - this.last;
        while (dt > 0) {
            const active = types_CLASSES.filter(c => this.tail[c] > this.v);
            if (!active.length)
                break;
            const sum = active.reduce((s, c) => s + this.weights[c], 0);
            const first = Math.min(...active.map(c => this.tail[c]));
            const span = (first - this.v) * sum * 8 / this.rate;
            if (span > dt) {
                this.v += dt * this.rate / (8 * sum);
                break;
            }
            this.v = first;
            dt -= span;
        }
        this.last = p.arrivedSec;
        const c = p.effective;
        this.tail[c] = Math.max(this.tail[c], this.v) + p.wireBytes / this.weights[c];
        this.tags.set(p, this.tail[c]);
    }
    constructor(kind, quantum, weights = { voice: 1, video: 1, data: 1 }, rate = 10000000) {
        this.kind = kind;
        this.quantum = quantum;
        this.weights = weights;
        this.rate = rate;
        this.fifo = new FastQueue();
        this.q = { voice: new FastQueue(), video: new FastQueue(), data: new FastQueue() };
        this.originCount = { voice: 0, video: 0, data: 0 };
        this.deficit = { voice: 0, video: 0, data: 0 };
        this.cursor = 0;
        this.credited = false;
        this.v = 0;
        this.last = 0;
        this.tail = { voice: 0, video: 0, data: 0 };
        this.tags = new WeakMap();
    }
    get totalWaiting() { return this.originCount.voice + this.originCount.video + this.originCount.data; }
    waitingFor(c) { return this.originCount[c]; }
    waitingEffective(c) { return this.kind === 'FIFO' ? this.fifo.length : this.q[c].length; }
    enqueue(p) {
        if (this.kind === 'FIFO') {
            this.fifo.push(p);
            this.originCount[p.origin]++;
            return;
        }
        if (this.kind === 'WFQ')
            this.tag(p);
        this.q[p.effective].push(p);
        this.originCount[p.origin]++;
    }
    next() {
        let result;
        if (this.kind === 'FIFO')
            result = this.fifo.shift();
        else if (this.kind === 'SPQ') {
            for (const cls of types_CLASSES)
                if (this.q[cls].length) {
                    result = this.q[cls].shift();
                    break;
                }
        }
        else if (this.kind === 'WFQ') {
            let choice, best = Infinity;
            for (const c of types_CLASSES) {
                const head = this.q[c].peek();
                if (head && this.tags.get(head) < best) {
                    best = this.tags.get(head);
                    choice = c;
                }
            }
            if (choice)
                result = this.q[choice].shift();
        }
        else {
            if (!this.totalWaiting) {
                this.credited = false;
                return undefined;
            }
            let attempts = 0;
            while (attempts++ < 1000000) {
                const cls = types_CLASSES[this.cursor], q = this.q[cls];
                if (!q.length) {
                    this.deficit[cls] = 0;
                    this.advanceCursor();
                    continue;
                }
                if (!this.credited) {
                    this.deficit[cls] += this.quantum[cls];
                    this.credited = true;
                }
                if (q.peek().wireBytes <= this.deficit[cls] + 1e-9) {
                    result = q.shift();
                    this.deficit[cls] -= result.wireBytes;
                    if (!q.length) {
                        this.deficit[cls] = 0;
                        this.advanceCursor();
                    }
                    else if (q.peek().wireBytes > this.deficit[cls] + 1e-9)
                        this.advanceCursor();
                    break;
                }
                this.advanceCursor();
            }
            if (!result)
                throw new Error('DRR found no eligible packet; check quantum values.');
        }
        if (result)
            this.originCount[result.origin]--;
        return result;
    }
    advanceCursor() { this.cursor = (this.cursor + 1) % types_CLASSES.length; this.credited = false; }
}

;// ./src/lib/simulator/simulate.ts



const blank = () => ({ generated: 0, transmitted: 0, dropped: 0, waitingSum: 0, responseSum: 0, wireBytes: 0, payloadBytes: 0,
    offeredBytes: 0, queueArea: 0, waitingSamples: [], maxWaiting: 0 });
const EPS = 1e-10;
function percentile(data, pct) {
    if (data.length === 0)
        return 0;
    data.sort((a, b) => a - b);
    return data[Math.ceil(pct * data.length) - 1] ?? 0;
}
/**
 * Nonpreemptive, single 10 Mbps output link. Each event timestamp processes departure BEFORE arrivals,
 * A free link starts the first packet immediately; later same-time arrivals follow trace order.
 * K is WAITING capacity: the current in-service packet is outside K.
 */
function simulate(config, providedTrace) {
    const issues = validateConfig(config);
    if (issues.length)
        throw Error(issues.join(' '));
    const trace = providedTrace ?? generateTrace(config), start = config.warmupSec, end = start + config.measureSec;
    const acc = { voice: blank(), video: blank(), data: blank() };
    const scheduler = new Scheduler(config.scheduler, config.quanta, config.weights, config.capacityBps);
    let current = null, departure = Infinity, index = 0, t = 0, workEvents = 0;
    let unauthorizedPriorityAccepted = 0, unauthorizedPriorityReclassified = 0;
    const log = [];
    const dropLedger = [];
    const securityLedger = [];
    const addLog = (timeSec, kind, trafficClass, detail) => {
        if (log.length < 52)
            log.push({ timeSec, kind, trafficClass, detail });
    };
    const integrate = (now) => {
        const delta = Math.max(0, Math.min(now, end) - Math.max(t, start));
        if (delta > 0)
            for (const cls of types_CLASSES)
                acc[cls].queueArea += scheduler.waitingFor(cls) * delta;
        t = now;
    };
    const startNext = (now) => {
        if (current)
            return;
        const p = scheduler.next();
        if (!p)
            return;
        p.startedSec = now;
        p.finishedSec = now + p.wireBytes * 8 / config.capacityBps;
        current = p;
        departure = p.finishedSec;
        addLog(now, 'start', p.origin, `#${p.id} (${p.effective}) begins; ${p.wireBytes} bytes`);
    };
    while (index < trace.length || departure <= end) {
        const arrivalTime = index < trace.length ? trace[index].arrivedSec : Infinity;
        const when = Math.min(arrivalTime, departure);
        if (!Number.isFinite(when) || when >= end - EPS)
            break;
        integrate(when);
        // 1. Departure first at the timestamp; current service is never preempted.
        if (departure <= when + EPS && current) {
            const p = current;
            current = null;
            departure = Infinity;
            workEvents++;
            if (when >= start - EPS) {
                const a = acc[p.origin];
                a.transmitted++;
                a.wireBytes += p.wireBytes;
                a.payloadBytes += p.payloadBytes;
                const wait = (p.startedSec - p.arrivedSec) * 1000, response = (p.finishedSec - p.arrivedSec) * 1000;
                a.waitingSum += wait;
                a.responseSum += response;
                a.waitingSamples.push(wait);
                a.maxWaiting = Math.max(a.maxWaiting, wait);
            }
            addLog(when, 'departure', p.origin, `#${p.id} departed`);
        }
        // 2. All arrivals at time t are handled deterministically in generated trace order.
        while (index < trace.length && trace[index].arrivedSec <= when + EPS) {
            const raw = trace[index++];
            workEvents++;
            const measured = raw.arrivedSec >= start - EPS;
            const a = acc[raw.origin];
            if (measured) {
                a.generated++;
                a.offeredBytes += raw.payloadBytes;
            }
            const forged = raw.claimed !== raw.origin;
            const effective = config.security.enabled ? raw.origin : raw.claimed;
            if (forged && measured) {
                if (config.security.enabled)
                    unauthorizedPriorityReclassified++;
                else
                    unauthorizedPriorityAccepted++;
            }
            const wireBytes = raw.payloadBytes + (config.security.enabled ? config.security.tagBytes : 0);
            const p = { ...raw, effective, wireBytes, startedSec: 0, finishedSec: 0 };
            // Queues model WAITING slots. When the link is idle, the first arrival may use the
            // transmitter directly; otherwise packets consume only waiting buffer slots.
            if (!current && scheduler.totalWaiting === 0) {
                scheduler.enqueue(p);
                startNext(when);
            }
            else {
                const full = config.scheduler === 'FIFO'
                    ? scheduler.totalWaiting >= config.bufferPackets
                    : false;
                const actualFull = config.scheduler === 'FIFO' ? full : classQueueSize(effective) >= config.allocations[effective];
                if (actualFull) {
                    if (measured)
                        a.dropped++;
                    const reason = config.scheduler === 'FIFO' ? 'BUFFER_FULL' : 'QUEUE_FULL';
                    dropLedger.push({ timeSec: when, origin: raw.origin, reason, packetId: raw.id });
                    addLog(when, 'drop', raw.origin, `#${raw.id}: ${reason} (${effective})`);
                }
                else
                    scheduler.enqueue(p);
            }
            if (forged) {
                securityLedger.push({ packetId: raw.id, timeSec: when, origin: raw.origin, claim: raw.claimed, decision: config.security.enabled ? 'RECLASSIFIED_UNAUTHORIZED_MARK' : 'ACCEPTED_UNVERIFIED_MARK' });
                if (measured)
                    addLog(when, 'classification', raw.origin, `Unauthorized voice claim ${config.security.enabled ? 'reclassified as data' : 'accepted as voice'}`);
            }
        }
        startNext(when);
    }
    integrate(end);
    function classQueueSize(cls) {
        // Waiting capacity in SPQ/DRR is assigned to the EFFECTIVE scheduler class.
        // Scheduler exposes origin queue counts for queue-time metrics separately.
        return schedulerEffectiveSize(cls);
    }
    function schedulerEffectiveSize(cls) {
        return scheduler.waitingEffective(cls);
    }
    const classes = {};
    for (const cls of types_CLASSES) {
        const a = acc[cls], pending = tracePending(cls);
        const s = {
            generated: a.generated, transmitted: a.transmitted, dropped: a.dropped, outstanding: pending,
            meanWaitingMs: a.transmitted ? a.waitingSum / a.transmitted : 0,
            meanResponseMs: a.transmitted ? a.responseSum / a.transmitted : 0,
            maxWaitingMs: a.maxWaiting, p95WaitingMs: percentile(a.waitingSamples, 0.95),
            lossFraction: a.generated ? a.dropped / a.generated : 0,
            meanQueueLength: a.queueArea / config.measureSec,
            wireThroughputBps: 8 * a.wireBytes / config.measureSec,
            usefulThroughputBps: 8 * a.payloadBytes / config.measureSec,
            offeredPayloadBps: 8 * a.offeredBytes / config.measureSec,
        };
        classes[cls] = s;
    }
    function tracePending(cls) { return scheduler.waitingFor(cls) + (current?.origin === cls ? 1 : 0); }
    const rates = types_CLASSES.map(cls => {
        const m = classes[cls];
        return m.offeredPayloadBps > 0 ? m.usefulThroughputBps / m.offeredPayloadBps : 0;
    }).filter((_, i) => classes[types_CLASSES[i]].generated > 0);
    const sum = rates.reduce((a, b) => a + b, 0), sumsq = rates.reduce((a, b) => a + b * b, 0);
    const fairness = rates.length && sumsq ? sum * sum / (rates.length * sumsq) : 1;
    return {
        config, expectedRho: expectedRho(config),
        measuredRho: types_CLASSES.reduce((n, cls) => n + classes[cls].offeredPayloadBps, 0) / config.capacityBps,
        classes, transmitted: types_CLASSES.reduce((n, cls) => n + classes[cls].transmitted, 0),
        dropped: types_CLASSES.reduce((n, cls) => n + classes[cls].dropped, 0),
        pending: types_CLASSES.reduce((n, cls) => n + classes[cls].outstanding, 0),
        overallWireThroughputBps: types_CLASSES.reduce((n, cls) => n + classes[cls].wireThroughputBps, 0),
        overallUsefulThroughputBps: types_CLASSES.reduce((n, cls) => n + classes[cls].usefulThroughputBps, 0),
        normalizedFairnessIndex: fairness, unauthorizedPriorityAccepted, unauthorizedPriorityReclassified,
        eventSample: log, dropLedger, securityLedger, workEvents, traceLength: trace.length,
    };
}

;// ./src/lib/simulator/studies.ts



const TARGET_RHOS = [0.3, 0.6, 0.9, 1.1];
function sourceCountsForTarget(base, target) {
    const factor = target / Math.max(0.00001, expectedRho(base));
    const profiles = structuredClone(base.profiles);
    for (const cls of types_CLASSES)
        profiles[cls].sources = base.profiles[cls].sources === 0 ? 0 : Math.max(1, Math.round(base.profiles[cls].sources * factor));
    return profiles;
}
function runStudy(kind, base, opts) {
    if (!Number.isInteger(opts.replications) || opts.replications < 1 || opts.replications > 10)
        throw new Error('Replications must be 1–10.');
    const rows = [];
    const push = (scenario, targetRho, c, run, trace) => {
        const result = simulate(c, trace);
        rows.push({ study: kind, scenario, targetRho, scheduler: c.scheduler, bufferPackets: c.bufferPackets,
            securityEnabled: c.security.enabled, seed: c.seed, run, expectedRho: result.expectedRho, measuredRho: result.measuredRho, result });
    };
    for (let run = 1; run <= opts.replications; run++) {
        const seed = (base.seed + 101 * (run - 1)) >>> 0;
        if (kind === 'E1') {
            for (const rho of TARGET_RHOS) {
                const config = structuredClone(base);
                config.seed = seed;
                config.profiles = sourceCountsForTarget(base, rho);
                config.security.enabled = false;
                config.security.attackFraction = 0;
                const trace = generateTrace(config);
                for (const scheduler of ['FIFO', 'SPQ', 'DRR', 'WFQ']) {
                    const c = { ...config, scheduler };
                    push(`ρ≈${rho}`, rho, c, run, trace);
                }
            }
        }
        else if (kind === 'E2') {
            const target = 0.9, config = structuredClone(base);
            config.seed = seed;
            config.profiles = sourceCountsForTarget(base, target);
            config.scheduler = 'DRR';
            config.security.enabled = false;
            config.security.attackFraction = 0;
            const trace = generateTrace(config);
            const sizes = opts.bufferValues ?? [Math.max(3, Math.round(base.bufferPackets / 3)), base.bufferPackets, Math.round(5 * base.bufferPackets / 3)];
            for (const k of [...new Set(sizes)].sort((a, b) => a - b)) {
                const c = { ...config, bufferPackets: k, allocations: allocateBuffer(k) };
                push(`DRR / K=${k}`, target, c, run, trace);
            }
        }
        else {
            const target = 0.9, config = structuredClone(base);
            config.seed = seed;
            config.profiles = sourceCountsForTarget(base, target);
            config.scheduler = 'DRR';
            for (const attackFraction of [0, 0.08]) {
                const traffic = { ...config, security: { ...config.security, attackFraction } };
                const trace = generateTrace(traffic);
                for (const enabled of [false, true]) {
                    const c = { ...traffic, security: { ...traffic.security, enabled } };
                    push(`${attackFraction ? 'Forged voice claim' : 'Legitimate traffic'} / ${enabled ? 'auth ON' : 'auth OFF'}`, target, c, run, trace);
                }
            }
        }
    }
    return { study: kind, generatedAt: new Date().toISOString(), rows, explanation: kind === 'E1' ? 'Same immutable arrival traces, capacity, security-disabled setting and total K across FIFO/SPQ/DRR/WFQ. Class allocations are partitions of K for non-FIFO.' :
            kind === 'E2' ? 'Same traffic trace, seed, DRR, near-capacity load; varying K with equal-share class partitions.' :
                'Same traces across each security-on/off pair, using DRR at a busy load. 32-byte simulated HMAC tag overhead on all authenticated packets, plus a forged data-to-voice classification case. Unauthorized markings are reclassified when authentication is on.' };
}
function studyFlatRows(report) {
    return report.rows.flatMap(row => CLASSES.map(cls => {
        const m = row.result.classes[cls];
        return {
            study: row.study, scenario: row.scenario, replication: row.run, seed: row.seed, scheduler: row.scheduler,
            security: row.securityEnabled, bufferK: row.bufferPackets, class: cls, targetRho: row.targetRho,
            expectedRho: row.expectedRho, measuredRho: row.measuredRho,
            sourceCount: row.result.config.profiles[cls].sources,
            generated: m.generated, transmitted: m.transmitted, dropped: m.dropped, pending: m.outstanding,
            waitingMs: m.meanWaitingMs, responseMs: m.meanResponseMs, p95WaitingMs: m.p95WaitingMs,
            queuePackets: m.meanQueueLength, lossRatio: m.lossFraction,
            wireThroughputBps: m.wireThroughputBps, usefulThroughputBps: m.usefulThroughputBps,
            unauthorizedAccepted: row.result.unauthorizedPriorityAccepted, unauthorizedReclassified: row.result.unauthorizedPriorityReclassified,
            fairness: row.result.normalizedFairnessIndex, warmupSec: row.result.config.warmupSec,
            measuredSec: row.result.config.measureSec,
            weights: JSON.stringify(row.result.config.weights), quanta: JSON.stringify(row.result.config.quanta),
            allocations: JSON.stringify(row.result.config.allocations), tagBytes: row.result.config.security.tagBytes,
        };
    }));
}
/** Independent-replication summary; do not equate a small SD with formal convergence. */
function studyAggregateRows(report) {
    const groups = new Map();
    for (const r of studyFlatRows(report)) {
        const key = [r.scenario, r.scheduler, r.bufferK, r.security, r.class].join('|');
        const g = groups.get(key) ?? [];
        g.push(r);
        groups.set(key, g);
    }
    const stats = (values) => {
        const n = values.length, mean = values.reduce((a, b) => a + b, 0) / n;
        const sd = n > 1 ? Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
        return { mean, sd };
    };
    return [...groups.values()].map(g => {
        const first = g[0];
        return { study: first.study, scenario: first.scenario, scheduler: first.scheduler, bufferK: first.bufferK,
            security: first.security, class: first.class, replications: g.length,
            targetRho: first.targetRho, measuredRho: stats(g.map(x => x.measuredRho)).mean,
            waitingMeanMs: stats(g.map(x => x.waitingMs)).mean,
            waitingSdMs: stats(g.map(x => x.waitingMs)).sd,
            responseMeanMs: stats(g.map(x => x.responseMs)).mean,
            responseSdMs: stats(g.map(x => x.responseMs)).sd,
            lossMean: stats(g.map(x => x.lossRatio)).mean,
            lossSd: stats(g.map(x => x.lossRatio)).sd,
            queueMean: stats(g.map(x => x.queuePackets)).mean,
            queueSd: stats(g.map(x => x.queuePackets)).sd,
            wireThroughputBpsMean: stats(g.map(x => x.wireThroughputBps)).mean,
            usefulThroughputBpsMean: stats(g.map(x => x.usefulThroughputBps)).mean,
            usefulThroughputBpsSd: stats(g.map(x => x.usefulThroughputBps)).sd,
        };
    });
}

;// ./src/lib/simulator/selfcheck.ts




function runSelfChecks() {
    const checks = [];
    function check(name, fn) { try {
        fn();
        checks.push({ name, pass: true, detail: 'Verified' });
    }
    catch (e) {
        checks.push({ name, pass: false, detail: e instanceof Error ? e.message : String(e) });
    } }
    const assert = (condition, message) => { if (!condition)
        throw Error(message); };
    const close = (actual, expected, tolerance = 1e-7) => assert(Math.abs(actual - expected) <= tolerance, `${actual} ≠ ${expected}`);
    const packet = (id, time, origin, payloadBytes, claim) => ({ id, arrivedSec: time, origin, claimed: claim ?? origin, payloadBytes, sourceId: `${origin}-1` });
    const basic = () => { const c = defaultConfig(); c.warmupSec = 0; c.measureSec = 0.01; return c; };
    check('Lecture 1: 1000 bytes at 10 Mbps = 0.8 ms', () => {
        const c = basic(), r = simulate(c, [packet(1, 0, 'video', 1000)]);
        close(r.classes.video.meanResponseMs, 0.8);
        close(r.classes.video.meanWaitingMs, 0);
        assert(r.transmitted === 1, 'packet not transmitted');
    });
    check('FIFO: three packets preserve arrival order', () => {
        const c = basic();
        c.scheduler = 'FIFO';
        const r = simulate(c, [packet(1, 0, 'data', 1000), packet(2, 0.0001, 'voice', 120), packet(3, 0.0002, 'video', 1000)]);
        const ids = r.eventSample.filter(e => e.kind === 'start').map(e => e.detail.split(' ')[0]);
        assert(ids.join(',') === '#1,#2,#3', `FIFO served ${ids.join(',')}`);
    });
    check('SPQ: queued voice overtakes queued data, not active packet', () => {
        const c = basic();
        c.scheduler = 'SPQ';
        const r = simulate(c, [packet(1, 0, 'data', 1000), packet(2, 0.0001, 'data', 1000), packet(3, 0.0002, 'voice', 120)]);
        const ids = r.eventSample.filter(e => e.kind === 'start').map(e => e.detail.split(' ')[0]);
        assert(ids.join(',') === '#1,#3,#2', `SPQ served ${ids.join(',')}`);
    });
    check('K is waiting capacity, with explicit tail drops', () => {
        const c = basic();
        c.bufferPackets = 3;
        c.allocations = allocateBuffer(3);
        const trace = Array.from({ length: 8 }, (_, i) => packet(i + 1, 0, 'video', 1000));
        const r = simulate(c, trace);
        assert(r.classes.video.dropped === 4, `Expected 4 drops, got ${r.classes.video.dropped}`);
        assert(r.classes.video.transmitted === 4, 'Expected 1 active + 3 waiting');
    });
    check('DRR: positive quanta eventually dispatch large packets', () => {
        const c = basic();
        c.scheduler = 'DRR';
        c.quanta = { voice: 32, video: 64, data: 48 };
        const r = simulate(c, [packet(1, 0, 'video', 1000), packet(2, 0.0001, 'voice', 120)]);
        assert(r.transmitted === 2, 'DRR blocked a packet larger than its quantum');
    });
    check('Unauthorized priority changes are reclassified with security ON', () => {
        const c = basic(), trace = [packet(1, 0, 'data', 583, 'voice')];
        c.security.enabled = false;
        const off = simulate(c, trace);
        c.security.enabled = true;
        const on = simulate(c, trace);
        assert(off.unauthorizedPriorityAccepted === 1, 'Forged mark not accepted in unsafe model');
        assert(on.unauthorizedPriorityReclassified === 1, 'Forged mark not reclassified in safe model');
    });
    check('32-byte authentication tag adds expected wire transmission time', () => {
        const c = basic(), trace = [packet(1, 0, 'voice', 120)];
        c.security.enabled = false;
        const off = simulate(c, trace);
        c.security.enabled = true;
        const on = simulate(c, trace);
        close(on.classes.voice.meanResponseMs - off.classes.voice.meanResponseMs, 32 * 8 / 1e7 * 1000);
        assert(on.classes.voice.usefulThroughputBps === off.classes.voice.usefulThroughputBps, 'Useful payload should match for one packet');
    });
    check('Same seed and parameters reproduce the exact same trace and outcomes', () => {
        const c = basic();
        c.measureSec = 1;
        const x = generateTrace(c), y = generateTrace(c);
        assert(JSON.stringify(x) === JSON.stringify(y), 'Input traffic changed');
        const r1 = simulate(c, x), r2 = simulate(c, y);
        assert(JSON.stringify(r1.classes) === JSON.stringify(r2.classes), 'Results changed');
    });
    check('Time-average waiting queue length includes elapsed time', () => {
        const c = basic();
        c.measureSec = 0.004;
        const trace = [packet(1, 0, 'video', 1000), packet(2, 0, 'video', 1000)];
        const r = simulate(c, trace);
        close(r.classes.video.meanQueueLength, 0.0008 / 0.004);
    });
    check('Loss, delay and throughput formulas use the professor\'s definitions', () => {
        const c = basic();
        c.measureSec = 0.004;
        c.bufferPackets = 3;
        c.allocations = allocateBuffer(3);
        const trace = Array.from({ length: 5 }, (_, i) => packet(i + 1, 0, 'voice', 120));
        const r = simulate(c, trace), m = r.classes.voice;
        assert(m.generated === 5 && m.dropped === 1 && m.transmitted === 4, 'Incorrect counters');
        close(m.lossFraction, 0.2);
        close(m.wireThroughputBps, 4 * 120 * 8 / 0.004);
    });
    check('Offered-load levels use class-specific ON fractions', () => {
        const c = defaultConfig();
        const expected = 0.896;
        const test = runStudy('E1', { ...c, warmupSec: 0, measureSec: 0.1 }, { replications: 1 });
        assert(test.rows.length === 16, 'Expected 16 E1 runs');
        close(test.rows.find(row => row.targetRho === 0.9).expectedRho, expected, 0.00001);
    });
    return checks;
}

;// ./src/lib/simulator/index.ts






;// ./src/workers/simulation.worker.ts

self.onmessage = (event) => {
    const m = event.data;
    try {
        const data = m.kind === 'single' ? simulate(m.config) : m.kind === 'study' ? runStudy(m.study, m.config, m.options) : runSelfChecks();
        self.postMessage({ id: m.id, ok: true, kind: m.kind, data });
    }
    catch (error) {
        self.postMessage({ id: m.id, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
};

/******/ })()
;